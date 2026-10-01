"""Start real sandbox servers on the configured ports for browser integration tests."""

import os
import subprocess
import sys
import time

import httpx
import pytest

from mock_company.db import ROOT


@pytest.fixture(scope="session")
def live_apps(tmp_path_factory):
    for port in (8001, 8002, 8003):
        try:
            httpx.get(f"http://127.0.0.1:{port}/health", timeout=0.3, trust_env=False)
        except httpx.HTTPError:
            continue
        pytest.fail("Stop run_all.py before tests; browser checks require exclusive sandbox ports.")
    data = tmp_path_factory.mktemp("live-app-data")
    env = {**os.environ, "OPSAGENT_DATA_DIR": str(data), "OPSAGENT_CHAOS": "0"}
    subprocess.run([sys.executable, "seed.py", "--reset"], cwd=ROOT, env=env, check=True, capture_output=True)
    processes = []
    logs = []
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
            if any(p.poll() is not None for p in processes):
                pytest.fail("Test app exited; inspect server logs in " + str(data))
            try:
                if all(
                    httpx.get(f"http://127.0.0.1:{port}/health", timeout=1, trust_env=False).status_code
                    == 200
                    for port in (8001, 8002, 8003)
                ):
                    break
            except httpx.HTTPError:
                pass
            time.sleep(0.1)
        else:
            pytest.fail("Sandbox servers did not start")
        yield data
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
