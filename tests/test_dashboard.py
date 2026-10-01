"""Dashboard cards, CSRF enforcement, history and artifact access acceptance."""

import re

import httpx

from agent.store import Store
from dashboard.app import create_dashboard


async def test_dashboard(tmp_path):
    store = Store(tmp_path)
    app = create_dashboard(store, worker=False)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/")
        assert "Control room" in response.text
        csrf = re.search(r'name="csrf" content="([^"]+)"', response.text)[1]
        headers = {"X-CSRF-Token": csrf}
        assert (await client.post("/api/runs", json={"task": "Task"})).status_code == 403
        run_id = (
            await client.post("/api/runs", headers=headers, json={"task": "Process an invoice"})
        ).json()["id"]
        assert (await client.get("/api/runs/" + run_id)).json()["status"] == "QUEUED"
        assert len((await client.get("/api/runs")).json()) == 1
        card = store.approval(
            run_id,
            "exact",
            {
                "action": {"operation": "send", "values": {"to": "finance@acme.test"}},
                "reason": "Approval required",
                "sop": "sops/reporting.md",
            },
        )
        response = await client.post(
            f"/api/runs/{run_id}/decision",
            headers=headers,
            json={"card_id": card["id"], "decision": "approve"},
        )
        assert response.status_code == 200
        question = store.question(run_id, "Due date?")
        response = await client.post(
            f"/api/runs/{run_id}/decision",
            headers=headers,
            json={"card_id": question["id"], "decision": "2026-12-31", "question": True},
        )
        assert response.status_code == 200
        assert store.run(run_id)["questions"][0]["answer"] == "2026-12-31"
        (tmp_path / run_id / "browser-state.json").write_text('{"cookies":[]}')
        assert (await client.get(f"/artifacts/{run_id}/browser-state.json")).status_code == 404
        assert (await client.get("/api/runs/missing")).status_code == 404
        assert (await client.get("/history")).status_code == 200
        assert (await client.get("/static/dashboard.css")).status_code == 200
        assert (await client.get("/static/dashboard.js")).status_code == 200
