"""CLI with real human prompts or explicit evaluation-only simulated human answers."""

import argparse
import asyncio
import json

from agent.runtime import Runtime
from agent.store import Store


async def drive(store: Store, run_id: str, human: dict | None = None, interactive: bool = True) -> dict:
    """Advance durable pauses; simulated humans answer cards, never select agent actions."""
    for _ in range(30):
        await Runtime(store, run_id).run()
        row = store.run(run_id)
        if row["status"] not in ("AWAITING_APPROVAL", "AWAITING_ANSWER"):
            return row["report"]
        pending_approvals = [a for a in row["approvals"] if a["decision"] is None]
        pending_questions = [q for q in row["questions"] if q["answer"] is None]
        if not interactive and human is None:
            return {"outcome": row["status"], "run_id": run_id}
        for card in pending_approvals:
            if human is None:
                print(json.dumps(card["payload"], indent=2, ensure_ascii=False))
                answer = await asyncio.to_thread(input, "Approve this exact action? [y/N] ")
                decision = "approve" if answer.lower() == "y" else "reject"
            else:
                decision = human.get("approval", "reject")
            store.decide(
                run_id, card["id"], decision, "Simulated human (evaluation)" if human else "CLI decision"
            )
        for card in pending_questions:
            if human is None:
                answer = await asyncio.to_thread(input, card["question"] + " ")
            else:
                answer = next(
                    (
                        value
                        for key, value in human.get("answers", {}).items()
                        if key.lower() in card["question"].lower()
                    ),
                    "",
                )
                if not answer:
                    return {"outcome": "AWAITING_ANSWER", "run_id": run_id, "question": card["question"]}
            store.decide(run_id, card["id"], answer, question=True)
    return {"outcome": "PARTIAL", "run_id": run_id, "summary": "Too many human pauses; review manually."}


def main() -> None:
    """Run or resume a task; print artifact locations and honest exit status."""
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    run = sub.add_parser("run")
    run.add_argument("task")
    run.add_argument("--chaos", action="store_true")
    run.add_argument("--simulated-human", help="JSON file defining approval and answers; evaluation only")
    resume = sub.add_parser("resume")
    resume.add_argument("run_id")
    resume.add_argument("--simulated-human")
    args = parser.parse_args()
    if getattr(args, "chaos", False):
        from mock_company.apps import ROOT

        config = ROOT / "mock_company" / "chaos.json"
        chaos = json.loads(config.read_text(encoding="utf-8-sig"))
        chaos["enabled"] = True
        config.write_text(json.dumps(chaos), encoding="utf-8")
    human = None
    if args.simulated_human:
        from pathlib import Path

        human = json.loads(Path(args.simulated_human).read_text(encoding="utf-8-sig"))
    store = Store()
    run_id = store.create(args.task) if args.command == "run" else args.run_id
    report = asyncio.run(drive(store, run_id, human))
    print(json.dumps(report, indent=2, ensure_ascii=False))
    print(f"Artifacts: {store.root / run_id}")
    if report["outcome"] not in ("VERIFIED", "AWAITING_APPROVAL", "AWAITING_ANSWER"):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
