"""Browser session and compact DOM perception; no raw HTML enters LLM context."""

import os
import re
from pathlib import Path
from urllib.parse import urlparse

from playwright.async_api import async_playwright

from agent.config import POLICIES, ROOT
from agent.tool_registry import ToolFailure

DOM = """() => {
 const els=[...document.querySelectorAll('a,button,input:not([type=hidden]),textarea,select')].filter(e=>e.getClientRects().length && !e.disabled);
 return els.map((e,i)=>{
   e.setAttribute('data-ops-id',String(i+1));
   const label=e.labels?.[0]?.innerText || e.getAttribute('aria-label') || e.innerText || e.placeholder || e.name;
   return {id:i+1, tag:e.tagName.toLowerCase(), role:e.getAttribute('role') || e.type || e.tagName.toLowerCase(),
     label:label?.trim().slice(0,180), value:e.type==='password'?'[REDACTED]':e.value,
     options:e.tagName==='SELECT'?[...e.options].map(o=>({value:o.value,label:o.text})):undefined};
 });
}"""


def allowed_url(url: str) -> bool:
    """Require explicit local HTTP host and configured app port, without userinfo."""
    try:
        parsed = urlparse(url)
        return (
            parsed.scheme == "http"
            and parsed.hostname in POLICIES["allowed_hosts"]
            and parsed.port in POLICIES["allowed_ports"]
            and not parsed.username
            and not parsed.password
        )
    except ValueError:
        return False


class BrowserSession:
    """Own one isolated browser context, numbered observation and restart checkpoint."""

    def __init__(self, workspace: Path):
        self.workspace = workspace
        self.workspace.mkdir(parents=True, exist_ok=True)
        self.page = None
        self.sequence = 0
        self.elements = {}
        self.observed_url = None

    async def start(self, restore: bool = False) -> None:
        """Launch Chromium, blocking every network request outside the sandbox."""
        local_browsers = ROOT / "playwright-browsers"
        if local_browsers.exists():
            os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", str(local_browsers))
        self.playwright = await async_playwright().start()
        try:
            self.browser = await self.playwright.chromium.launch(headless=True)
        except Exception:
            await self.playwright.stop()
            raise
        state = self.workspace / "browser-state.json"
        self.context = await self.browser.new_context(
            storage_state=str(state) if restore and state.exists() else None,
            accept_downloads=True,
            viewport={"width": 1400, "height": 950},
        )

        async def gate(route):
            if allowed_url(route.request.url):
                await route.continue_()
            else:
                await route.abort("blockedbyclient")

        await self.context.route("**/*", gate)
        self.page = await self.context.new_page()
        self.page.set_default_timeout(8000)
        self.sequence = len(list(self.workspace.glob("screenshot-*.png")))

    async def close(self) -> None:
        """Release browser and driver even when a run pauses."""
        if hasattr(self, "browser"):
            await self.browser.close()
            await self.playwright.stop()

    async def observe(self) -> dict:
        """Number visible controls afresh and save visual evidence."""
        elements = await self.page.evaluate(DOM)
        self.elements = {e["id"]: e for e in elements}
        self.observed_url = self.page.url
        self.sequence += 1
        screenshot = f"screenshot-{self.sequence:04d}.png"
        await self.page.screenshot(path=str(self.workspace / screenshot), full_page=True)
        text = await self.page.locator("body").inner_text()
        return {
            "url": self.page.url,
            "title": await self.page.title(),
            "text": text[:16000],
            "elements": elements,
            "screenshot": screenshot,
        }

    async def element(self, element_id: int):
        """Reject stale IDs instead of guessing another control."""
        if self.observed_url != self.page.url or element_id not in self.elements:
            raise ToolFailure("ELEMENT_NOT_FOUND", "Observe the current page before using an element ID.")
        locator = self.page.locator(f'[data-ops-id="{element_id}"]')
        if await locator.count() != 1 or not await locator.is_visible():
            raise ToolFailure("ELEMENT_NOT_FOUND", "Control disappeared; observe again.")
        return locator

    async def check_response(self, response=None, expect_auth: bool = True) -> None:
        """Classify service, session and visible validation failures."""
        if response and response.status >= 500:
            raise ToolFailure("TRANSIENT", f"HTTP {response.status}; service temporarily unavailable.")
        if response and response.status in (401, 403):
            raise ToolFailure("AUTH_EXPIRED", "Session is invalid; sign in again.")
        if expect_auth and "/login" in self.page.url:
            raise ToolFailure("AUTH_EXPIRED", "Session expired; use credential references to sign in.")
        alert = self.page.locator("[role=alert]")
        if await alert.count() and await alert.is_visible():
            raise ToolFailure("VALIDATION", await alert.inner_text())

    async def checkpoint(self) -> dict:
        """Save cookies and non-secret draft fields for process restart."""
        await self.context.storage_state(path=str(self.workspace / "browser-state.json"))
        fields = await self.page.locator(
            "input:not([type=hidden]):not([type=password]),select,textarea"
        ).evaluate_all("es=>es.map(e=>({name:e.name,value:e.value}))")
        return {"url": self.page.url, "fields": fields}

    async def restore(self, checkpoint: dict) -> None:
        """Restore an allowed page and draft; fresh observations supply new IDs."""
        if not checkpoint or not allowed_url(checkpoint.get("url", "")):
            return
        response = await self.page.goto(checkpoint["url"])
        await self.check_response(response, expect_auth="/login" not in checkpoint["url"])
        for field in checkpoint.get("fields", []):
            if not re.fullmatch(r"[a-zA-Z_][a-zA-Z_0-9]*", field["name"]):
                continue
            locator = self.page.locator(f'[name="{field["name"]}"]')
            if await locator.count() == 1:
                if await locator.evaluate("(e)=>e.tagName") == "SELECT":
                    await locator.select_option(field["value"])
                else:
                    await locator.fill(field["value"])
