"""Real LLM evaluations with isolated app data and independently checked SQL state."""

import argparse
import asyncio
import json
import os
import subprocess
import sys
import time
from datetime import date, datetime
from pathlib import Path
from statistics import mean

import httpx
import yaml

from agent.__main__ import drive
from agent.config import ROOT
from agent.llm import make_provider
from agent.store import Store
from evals.ground_truth import check, snapshot


def publish(mode: str, payload: dict) -> None:
    """Write machine-readable results and a combined honest normal/chaos summary."""
    directory = ROOT / "evals"
    (directory / f"results-{mode}.json").write_text(
        json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    lines = [
        "# Evaluation results",
        "",
        "Real provider evaluations only. Simulated humans answer cards; no scripted agent actions.",
        "",
    ]
    lines += [
        "| Mode | Status | Completed / requested | Task success | Verifier agreement | False VERIFIED | Avg steps | Avg tokens | Avg USD | Recoveries |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for name in ("normal", "chaos"):
        path = directory / f"results-{name}.json"
        if not path.exists():
            lines.append(
                f"| {name} | NOT RUN | 0 / — | unmeasured | unmeasured | unmeasured | — | — | — | — |"
            )
            continue
        data = json.loads(path.read_text(encoding="utf-8-sig"))
        metrics = data.get("metrics", {})
        lines.append(
            f"| {name} | {data['status']} | {len(data['runs'])} / {data['requested']} | {metrics.get('success_rate', 'unmeasured')} | {metrics.get('verifier_agreement', 'unmeasured')} | {metrics.get('false_verified', 'unmeasured')} | {metrics.get('avg_steps', '—')} | {metrics.get('avg_tokens', '—')} | {metrics.get('avg_cost_usd', 'unknown')} | {metrics.get('recoveries', '—')} |"
        )
        if data.get("blocked_reason"):
            lines += ["", f"{name}: {data['blocked_reason']}", ""]
    lines += [
        "",
        "Full results: `results-normal.json`, `results-chaos.json`. Trace and report artifacts for completed runs are under `evals/artifacts/`.",
        "",
        f"Updated: {datetime.now().isoformat(timespec='seconds')} (local time).",
    ]
    (directory / "results.md").write_text("\n".join(lines), encoding="utf-8")


async def evaluate(tasks: list[dict], repeats: int, mode: str, data: Path) -> dict:
    """Reset only isolated fixtures before each task and run the real agent serially."""
    records = []
    store = Store(ROOT / "evals" / "artifacts" / mode)
    env = {**os.environ, "OPSAGENT_DATA_DIR": str(data)}
    for iteration in range(repeats):
        for task in tasks:
            subprocess.run(
                [sys.executable, "seed.py", "--reset"], cwd=ROOT, env=env, check=True, capture_output=True
            )
            before = snapshot(data)
            run_id = store.create(task["request"])
            print(f"{mode} {iteration + 1}: {task['id']}", flush=True)
            result = await drive(store, run_id, task["human"], interactive=False)
            report = store.run(run_id)["report"] or result
            truth = check(task, before, snapshot(data), report, date.today())
            verified = report.get("outcome") == "VERIFIED"
            expected_verified = task["check"].get("expect_verified", True)
            success = truth["passed"] and (verified if expected_verified else not verified)
            records.append(
                {
                    "task_id": task["id"],
                    "iteration": iteration + 1,
                    "run_id": run_id,
                    "outcome": report.get("outcome"),
                    "ground_truth": truth,
                    "success": success,
                    "verifier_agrees": verified == (truth["passed"] and expected_verified),
                    "false_verified": verified and not truth["passed"],
                    "steps": report.get("steps", 0),
                    "input_tokens": report.get("input_tokens", 0),
                    "output_tokens": report.get("output_tokens", 0),
                    "cost_usd": report.get("cost_usd"),
                    "recoveries": report.get("recoveries", 0),
                }
            )
    costs = [r["cost_usd"] for r in records if r["cost_usd"] is not None]
    return {
        "status": "COMPLETED",
        "recorded_at": datetime.now().isoformat(),
        "requested": len(tasks) * repeats,
        "runs": records,
        "metrics": {
            "success_rate": f"{sum(r['success'] for r in records)}/{len(records)}",
            "verifier_agreement": f"{sum(r['verifier_agrees'] for r in records)}/{len(records)}",
            "false_verified": sum(r["false_verified"] for r in records),
            "avg_steps": round(mean(r["steps"] for r in records), 2),
            "avg_tokens": round(mean(r["input_tokens"] + r["output_tokens"] for r in records), 2),
            "avg_cost_usd": round(mean(costs), 6) if len(costs) == len(records) else "unknown",
            "recoveries": sum(r["recoveries"] for r in records),
        },
    }


def main() -> None:
    """Preflight provider/ports, start isolated apps, evaluate and restore chaos config."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--chaos", action="store_true")
    parser.add_argument("--repeats", type=int, default=int(os.getenv("OPSAGENT_EVAL_REPEATS", "1")))
    parser.add_argument("--task", help="Run only one task id")
    args = parser.parse_args()
    if args.repeats < 1:
        parser.error("--repeats must be positive")
    mode = "chaos" if args.chaos else "normal"
    tasks = yaml.safe_load((ROOT / "evals" / "tasks.yaml").read_text(encoding="utf-8-sig"))["tasks"]
    if args.task:
        tasks = [t for t in tasks if t["id"] == args.task]
        if not tasks:
            parser.error("Unknown task id")
    try:
        make_provider()
    except Exception as exc:
        payload = {
            "status": "BLOCKED",
            "recorded_at": datetime.now().isoformat(),
            "requested": len(tasks) * args.repeats,
            "runs": [],
            "blocked_reason": str(exc),
        }
        publish(mode, payload)
        print(payload["blocked_reason"])
        raise SystemExit(2) from None
    for port in (8001, 8002, 8003):
        try:
            httpx.get(f"http://127.0.0.1:{port}/health", timeout=0.5, trust_env=False)
        except httpx.HTTPError:
            continue
        raise SystemExit(
            "Stop run_all.py before evaluation: the harness owns isolated apps on ports 8001–8003."
        )
    data = ROOT / ".scratch" / f"eval-{mode}"
    data.mkdir(parents=True, exist_ok=True)
    env = {**os.environ, "OPSAGENT_DATA_DIR": str(data), "OPSAGENT_CHAOS": "1" if args.chaos else "0"}
    subprocess.run([sys.executable, "seed.py", "--reset"], cwd=ROOT, env=env, check=True, capture_output=True)
    chaos_path = ROOT / "mock_company" / "chaos.json"
    original = chaos_path.read_text(encoding="utf-8-sig")
    chaos = json.loads(original)
    chaos["enabled"] = args.chaos
    chaos_path.write_text(json.dumps(chaos), encoding="utf-8")
    processes, logs = [], []
    try:
        for kind, port in [("portal", 8001), ("erp", 8002), ("mail", 8003)]:
            log = (data / f"{kind}.log").open("w")
            logs.append(log)
            processes.append(
                subprocess.Popen(
                    [sys.executable, "-m", "mock_company", kind, "--port", str(port)],
                    cwd=ROOT,
                    env=env,
                    stdout=log,
                    stderr=log,
                )
            )
        for _ in range(100):
            try:
                if all(
                    httpx.get(f"http://127.0.0.1:{p}/health", timeout=1, trust_env=False).status_code == 200
                    for p in (8001, 8002, 8003)
                ):
                    break
            except httpx.HTTPError:
                pass
            if any(p.poll() is not None for p in processes):
                raise RuntimeError("Evaluation app failed to start")
            time.sleep(0.15)
        else:
            raise RuntimeError("Evaluation apps did not become ready")
        result = asyncio.run(evaluate(tasks, args.repeats, mode, data))
        publish(mode, result)
        print(json.dumps(result["metrics"], indent=2))
        if any(not row["success"] or row["false_verified"] for row in result["runs"]):
            raise SystemExit(1)
    finally:
        for process in processes:
            process.terminate()
        for process in processes:
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
        for log in logs:
            log.close()
        chaos_path.write_text(original, encoding="utf-8")


if __name__ == "__main__":
    main()
