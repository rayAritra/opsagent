"""Dashboard cards, CSRF enforcement, history and artifact access acceptance."""

import re

from fastapi.testclient import TestClient

from agent.store import Store
from dashboard.app import create_dashboard


def test_dashboard(tmp_path):
    store = Store(tmp_path)
    with TestClient(create_dashboard(store, worker=False)) as client:
        response = client.get("/")
        assert "Control room" in response.text
        csrf = re.search(r'name="csrf" content="([^"]+)"', response.text)[1]
        headers = {"X-CSRF-Token": csrf}
        assert client.post("/api/runs", json={"task": "Task"}).status_code == 403
        run_id = client.post("/api/runs", headers=headers, json={"task": "Process an invoice"}).json()["id"]
        assert client.get("/api/runs/" + run_id).json()["status"] == "QUEUED"
        assert len(client.get("/api/runs").json()) == 1
        card = store.approval(
            run_id,
            "exact",
            {
                "action": {"operation": "send", "values": {"to": "finance@acme.test"}},
                "reason": "Approval required",
                "sop": "sops/reporting.md",
            },
        )
        response = client.post(
            f"/api/runs/{run_id}/decision",
            headers=headers,
            json={"card_id": card["id"], "decision": "approve"},
        )
        assert response.status_code == 200
        question = store.question(run_id, "Due date?")
        assert (
            client.post(
                f"/api/runs/{run_id}/decision",
                headers=headers,
                json={"card_id": question["id"], "decision": "2026-12-31", "question": True},
            ).status_code
            == 200
        )
        assert store.run(run_id)["questions"][0]["answer"] == "2026-12-31"
        (tmp_path / run_id / "browser-state.json").write_text('{"cookies":[]}')
        assert client.get(f"/artifacts/{run_id}/browser-state.json").status_code == 404
        assert client.get("/api/runs/missing").status_code == 404
        assert client.get("/history").status_code == 200
        assert client.get("/static/dashboard.css").status_code == 200
        assert client.get("/static/dashboard.js").status_code == 200
