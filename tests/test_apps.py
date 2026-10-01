"""HTTP acceptance tests: use real ASGI request/session/form handling."""

import re

import httpx
import pytest

from mock_company import db as dbmodule
from mock_company.apps import create_app
from mock_company.db import query
from seed import seed


@pytest.fixture(autouse=True)
def fixtures(tmp_path, monkeypatch):
    monkeypatch.setattr(dbmodule, "DATA", tmp_path)
    monkeypatch.setattr("mock_company.apps.DATA", tmp_path)
    monkeypatch.setattr("seed.DATA", tmp_path)
    seed(reset=True)


async def login(client):
    response = await client.get("/login")
    token = re.search(r'name="csrf" value="([^"]+)"', response.text)[1]
    response = await client.post("/login", data={"csrf": token, "username": "demo", "password": "demo"})
    assert response.status_code == 200
    return response


async def post_form(client, url, fields):
    response = await client.get(url)
    token = re.search(r'name="csrf" value="([^"]+)"', response.text)[1]
    return await client.post(url, data={"csrf": token, **fields})


@pytest.mark.parametrize("kind", ["portal", "erp", "mail"])
async def test_login(kind):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app(kind)), base_url="http://test", follow_redirects=True
    ) as client:
        assert "/login" in str((await client.get("/")).url)
        await login(client)


async def test_portal_pdf_pagination():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app("portal")), base_url="http://test", follow_redirects=True
    ) as client:
        response = await login(client)
        assert response.text.count("<tr>") == 6
        assert "Next page" in response.text
        assert "INV-02-002" in (await client.get("/?page=2")).text
        response = await client.get("/invoices/4/pdf")
        assert response.content.startswith(b"%PDF")
        assert "Globex" in (await client.get("/?search=Globex")).text


async def test_erp_create_validate_edit():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app("erp")), base_url="http://test", follow_redirects=True
    ) as client:
        await login(client)
        bad = await post_form(
            client, "/payables/new", {"vendor": "Initech", "invoice_no": "TEST", "amount": "-3", "due": "bad"}
        )
        assert 'role="alert"' in bad.text
        fields = {"vendor": "Initech", "invoice_no": "TEST", "amount": "125.25", "due": "2026-12-31"}
        assert "TEST" in (await post_form(client, "/payables/new", fields)).text
        assert "Duplicate payable" in (await post_form(client, "/payables/new", fields)).text
        assert query("erp", 'SELECT * FROM payables WHERE invoice_no="TEST"')[0]["amount_paise"] == 12525
        await post_form(
            client, "/vendors/2/edit", {"email": "accounts@initech.test", "phone": "123", "notes": "Source"}
        )
        assert query("erp", "SELECT email FROM vendors WHERE id=2")[0]["email"] == "accounts@initech.test"
        assert "Invalid CSRF" in (await client.post("/vendors/2/edit", data={"email": "x@initech.test"})).text


async def test_mail_send():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app("mail")), base_url="http://test", follow_redirects=True
    ) as client:
        await login(client)
        assert "New billing contact" in (await client.get("/inbox")).text
        assert "billing@initech.test" in (await client.get("/messages/1")).text
        assert "Recipient, subject" in (await post_form(client, "/compose", {"to": "bad"})).text
        await post_form(
            client, "/compose", {"to": "finance@acme.test", "subject": "Test report", "body": "Body"}
        )
        assert "Test report" in (await client.get("/sent")).text


def test_seed_idempotent():
    before = query("erp", "SELECT * FROM payables")
    seed()
    assert query("erp", "SELECT * FROM payables") == before
    assert len(query("portal", "SELECT * FROM invoices")) == 20


async def test_chaos(monkeypatch):
    monkeypatch.setattr("mock_company.apps.chaos_config", lambda: {"enabled": True, "failure_rate": 1})
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app("portal")), base_url="http://test"
    ) as client:
        assert (await client.get("/login")).status_code == 503
        assert (await client.get("/health")).status_code == 200
    monkeypatch.setattr(
        "mock_company.apps.chaos_config",
        lambda: {
            "enabled": True,
            "failure_rate": 0,
            "latency_rate": 0,
            "expire_rate": 0,
            "rename": True,
            "reorder": True,
        },
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app("erp")), base_url="http://test", follow_redirects=True
    ) as client:
        await login(client)
        response = await client.get("/payables/new")
        assert "Save entry" in response.text
        assert response.text.index('id="notes"') < response.text.index('id="vendor"')
