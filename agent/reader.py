"""Fresh browser readback used by policy and verifier, independent of agent memory."""

import asyncio
from pathlib import Path

from agent.browser import BrowserSession
from agent.config import APPS
from agent.credentials import CREDENTIALS
from agent.tool_registry import ToolFailure


class Reader:
    """Read real HTML tables and messages in a separate signed-in browser context."""

    def __init__(self, workspace: Path) -> None:
        self.browser = BrowserSession(workspace)

    async def __aenter__(self) -> "Reader":
        await self.browser.start()
        return self

    async def __aexit__(self, *args) -> None:
        await self.browser.close()

    async def visit(self, app: str, path: str = "/") -> None:
        """Navigate with bounded service/session recovery, then capture evidence."""
        last = None
        for attempt in range(4):
            try:
                response = await self.browser.page.goto(APPS[app] + path)
                if response.status >= 500:
                    raise ToolFailure("TRANSIENT", f"Readback HTTP {response.status}")
                if "/login" in self.browser.page.url:
                    creds = CREDENTIALS[f"{app}_creds"]
                    await self.browser.page.locator("[name=username]").fill(creds["username"])
                    await self.browser.page.locator("[name=password]").fill(creds["password"])
                    await self.browser.page.locator("button[type=submit]").click()
                    response = await self.browser.page.goto(APPS[app] + path)
                    await self.browser.check_response(response)
                await self.browser.observe()
                return
            except Exception as exc:
                last = exc
                await asyncio.sleep(0.15 * 2**attempt)
        raise ToolFailure("TRANSIENT", f"Independent readback unavailable: {last}")

    async def table(self, app: str, path: str, table: str) -> list[dict]:
        """Read displayed table cells, keeping column names for deterministic comparison."""
        await self.visit(app, path)
        return await self.browser.page.locator(f'table[data-table="{table}"] tbody tr').evaluate_all(
            """rows=>rows.map(r=>Object.fromEntries([...r.querySelectorAll('[data-col]')].map(c=>[c.dataset.col,c.innerText.trim()])))"""
        )

    async def mail(self, folder: str) -> list[dict]:
        """Read every listed message detail, including the full sent body."""
        await self.visit("mail", "/" + folder)
        paths = await self.browser.page.locator("table tbody a").evaluate_all(
            'es=>es.map(e=>e.getAttribute("href"))'
        )
        rows = []
        for path in paths:
            await self.visit("mail", path)
            row = await self.browser.page.locator("[data-col]").evaluate_all(
                "es=>Object.fromEntries(es.map(e=>[e.dataset.col,e.innerText.trim()]))"
            )
            row["path"] = path
            rows.append(row)
        return rows

    async def state(self) -> dict:
        """Capture all ERP records and mail for an independent state baseline."""
        return {
            "payables": await self.table("erp", "/", "payables"),
            "vendors": await self.table("erp", "/vendors", "vendors"),
            "inbox": await self.mail("inbox"),
            "sent": await self.mail("sent"),
        }

    async def invoices(self) -> list[dict]:
        """Traverse real portal pagination rather than assume first-page ordering."""
        rows = []
        page = 1
        while page <= 100:
            await self.visit("portal", f"/?page={page}")
            records = await self.browser.page.locator("table tbody tr").evaluate_all(
                """es=>es.map(r=>({...Object.fromEntries([...r.querySelectorAll('[data-col]')].map(c=>[c.dataset.col,c.innerText.trim()])),path:r.querySelector('a')?.getAttribute('href')}))"""
            )
            rows.extend(records)
            if not records or len(records) < 5:
                break
            page += 1
        return rows

    async def invoice_document(self, record: dict) -> Path:
        """Download source evidence through a fresh browser's document link."""
        await self.visit("portal", record["path"])
        async with self.browser.page.expect_download() as event:
            await self.browser.page.locator("a[download]").click()
        download = await event.value
        path = self.browser.workspace / Path(download.suggested_filename).name
        await download.save_as(str(path))
        return path
