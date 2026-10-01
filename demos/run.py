"""Run all five real CLI demonstrations; a simulated human answers only approval/question cards."""

import json
import subprocess
import sys
from datetime import datetime

import yaml

from agent.config import ROOT


def main() -> None:
    """Record actual exit statuses without substituting canned agent actions."""
    tasks = yaml.safe_load((ROOT / "demos" / "tasks.yaml").read_text(encoding="utf-8-sig"))
    results = []
    for task in tasks:
        print(f"Running {task['id']}…", flush=True)
        command = [
            sys.executable,
            "-m",
            "agent",
            "run",
            task["request"],
            "--simulated-human",
            str(ROOT / "demos" / "human.json"),
        ]
        process = subprocess.run(
            command, cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace"
        )
        results.append(
            {
                "id": task["id"],
                "request": task["request"],
                "exit_code": process.returncode,
                "stdout": process.stdout,
                "stderr": process.stderr,
            }
        )
        print(f"Exit {process.returncode}", flush=True)
    output = ROOT / "demos" / "results.json"
    output.write_text(
        json.dumps(
            {"recorded_at": datetime.now().isoformat(), "results": results}, indent=2, ensure_ascii=False
        ),
        encoding="utf-8",
    )
    print(f"Actual CLI outputs saved to {output}")
    if any(row["exit_code"] for row in results):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
