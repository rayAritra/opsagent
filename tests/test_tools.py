"""Real Chromium acceptance tests without a mocked agent or provider."""

from types import SimpleNamespace

import pytest

from agent import tools  # noqa: F401
from agent.browser import BrowserSession
from agent.config import APPS
from agent.tool_registry import definitions, invoke


@pytest.fixture
async def ctx(tmp_path, live_apps):
    context = SimpleNamespace(
        browser=BrowserSession(tmp_path), workspace=tmp_path, memory={}, evidence={}, finish_request=None
    )

    async def answer(question):
        return {"answer": "2026-12-31"}

    context.human_question = answer
    await context.browser.start()
    yield context
    await context.browser.close()


async def control(ctx, label):
    result = await invoke(ctx, "browser_observe", {})
    assert result["ok"], result
    return next(e["id"] for e in result["data"]["elements"] if e["label"] == label)


async def sign_in(ctx, app):
    assert (await invoke(ctx, "browser_navigate", {"url": APPS[app] + "/login"}))["ok"]
    for label, field in [("Username", "username"), ("Password", "password")]:
        assert (
            await invoke(
                ctx,
                "browser_type",
                {"element_id": await control(ctx, label), "text": f"${app}_creds.{field}"},
            )
        )["ok"]
    assert (await invoke(ctx, "browser_click", {"element_id": await control(ctx, "Sign in")}))["ok"]


async def test_browser_and_files(ctx):
    await sign_in(ctx, "portal")
    assert (
        await invoke(
            ctx,
            "browser_type",
            {"element_id": await control(ctx, "Search vendor or invoice"), "text": "Globex"},
        )
    )["ok"]
    assert (await invoke(ctx, "browser_click", {"element_id": await control(ctx, "Search")}))["ok"]
    assert (await invoke(ctx, "browser_click", {"element_id": await control(ctx, "View INV-01-004")}))["ok"]
    result = await invoke(ctx, "browser_download", {"element_id": await control(ctx, "Download PDF")})
    assert result["ok"], result
    result = await invoke(ctx, "pdf_extract", {"path": result["data"]["path"]})
    assert "72500.00" in result["data"]["text"]
    assert (await invoke(ctx, "files_list", {"path": "sops"}))["ok"]
    assert (await invoke(ctx, "files_read", {"path": "sops/invoice_processing.md"}))["ok"]
    result = await invoke(ctx, "knowledge_search", {"query": "invoice processing duplicate approval"})
    assert result["data"][0]["file"] == "sops/invoice_processing.md"
    assert not (await invoke(ctx, "files_read", {"path": str(ctx.workspace.parent / "secret")}))["ok"]
    assert (await invoke(ctx, "memory_note", {"key": "amount", "value": "72500"}))["ok"]
    assert (await invoke(ctx, "memory_get", {}))["data"]["amount"] == "72500"
    assert (await invoke(ctx, "ask_human", {"question": "Due date?"}))["data"]["answer"] == "2026-12-31"
    assert (await invoke(ctx, "finish", {"summary": "Done", "claimed_outcome": {}}))["ok"]
    assert ctx.finish_request
    assert (await invoke(ctx, "browser_navigate", {"url": "https://example.com"}))[
        "error_type"
    ] == "PERMISSION_DENIED"
    assert (await invoke(ctx, "browser_click", {"element_id": 999}))["error_type"] == "ELEMENT_NOT_FOUND"


async def test_select_and_validation(ctx):
    await sign_in(ctx, "erp")
    await invoke(ctx, "browser_navigate", {"url": APPS["erp"] + "/payables/new"})
    result = await invoke(
        ctx, "browser_select", {"element_id": await control(ctx, "Vendor"), "value": "Initech"}
    )
    assert result["ok"], result
    for label, text in [("Invoice number", "TOOL-TEST"), ("Amount INR", "-1"), ("Due date", "2026-12-31")]:
        assert (await invoke(ctx, "browser_type", {"element_id": await control(ctx, label), "text": text}))[
            "ok"
        ]
    result = await invoke(ctx, "browser_click", {"element_id": await control(ctx, "Create payable")})
    assert result["error_type"] == "VALIDATION"
    assert list(ctx.workspace.glob("screenshot-*.png"))
    schemas = definitions()
    assert len(schemas) >= 14
    assert all("ctx" not in d["input_schema"].get("properties", {}) for d in schemas)
