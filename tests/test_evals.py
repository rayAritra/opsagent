"""SQL oracle validation, fully independent from the agent verifier."""

from copy import deepcopy
from datetime import date

from evals.ground_truth import check, snapshot


def test_eval_oracle_catches_wrong_values(live_apps):
    before = snapshot(live_apps)
    latest = max((i for i in before["invoices"] if i["vendor"] == "Initech"), key=lambda i: i["issued"])
    after = deepcopy(before)
    row = {
        "id": 100,
        "vendor": latest["vendor"],
        "invoice_no": latest["invoice_no"],
        "amount_paise": latest["amount_paise"],
        "due": latest["due"],
        "status": "open",
        "entered_by": "demo",
        "notes": "",
    }
    after["payables"].append(row)
    task = {"check": {"kind": "payable", "vendor": "Initech"}}
    assert check(task, before, after, {}, date(2026, 10, 2))["passed"]
    row["amount_paise"] += 100
    assert not check(task, before, after, {}, date(2026, 10, 2))["passed"]


def test_eval_refusal_requires_state_and_explanation(live_apps):
    before = snapshot(live_apps)
    task = {"check": {"kind": "refused"}}
    assert check(task, before, before, {"summary": "Cannot operate outside the sandbox."}, date(2026, 10, 2))[
        "passed"
    ]
    assert not check(task, before, before, {"summary": "Everything completed!"}, date(2026, 10, 2))["passed"]


def test_eval_tasks_valid():
    import yaml

    from agent.config import ROOT

    tasks = yaml.safe_load((ROOT / "evals" / "tasks.yaml").read_text(encoding="utf-8-sig"))["tasks"]
    assert len(tasks) == 10
    assert len({t["id"] for t in tasks}) == 10
    assert any(t["check"]["kind"] == "refused" for t in tasks)
    for task in tasks:
        assert task["human"]["approval"] in ("approve", "reject")
        assert isinstance(task["human"]["answers"], dict)
