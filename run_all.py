"""Start all real sandbox apps and the dashboard; stop children cleanly on Ctrl+C."""

import argparse
import subprocess
import sys
import time

import httpx

from agent.config import ROOT, RUNS
from seed import seed


def main() -> None:
    """Seed idempotently, launch four servers and monitor their health."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--chaos", action="store_true")
    args = parser.parse_args()
    seed()
    if args.chaos:
        import json

        config = ROOT / "mock_company" / "chaos.json"
        cfg = json.loads(config.read_text(encoding="utf-8-sig"))
        cfg["enabled"] = True
        config.write_text(json.dumps(cfg), encoding="utf-8")
    RUNS.mkdir(exist_ok=True)
    processes, logs = [], []
    try:
        commands = [("dashboard", [sys.executable, "-m", "dashboard"])] + [
            (kind, [sys.executable, "-m", "mock_company", kind, "--port", str(port)])
            for kind, port in [("portal", 8001), ("erp", 8002), ("mail", 8003)]
        ]
        for name, command in commands:
            log = (RUNS / f"{name}.server.log").open("a", encoding="utf-8")
            logs.append(log)
            processes.append(subprocess.Popen(command, cwd=ROOT, stdout=log, stderr=log))
        for _ in range(100):
            if any(p.poll() is not None for p in processes):
                raise RuntimeError(
                    "A server exited. Inspect runs/*.server.log; ports 8000–8003 must be available."
                )
            try:
                if all(
                    httpx.get(f"http://127.0.0.1:{p}/health", timeout=1, trust_env=False).status_code == 200
                    for p in range(8000, 8004)
                ):
                    break
            except httpx.HTTPError:
                pass
            time.sleep(0.15)
        else:
            raise RuntimeError("Servers did not become ready; inspect runs/*.server.log")
        print("OpsAgent ready: http://127.0.0.1:8000", flush=True)
        print("Sandbox apps: portal 8001 / ERP 8002 / mail 8003 · login demo / demo", flush=True)
        print("Ctrl+C stops all four servers.", flush=True)
        while all(p.poll() is None for p in processes):
            time.sleep(0.5)
        raise RuntimeError("A server stopped unexpectedly; inspect runs/*.server.log")
    except KeyboardInterrupt:
        print("\nStopping OpsAgent…")
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


if __name__ == "__main__":
    main()
