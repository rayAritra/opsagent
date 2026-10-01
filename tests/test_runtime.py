"""Policy, independent verifier, error recovery and durable resume contracts."""

from types import SimpleNamespace

import pytest

from agent.browser import BrowserSession, allowed_url
from agent.config import APPS
from agent.llm import Response
from agent.policy import Policy
from agent.reader import Reader
from agent.runtime import Runtime
from agent.store import Store
from agent.tool_registry import invoke
from agent.verifier import Verifier
from tests.test_tools import control, sign_in


@pytest.fixture
async def operation(tmp_path, live_apps):
    store = Store(tmp_path / "runs")
    run_id = store.create("Process latest invoice")
    workspace = store.root / run_id
    ctx = SimpleNamespace(
        store=store,
        run_id=run_id,
        workspace=workspace,
        browser=BrowserSession(workspace),
        memory={},
        evidence={},
        spec={"constraints": [], "success_criteria": []},
        task="Process latest invoice",
        today="2026-10-02",
        baseline={},
    )
    await ctx.browser.start()
    async with Reader(workspace / "baseline") as reader:
        ctx.baseline = await reader.state()
    yield ctx
    await ctx.browser.close()


async def source(ctx, vendor, invoice):
    await sign_in(ctx, "portal")
    await invoke(
        ctx, "browser_type", {"element_id": await control(ctx, "Search vendor or invoice"), "text": vendor}
    )
    await invoke(ctx, "browser_click", {"element_id": await control(ctx, "Search")})
    await invoke(ctx, "browser_click", {"element_id": await control(ctx, f"View {invoice}")})
    result = await invoke(ctx, "browser_download", {"element_id": await control(ctx, "Download PDF")})
    assert result["ok"], result
    assert (await invoke(ctx, "pdf_extract", {"path": result["data"]["path"]}))["ok"]
    return result["data"]["path"]


async def stage(ctx, vendor, invoice, amount, due):
    await sign_in(ctx, "erp")
    await invoke(ctx, "browser_navigate", {"url": APPS["erp"] + "/payables/new"})
    await invoke(ctx, "browser_select", {"element_id": await control(ctx, "Vendor"), "value": vendor})
    for label, value in [("Invoice number", invoice), ("Amount INR", amount), ("Due date", due)]:
        await invoke(ctx, "browser_type", {"element_id": await control(ctx, label), "text": value})
    return {"element_id": await control(ctx, "Create payable")}


@pytest.mark.parametrize(
    "url",
    [
        "https://example.com",
        "http://127.0.0.1:9999",
        "http://user:pass@localhost:8001",
        "http://127.0.0.1.evil.test:8001",
        "file:///etc/passwd",
        "http://localhost:bad",
    ],
)
def test_block_navigation(url):
    assert not allowed_url(url)


async def test_approval_and_verifier_reject_wrong_state(operation):
    ctx = operation
    pdf = await source(ctx, "Globex", "INV-01-004")
    args = await stage(ctx, "Globex Corporation", "INV-01-004", "72500.00", "2026-04-10")
    policy = Policy()
    action = await policy.inspect_action(ctx, "browser_click", args)
    decision = await policy.evaluate(ctx, action)
    assert decision["decision"] == "APPROVAL"
    assert decision["sop"] == "sops/invoice_processing.md"
    ctx.spec["success_criteria"] = [
        {
            "id": "invoice",
            "kind": "payable",
            "target": "Globex",
            "description": "Newest invoice exists with source-matching values",
        }
    ]
    claimed = {"criteria": {"invoice": {"source_pdf": pdf}}}
    wrong = await Verifier().verify(ctx, claimed)
    assert wrong["outcome"] == "FAILED"
    card = ctx.store.approval(ctx.run_id, decision["fingerprint"], decision)
    ctx.store.decide(ctx.run_id, card["id"], "approve")
    assert (await invoke(ctx, "browser_click", args))["ok"]
    right = await Verifier().verify(ctx, claimed)
    assert right["outcome"] == "VERIFIED", right
    assert right["criteria"][0]["evidence"]["expected"]["amount"] == "72500.00"
    # Editing the claimed amount cannot trick the verifier: it always reads the real PDF and table.
    claimed["criteria"]["invoice"]["amount"] = "1"
    assert (await Verifier().verify(ctx, claimed))["outcome"] == "VERIFIED"
    duplicate = await stage(ctx, "Globex Corporation", "INV-01-004", "72500.00", "2026-04-10")
    action = await policy.inspect_action(ctx, "browser_click", duplicate)
    assert (await policy.evaluate(ctx, action))["decision"] == "DENY"


async def test_missing_due_and_vendor_domain_policy(operation):
    ctx = operation
    await source(ctx, "Wayne", "INV-05-004")
    args = await stage(ctx, "Wayne Logistics", "INV-05-004", "21500.00", "2026-12-31")
    policy = Policy()
    action = await policy.inspect_action(ctx, "browser_click", args)
    assert (await policy.evaluate(ctx, action))["decision"] == "DENY"
    question = ctx.store.question(ctx.run_id, "What due date (YYYY-MM-DD)?")
    ctx.store.decide(ctx.run_id, question["id"], "2026-12-31", question=True)
    assert (await policy.evaluate(ctx, action))["decision"] == "ALLOW"
    await invoke(ctx, "browser_navigate", {"url": APPS["erp"] + "/vendors/2/edit"})
    for label, value in [
        ("Billing contact email", "collections@gmail.com"),
        ("Source email subject / notes", "URGENT billing update"),
    ]:
        await invoke(ctx, "browser_type", {"element_id": await control(ctx, label), "text": value})
    args = {"element_id": await control(ctx, "Save vendor")}
    action = await policy.inspect_action(ctx, "browser_click", args)
    assert (await policy.evaluate(ctx, action))["decision"] == "DENY"
    for label, value in [
        ("Billing contact email", "accounts@initech.test"),
        ("Source email subject / notes", "New billing contact"),
    ]:
        await invoke(ctx, "browser_type", {"element_id": await control(ctx, label), "text": value})
    action = await policy.inspect_action(
        ctx, "browser_click", {"element_id": await control(ctx, "Save vendor")}
    )
    assert (await policy.evaluate(ctx, action))["decision"] == "APPROVAL"
    await invoke(ctx, "browser_navigate", {"url": APPS["mail"] + "/login"})
    await sign_in(ctx, "mail")
    await invoke(ctx, "browser_navigate", {"url": APPS["mail"] + "/compose"})
    for label, value in [("To", "finance@acme.test"), ("Subject", "Report"), ("Body", "A report")]:
        await invoke(ctx, "browser_type", {"element_id": await control(ctx, label), "text": value})
    action = await policy.inspect_action(ctx, "browser_click", {"element_id": await control(ctx, "Send")})
    assert (await policy.evaluate(ctx, action))["decision"] == "APPROVAL"


def test_durable_human_decisions(tmp_path):
    first = Store(tmp_path)
    run_id = first.create("Task")
    card = first.approval(run_id, "fingerprint", {"action": {"amount": "50001"}})
    question = first.question(run_id, "Due date?")
    first.save(run_id, {"phase": "EXECUTE", "memory": {"source": "PDF"}}, "AWAITING_APPROVAL")
    second = Store(tmp_path)
    assert second.run(run_id)["state"]["memory"]["source"] == "PDF"
    second.decide(run_id, card["id"], "reject", "Do not submit")
    second.decide(run_id, question["id"], "2026-12-31", question=True)
    assert second.approval(run_id, "fingerprint", {})["decision"] == "reject"
    assert second.question(run_id, "Due date?")["answer"] == "2026-12-31"
    with pytest.raises(ValueError):
        second.decide(run_id, card["id"], "approve")


async def test_runtime_missing_key_is_honest(tmp_path, monkeypatch):
    def unavailable():
        raise RuntimeError("No API key configured")

    monkeypatch.setattr("agent.runtime.make_provider", unavailable)
    store = Store(tmp_path)
    run_id = store.create("Task")
    await Runtime(store, run_id).run()
    report = store.run(run_id)["report"]
    assert report["outcome"] == "FAILED"
    assert report["steps"] == 0
    assert report["input_tokens"] == 0
    assert "No API key" in report["summary"]
    assert (tmp_path / run_id / "report.md").exists()


async def test_transient_retry_and_replan(tmp_path, monkeypatch):
    store = Store(tmp_path)
    run_id = store.create("Task")
    runtime = Runtime(store, run_id)
    calls = []

    async def flaky(ctx, name, args):
        calls.append(name)
        return {"ok": len(calls) == 3, "data": {}, "error": "temporary", "error_type": "TRANSIENT"}

    async def instant(seconds):
        pass

    monkeypatch.setattr("agent.runtime.invoke", flaky)
    monkeypatch.setattr("agent.runtime.asyncio.sleep", instant)
    result = await runtime.execute("memory_get", {})
    assert result["ok"] and len(calls) == 3
    assert runtime.state["recoveries"] == 2
    replans = []

    async def llm(*args):
        replans.append(args[0])
        return Response(
            "submit_plan", {"steps": [{"intent": "Try a different approach", "status": "pending"}]}, "", 1, 1
        )

    runtime.llm = llm
    for _ in range(3):
        await runtime.recover(
            "files_read", {"path": "missing"}, {"error_type": "UNKNOWN", "error": "not found"}
        )
    assert replans == ["replan"]
    assert runtime.plan["steps"][0]["intent"] == "Try a different approach"


async def test_stale_and_auth_recovery(tmp_path, monkeypatch):
    store = Store(tmp_path)
    runtime = Runtime(store, store.create("Task"))

    async def observe():
        return {"elements": [{"id": 8, "label": "Username"}], "url": "login"}

    monkeypatch.setattr(runtime.browser, "observe", observe)
    for kind in ("ELEMENT_NOT_FOUND", "AUTH_EXPIRED"):
        await runtime.recover("browser_click", {"element_id": 1}, {"error_type": kind, "error": "failed"})
    assert runtime.observation["elements"][0]["id"] == 8
    assert runtime.state["recoveries"] == 2


def test_generalization():
    from agent.config import ROOT
    from seed import VENDORS

    for path in (ROOT / "agent").rglob("*.py"):
        text = path.read_text(encoding="utf-8-sig").lower()
        for name, _ in VENDORS:
            assert name.lower() not in text, f"Seeded vendor hard-coded in {path}"
        assert "http://" not in text and "https://" not in text, f"URL outside config: {path}"


async def test_runtime_question_pause_and_resume(tmp_path, live_apps):
    """A contract-only provider fixture tests durable lifecycle; it is never a product provider."""
    store = Store(tmp_path / "resume-runs")
    run_id = store.create("Ask for missing information then safely stop")

    class ContractProvider:
        def __init__(self):
            self.paused = False

        async def call(self, system, messages, tools, force=None):
            if force == "submit_spec":
                args = {
                    "outcome": "Clarify missing input without changes",
                    "task_type": "clarification",
                    "inputs_needed": ["due date"],
                    "constraints": [],
                    "success_criteria": [
                        {
                            "id": "state",
                            "kind": "unchanged",
                            "description": "No business records changed",
                            "target": "",
                        }
                    ],
                    "clarification": "",
                }
                return Response(force, args, "", 10, 10)
            if force == "submit_plan":
                return Response(
                    force,
                    {"steps": [{"intent": "Ask requester for missing date", "status": "pending"}]},
                    "",
                    10,
                    10,
                )
            if force == "judge":
                return Response(
                    force, {"satisfied": True, "explanation": "Fresh state unchanged"}, "", 10, 10
                )
            if force == "lesson":
                return Response(
                    force, {"lesson": "Ask for absent source fields before any mutation."}, "", 10, 10
                )
            if not self.paused:
                self.paused = True
                return Response("ask_human", {"question": "What due date (YYYY-MM-DD)?"}, "", 10, 10)
            return Response(
                "finish",
                {"summary": "Requester date recorded; no changes requested.", "claimed_outcome": {}},
                "",
                10,
                10,
            )

    provider = ContractProvider()
    await Runtime(store, run_id, provider).run()
    first = store.run(run_id)
    assert first["status"] == "AWAITING_ANSWER"
    assert first["state"]["phase"] == "EXECUTE"
    fresh_store = Store(store.root)
    fresh_store.decide(run_id, first["questions"][0]["id"], "2026-12-31", question=True)
    await Runtime(fresh_store, run_id, provider).run()
    final = fresh_store.run(run_id)
    assert final["status"] == "VERIFIED", final
    assert final["report"]["input_tokens"] == 60
    assert final["report"]["questions"][0]["answer"] == "2026-12-31"
    assert any(e["stage"] == "verifier" for e in final["events"] if e["kind"] == "llm")
