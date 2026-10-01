"""Three independent HTML applications; all mutations are ordinary CSRF-protected forms."""

import asyncio
import json
import os
import random
import re
import secrets
import sqlite3
from datetime import date
from decimal import Decimal, InvalidOperation

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from starlette.middleware.sessions import SessionMiddleware
from starlette.responses import Response

from mock_company.db import DATA, DRIVE, ROOT, connect, query

TEMPLATES = Jinja2Templates(directory=str(ROOT / "mock_company" / "templates"))


def chaos_config() -> dict:
    """Read the live chaos configuration on every request."""
    try:
        cfg = json.loads((ROOT / "mock_company" / "chaos.json").read_text(encoding="utf-8-sig"))
    except (ValueError, OSError):
        cfg = {}
    cfg["enabled"] = cfg.get("enabled", False) or os.getenv("OPSAGENT_CHAOS") == "1"
    return cfg


def create_app(kind: str) -> FastAPI:
    """Create one sandbox app with its own DB and cookie namespace."""
    app = FastAPI(title=f"Acme {kind.title()}")
    DATA.mkdir(parents=True, exist_ok=True)
    secret_file = DATA / f"{kind}.session-key"
    if not secret_file.exists():
        secret_file.write_text(secrets.token_hex(32))
    app.add_middleware(
        SessionMiddleware,
        secret_key=secret_file.read_text(),
        session_cookie=f"{kind}_session",
        same_site="strict",
    )

    @app.middleware("http")
    async def chaos(request: Request, call_next) -> Response:
        path = request.url.path
        owned = {
            "portal": ("/invoices",),
            "erp": ("/payables", "/vendors"),
            "mail": ("/inbox", "/sent", "/messages", "/compose"),
        }
        if path not in ("/", "/login", "/health") and not any(
            path.startswith(prefix) for prefix in owned[kind]
        ):
            return HTMLResponse("Not found", status_code=404)
        cfg = chaos_config()
        request.state.chaos = cfg
        if cfg["enabled"] and request.url.path != "/health":
            if random.random() < cfg.get("failure_rate", 0.2):
                return HTMLResponse("Temporary service disruption. Retry this page.", status_code=503)
            if random.random() < cfg.get("latency_rate", 0.25):
                await asyncio.sleep(random.uniform(1, 3))
            if request.cookies.get(f"{kind}_session") and random.random() < cfg.get("expire_rate", 0.08):
                response = RedirectResponse("/login?expired=1", status_code=303)
                response.delete_cookie(f"{kind}_session")
                return response
        return await call_next(request)

    def render(request: Request, page: str, **values) -> HTMLResponse:
        cfg = getattr(request.state, "chaos", {})
        request.session.setdefault("csrf", secrets.token_hex(24))
        return TEMPLATES.TemplateResponse(
            request=request,
            name="app.html",
            context={
                "kind": kind,
                "page": page,
                "csrf": request.session["csrf"],
                "rename": cfg.get("enabled") and cfg.get("rename"),
                "reorder": cfg.get("enabled") and cfg.get("reorder"),
                **values,
            },
        )

    def auth(request: Request) -> Response | None:
        if not request.session.get("user"):
            return RedirectResponse("/login", status_code=303)
        return None

    async def form(request: Request) -> dict:
        fields = dict(await request.form())
        if not secrets.compare_digest(str(fields.pop("csrf", "")), request.session.get("csrf", "invalid")):
            return {"_error": "Invalid CSRF token. Reload the form."}
        return fields

    @app.get("/health")
    async def health() -> dict:
        return {"ok": True, "app": kind}

    @app.get("/login")
    async def login_page(request: Request) -> Response:
        return render(
            request,
            "login",
            error="Session expired. Please sign in again." if request.query_params.get("expired") else "",
        )

    @app.post("/login")
    async def login(request: Request) -> Response:
        fields = await form(request)
        if fields.get("username") == "demo" and fields.get("password") == "demo" and "_error" not in fields:
            request.session["user"] = "demo"
            return RedirectResponse("/", status_code=303)
        return render(request, "login", error=fields.get("_error", "Incorrect username or password."))

    @app.get("/")
    async def home(request: Request) -> Response:
        if denied := auth(request):
            return denied
        search = request.query_params.get("search", "").strip()
        page = max(
            1,
            int(request.query_params.get("page", "1"))
            if request.query_params.get("page", "1").isdigit()
            else 1,
        )
        if kind == "portal":
            status = request.query_params.get("status", "")
            rows = query(
                kind,
                'SELECT * FROM invoices WHERE (vendor LIKE ? OR invoice_no LIKE ?) AND (?="" OR status=?) ORDER BY id ASC',
                (f"%{search}%", f"%{search}%", status, status),
            )
            return render(
                request,
                "invoices",
                rows=rows[(page - 1) * 5 : page * 5],
                total=len(rows),
                number=page,
                search=search,
                status=status,
            )
        if kind == "erp":
            rows = query(
                kind,
                "SELECT * FROM payables WHERE vendor LIKE ? OR invoice_no LIKE ? ORDER BY id",
                (f"%{search}%", f"%{search}%"),
            )
            return render(request, "payables", rows=rows, search=search)
        return RedirectResponse("/inbox", status_code=303)

    @app.get("/invoices/{invoice_id}")
    async def invoice(request: Request, invoice_id: int) -> Response:
        if denied := auth(request):
            return denied
        rows = query(kind, "SELECT * FROM invoices WHERE id=?", (invoice_id,)) if kind == "portal" else []
        if not rows:
            return HTMLResponse("Not found", status_code=404)
        return render(request, "invoice", row=rows[0])

    @app.get("/invoices/{invoice_id}/pdf")
    async def pdf(request: Request, invoice_id: int) -> Response:
        if denied := auth(request):
            return denied
        rows = query(kind, "SELECT * FROM invoices WHERE id=?", (invoice_id,)) if kind == "portal" else []
        if not rows:
            return HTMLResponse("Not found", status_code=404)
        return FileResponse(
            DRIVE / "invoices" / rows[0]["pdf"], media_type="application/pdf", filename=rows[0]["pdf"]
        )

    @app.get("/payables/new")
    async def new_payable(request: Request) -> Response:
        if denied := auth(request):
            return denied
        return render(
            request, "new_payable", vendors=query("erp", "SELECT * FROM vendors"), values={}, error=""
        )

    @app.post("/payables/new")
    async def save_payable(request: Request) -> Response:
        if denied := auth(request):
            return denied
        values = await form(request)
        error = values.get("_error", "")
        try:
            vendor = values.get("vendor", "")
            if not query("erp", "SELECT id FROM vendors WHERE name=?", (vendor,)):
                raise ValueError("Select a valid vendor.")
            invoice_no = str(values.get("invoice_no", "")).strip()
            if not invoice_no:
                raise ValueError("Invoice number is required.")
            amount = Decimal(str(values.get("amount", "")))
            if not amount.is_finite() or amount <= 0 or amount.as_tuple().exponent < -2:
                raise ValueError("Amount must be positive with at most two decimal places.")
            due = date.fromisoformat(str(values.get("due", ""))).isoformat()
            if not error:
                with connect("erp") as db:
                    db.execute(
                        "INSERT INTO payables(vendor,invoice_no,amount_paise,due,status,entered_by,notes) VALUES (?,?,?,?,?,?,?)",
                        (vendor, invoice_no, int(amount * 100), due, "open", "demo", values.get("notes", "")),
                    )
                return RedirectResponse("/", status_code=303)
        except sqlite3.IntegrityError:
            error = "Duplicate payable: vendor and invoice number already exist."
        except (ValueError, InvalidOperation):
            error = "Valid vendor, invoice number, positive amount and due date (YYYY-MM-DD) are required."
        return render(
            request, "new_payable", vendors=query("erp", "SELECT * FROM vendors"), values=values, error=error
        )

    @app.get("/vendors")
    async def vendors(request: Request) -> Response:
        if denied := auth(request):
            return denied
        return render(request, "vendors", rows=query("erp", "SELECT * FROM vendors"))

    @app.get("/vendors/{vendor_id}/edit")
    async def edit_vendor(request: Request, vendor_id: int) -> Response:
        if denied := auth(request):
            return denied
        rows = query("erp", "SELECT * FROM vendors WHERE id=?", (vendor_id,))
        if not rows:
            return HTMLResponse("Not found", status_code=404)
        return render(request, "edit_vendor", row=rows[0], error="")

    @app.post("/vendors/{vendor_id}/edit")
    async def update_vendor(request: Request, vendor_id: int) -> Response:
        if denied := auth(request):
            return denied
        values = await form(request)
        if "_error" in values or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", str(values.get("email", ""))):
            row = query("erp", "SELECT * FROM vendors WHERE id=?", (vendor_id,))[0]
            row.update(values)
            return render(
                request,
                "edit_vendor",
                row=row,
                error=values.get("_error", "A valid billing contact email is required."),
            )
        with connect("erp") as db:
            db.execute(
                "UPDATE vendors SET email=?, phone=?, notes=? WHERE id=?",
                (values["email"], values.get("phone", ""), values.get("notes", ""), vendor_id),
            )
        return RedirectResponse("/vendors", status_code=303)

    @app.get("/inbox")
    @app.get("/sent")
    async def messages(request: Request) -> Response:
        if denied := auth(request):
            return denied
        folder = request.url.path.strip("/")
        return render(
            request,
            "messages",
            folder=folder,
            rows=query("mail", "SELECT * FROM messages WHERE folder=? ORDER BY id DESC", (folder,)),
        )

    @app.get("/messages/{message_id}")
    async def message(request: Request, message_id: int) -> Response:
        if denied := auth(request):
            return denied
        rows = query("mail", "SELECT * FROM messages WHERE id=?", (message_id,))
        if not rows:
            return HTMLResponse("Not found", status_code=404)
        return render(request, "message", row=rows[0])

    @app.get("/compose")
    async def compose(request: Request) -> Response:
        if denied := auth(request):
            return denied
        return render(request, "compose", values={}, error="")

    @app.post("/compose")
    async def send(request: Request) -> Response:
        if denied := auth(request):
            return denied
        values = await form(request)
        if (
            "_error" in values
            or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", str(values.get("to", "")))
            or not values.get("subject")
            or not values.get("body")
        ):
            return render(
                request,
                "compose",
                values=values,
                error=values.get("_error", "Recipient, subject and body are required."),
            )
        with connect("mail") as db:
            db.execute(
                "INSERT INTO messages(folder,sender,recipient,subject,body) VALUES (?,?,?,?,?)",
                ("sent", "finance@acme.test", values["to"], values["subject"], values["body"]),
            )
        return RedirectResponse("/sent", status_code=303)

    return app
