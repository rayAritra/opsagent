"""Safety integration checks for independent readback, approvals, mutation and chaos."""

import json
from datetime import date

from agent.browser import BrowserSession
from agent.config import APPS, ROOT
from agent.evidence import overdue_rows
from agent.policy import Policy
from agent.reader import Reader
from agent.runtime import Runtime
from agent.store import Store
from agent.tool_registry import invoke
from agent.verifier import Verifier
from tests.test_runtime import operation as operation_fixture
from tests.test_runtime import source, stage
from tests.test_tools import control, sign_in

operation = operation_fixture


async def test_duplicate_verifies_no_new_record(operation):
    ctx = operation
    pdf = await source(ctx, "Umbrella", "INV-03-004")
    ctx.spec["success_criteria"] = [
        {
            "id": "duplicate",
            "kind": "payable",
            "target": "Umbrella",
            "description": "Detect existing payable without creating another",
        }
    ]
    result = await Verifier().verify(ctx, {"criteria": {"duplicate": {"source_pdf": pdf}}})
    assert result["outcome"] == "VERIFIED", result


async def test_vendor_readback_catches_impostor_and_accepts_trusted_update(operation):
    ctx = operation
    await sign_in(ctx, "erp")
    await invoke(ctx, "browser_navigate", {"url": APPS["erp"] + "/vendors/2/edit"})
    ctx.spec["success_criteria"] = [
        {
            "id": "contact",
            "kind": "vendor_contact",
            "target": "Initech",
            "description": "Trusted source contact applied with approval",
        }
    ]
    assert (await Verifier().verify(ctx, {}))["outcome"] == "FAILED"
    for label, value in [
        ("Billing contact email", "accounts@initech.test"),
        ("Source email subject / notes", "New billing contact"),
    ]:
        await invoke(ctx, "browser_type", {"element_id": await control(ctx, label), "text": value})
    args = {"element_id": await control(ctx, "Save vendor")}
    policy = Policy()
    decision = await policy.evaluate(ctx, await policy.inspect_action(ctx, "browser_click", args))
    card = ctx.store.approval(ctx.run_id, decision["fingerprint"], decision)
    ctx.store.decide(ctx.run_id, card["id"], "approve")
    assert (await invoke(ctx, "browser_click", args))["ok"]
    result = await Verifier().verify(ctx, {})
    assert result["outcome"] == "VERIFIED", result
    await invoke(ctx, "browser_navigate", {"url": APPS["erp"] + "/vendors/2/edit"})
    await invoke(
        ctx,
        "browser_type",
        {"element_id": await control(ctx, "Billing contact email"), "text": "collections@gmail.com"},
    )
    # Deliberate test corruption through the real app; independent verifier must catch it.
    assert (await invoke(ctx, "browser_click", {"element_id": await control(ctx, "Save vendor")}))["ok"]
    assert (await Verifier().verify(ctx, {}))["outcome"] == "FAILED"


async def test_sent_content_verified_field_by_field(operation):
    ctx = operation
    rows = overdue_rows(ctx.baseline["payables"], date.fromisoformat(ctx.today))
    body = (
        "Overdue as of "
        + ctx.today
        + "\n"
        + "\n".join(
            f"{r['vendor']} | {r['invoice_no']} | INR {r['amount']} | {r['days_overdue']} days overdue"
            for r in rows
        )
    )
    await sign_in(ctx, "mail")
    await invoke(ctx, "browser_navigate", {"url": APPS["mail"] + "/compose"})
    for label, value in [("To", "finance@acme.test"), ("Subject", "Overdue payables"), ("Body", body)]:
        await invoke(ctx, "browser_type", {"element_id": await control(ctx, label), "text": value})
    args = {"element_id": await control(ctx, "Send")}
    policy = Policy()
    decision = await policy.evaluate(ctx, await policy.inspect_action(ctx, "browser_click", args))
    card = ctx.store.approval(ctx.run_id, decision["fingerprint"], decision)
    ctx.store.decide(ctx.run_id, card["id"], "approve")
    ctx.spec["success_criteria"] = [
        {
            "id": "mail",
            "kind": "overdue_email",
            "target": "",
            "description": "Finance receives every overdue payable with amounts and days",
        }
    ]
    assert (await Verifier().verify(ctx, {}))["outcome"] == "FAILED"
    assert (await invoke(ctx, "browser_click", args))["ok"]
    result = await Verifier().verify(ctx, {})
    assert result["outcome"] == "VERIFIED", result
    assert all(result["criteria"][0]["evidence"]["item_checks"])


async def test_runtime_approval_pauses_before_real_mutation(operation):
    ctx = operation
    pdf = await source(ctx, "Globex", "INV-01-004")
    args = await stage(ctx, "Globex Corporation", "INV-01-004", "72500.00", "2026-04-10")
    runtime = Runtime(ctx.store, ctx.run_id)
    runtime.browser = ctx.browser
    runtime.baseline = ctx.baseline
    runtime.evidence = ctx.evidence
    runtime.spec = {
        "outcome": "Record payable",
        "task_type": "invoice",
        "constraints": [],
        "success_criteria": [
            {"id": "invoice", "kind": "payable", "target": "Globex", "description": "Match source"}
        ],
    }
    runtime.state["phase"] = "EXECUTE"
    result = await runtime.execute("browser_click", args)
    assert result["data"]["paused"] and runtime.pause == "AWAITING_APPROVAL"
    await runtime.checkpoint(runtime.pause)
    async with Reader(ctx.workspace / "check-paused") as reader:
        assert await reader.table("erp", "/", "payables") == ctx.baseline["payables"]
    card = ctx.store.run(ctx.run_id)["approvals"][0]
    ctx.store.decide(ctx.run_id, card["id"], "approve")
    await ctx.browser.close()
    ctx.browser = BrowserSession(ctx.workspace / "unused-cleanup")
    resumed = Runtime(Store(ctx.store.root), ctx.run_id)
    await resumed.browser.start(restore=True)
    try:
        await resumed.browser.restore(resumed.state["browser"])
        await resumed.browser.observe()
        args = {"element_id": await control(resumed, "Create payable")}
        assert (await resumed.execute("browser_click", args))["ok"]
        assert (await Verifier().verify(resumed, {"criteria": {"invoice": {"source_pdf": pdf}}}))[
            "outcome"
        ] == "VERIFIED"
    finally:
        await resumed.browser.close()


async def test_actual_chaos_changes_labels_and_classifies_failures(tmp_path, live_apps):
    path = ROOT / "mock_company" / "chaos.json"
    original = path.read_text(encoding="utf-8-sig")
    from types import SimpleNamespace

    ctx = SimpleNamespace(browser=BrowserSession(tmp_path), workspace=tmp_path, memory={}, evidence={})
    await ctx.browser.start()
    try:
        path.write_text(
            json.dumps(
                {
                    "enabled": True,
                    "failure_rate": 0,
                    "latency_rate": 0,
                    "expire_rate": 0,
                    "rename": True,
                    "reorder": True,
                }
            ),
            encoding="utf-8",
        )
        await invoke(ctx, "browser_navigate", {"url": APPS["erp"] + "/login"})
        for label, field in [("Username", "username"), ("Password", "password")]:
            await invoke(
                ctx, "browser_type", {"element_id": await control(ctx, label), "text": f"$erp_creds.{field}"}
            )
        assert (await invoke(ctx, "browser_click", {"element_id": await control(ctx, "Continue")}))["ok"]
        await invoke(ctx, "browser_navigate", {"url": APPS["erp"] + "/payables/new"})
        result = await invoke(ctx, "browser_observe", {})
        labels = [e["label"] for e in result["data"]["elements"]]
        assert "Save entry" in labels and "Total payable INR" in labels
        assert labels.index("Notes") < labels.index("Vendor")
        path.write_text(json.dumps({"enabled": True, "failure_rate": 1}), encoding="utf-8")
        assert (await invoke(ctx, "browser_navigate", {"url": APPS["erp"] + "/"}))[
            "error_type"
        ] == "TRANSIENT"
        path.write_text(
            json.dumps({"enabled": True, "failure_rate": 0, "latency_rate": 0, "expire_rate": 1}),
            encoding="utf-8",
        )
        assert (await invoke(ctx, "browser_navigate", {"url": APPS["erp"] + "/"}))[
            "error_type"
        ] == "AUTH_EXPIRED"
    finally:
        path.write_text(original, encoding="utf-8")
        await ctx.browser.close()
