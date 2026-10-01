"""Local dashboard with a single durable browser worker and safe artifact routes."""

import asyncio
import contextlib
import json
import secrets
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field
from starlette.middleware.sessions import SessionMiddleware

from agent.config import ROOT
from agent.runtime import Runtime
from agent.store import Store


class TaskInput(BaseModel):
    task: str = Field(min_length=3, max_length=1500)


class Decision(BaseModel):
    card_id: str
    decision: str
    comment: str = ""
    question: bool = False


class ChaosInput(BaseModel):
    enabled: bool


def create_dashboard(store: Store | None = None, worker: bool = True) -> FastAPI:
    """Construct a loopback-only operator UI and persistent single-run queue."""
    store = store or Store()
    queue = asyncio.Queue()
    scheduled = set()
    templates = Jinja2Templates(directory=str(ROOT / "dashboard" / "templates"))

    async def consume():
        while True:
            run_id = await queue.get()
            try:
                await Runtime(store, run_id).run()
            finally:
                scheduled.discard(run_id)
                queue.task_done()

    def schedule(run_id: str):
        if worker and run_id not in scheduled:
            scheduled.add(run_id)
            queue.put_nowait(run_id)

    @asynccontextmanager
    async def lifespan(app):
        task = asyncio.create_task(consume()) if worker else None
        for row in store.history()[::-1]:
            if row["status"] in ("QUEUED", "RUNNING"):
                schedule(row["id"])
            elif row["status"] in ("AWAITING_ANSWER", "AWAITING_APPROVAL"):
                detail = store.run(row["id"])
                if all(a["decision"] for a in detail["approvals"]) and all(
                    q["answer"] for q in detail["questions"]
                ):
                    schedule(row["id"])
        yield
        if task:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    app = FastAPI(title="OpsAgent Control Room", lifespan=lifespan)
    key = store.root / "dashboard.session-key"
    if not key.exists():
        key.write_text(secrets.token_hex(32))
    app.add_middleware(
        SessionMiddleware, secret_key=key.read_text(), session_cookie="opsagent_dashboard", same_site="strict"
    )

    def get_run(run_id: str) -> dict:
        try:
            return store.run(run_id)
        except KeyError:
            raise HTTPException(404, "Unknown run") from None

    def guard(request: Request) -> None:
        token = request.headers.get("X-CSRF-Token", "")
        if not token or not secrets.compare_digest(token, request.session.get("csrf", "invalid")):
            raise HTTPException(403, "Reload the dashboard before submitting changes.")

    @app.get("/health")
    async def health():
        return {"ok": True}

    @app.get("/", response_class=HTMLResponse)
    @app.get("/history", response_class=HTMLResponse)
    @app.get("/runs/{run_id}", response_class=HTMLResponse)
    async def home(request: Request, run_id: str = ""):
        if run_id:
            get_run(run_id)
        request.session.setdefault("csrf", secrets.token_hex(24))
        return templates.TemplateResponse(
            request=request,
            name="dashboard.html",
            context={
                "run_id": run_id,
                "csrf": request.session["csrf"],
                "history": request.url.path == "/history",
            },
        )

    @app.get("/static/{name}")
    async def static(name: str):
        if name not in ("dashboard.css", "dashboard.js"):
            raise HTTPException(404)
        return FileResponse(ROOT / "dashboard" / "static" / name)

    @app.get("/api/config")
    async def config():
        cfg = json.loads((ROOT / "mock_company" / "chaos.json").read_text(encoding="utf-8-sig"))
        return {"chaos": cfg.get("enabled", False)}

    @app.post("/api/chaos")
    async def chaos(request: Request, payload: ChaosInput):
        guard(request)
        path = ROOT / "mock_company" / "chaos.json"
        cfg = json.loads(path.read_text(encoding="utf-8-sig"))
        cfg["enabled"] = payload.enabled
        path.write_text(json.dumps(cfg, indent=2), encoding="utf-8")
        return {"chaos": cfg["enabled"]}

    @app.get("/api/runs")
    async def history():
        return store.history()

    @app.post("/api/runs")
    async def start(request: Request, payload: TaskInput):
        guard(request)
        run_id = store.create(payload.task.strip())
        schedule(run_id)
        return {"id": run_id}

    @app.get("/api/runs/{run_id}")
    async def detail(run_id: str):
        row = get_run(run_id)
        # Never expose stored signed-session cookies; only a non-secret page URL/draft is in state.
        return row

    @app.post("/api/runs/{run_id}/decision")
    async def decision(request: Request, run_id: str, payload: Decision):
        guard(request)
        get_run(run_id)
        try:
            store.decide(run_id, payload.card_id, payload.decision, payload.comment, payload.question)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from None
        row = store.run(run_id)
        if all(a["decision"] for a in row["approvals"]) and all(q["answer"] for q in row["questions"]):
            schedule(run_id)
        return {"ok": True}

    @app.get("/artifacts/{run_id}/{name:path}")
    async def artifact(run_id: str, name: str):
        get_run(run_id)
        root = (store.root / run_id).resolve()
        path = (root / name).resolve()
        if (
            root not in path.parents
            or not path.is_file()
            or path.name == "browser-state.json"
            or path.suffix not in (".png", ".pdf", ".md", ".json", ".jsonl")
        ):
            raise HTTPException(404)
        if path.suffix == ".json" and path.name != "report.json":
            raise HTTPException(404)
        return FileResponse(path, filename=path.name if path.suffix in (".jsonl", ".md", ".json") else None)

    return app
