"""Real browser tools; credential substitution happens only at the action boundary."""

from pathlib import Path

from agent.browser import allowed_url
from agent.credentials import resolve
from agent.tool_registry import Risk, ToolFailure, tool


@tool()
async def browser_navigate(ctx, url: str):
    """Open an allowed sandbox URL. Outside hosts and ports are blocked."""
    if not allowed_url(url):
        raise ToolFailure("PERMISSION_DENIED", "Navigation outside configured sandbox apps is blocked.")
    response = await ctx.browser.page.goto(url, wait_until="domcontentloaded")
    await ctx.browser.check_response(response, expect_auth="/login" not in url)
    return {"url": ctx.browser.page.url}


@tool()
async def browser_observe(ctx):
    """Read visible page text and numbered controls with select options; save a screenshot."""
    return await ctx.browser.observe()


@tool(Risk.WRITE)
async def browser_click(ctx, element_id: int):
    """Click a freshly observed control; submission is guarded by runtime policy."""
    locator = await ctx.browser.element(element_id)
    responses = []

    def capture(response):
        if response.request.resource_type == "document":
            responses.append(response)

    ctx.browser.page.on("response", capture)
    try:
        await locator.click()
        await ctx.browser.page.wait_for_load_state("domcontentloaded")
    finally:
        ctx.browser.page.remove_listener("response", capture)
    await ctx.browser.check_response(responses[-1] if responses else None, expect_auth=False)
    if "/login" in ctx.browser.page.url and await ctx.browser.page.locator("[role=alert]").count() == 0:
        raise ToolFailure("AUTH_EXPIRED", "Session expired; sign in again.")
    return {"url": ctx.browser.page.url}


@tool(Risk.WRITE)
async def browser_type(ctx, element_id: int, text: str):
    """Fill an input. Use $portal_creds.username/password (or erp/mail) for login."""
    locator = await ctx.browser.element(element_id)
    secret = text.startswith("$")
    if secret:
        is_login = "/login" in ctx.browser.page.url
        name = await locator.get_attribute("name")
        if not is_login or name not in ("username", "password"):
            raise ToolFailure(
                "PERMISSION_DENIED", "Credential references may only fill sandbox login fields."
            )
    if await locator.get_attribute("type") == "password" and not secret:
        raise ToolFailure("PERMISSION_DENIED", "Use an opaque credential reference for passwords.")
    await locator.fill(resolve(text))
    return {"filled": element_id, "value": "[REDACTED]" if secret else text}


@tool(Risk.WRITE)
async def browser_select(ctx, element_id: int, value: str):
    """Choose an exact option value from a freshly observed select element."""
    await (await ctx.browser.element(element_id)).select_option(value=value)
    return {"selected": element_id, "value": value}


@tool()
async def browser_download(ctx, element_id: int):
    """Download a real document through the browser into this run's workspace."""
    locator = await ctx.browser.element(element_id)
    if await locator.evaluate("(e)=>e.tagName") != "A" or await locator.get_attribute("download") is None:
        raise ToolFailure(
            "PERMISSION_DENIED", "Download tool accepts only document download links, never form controls."
        )
    async with ctx.browser.page.expect_download() as event:
        await locator.click()
    download = await event.value
    name = Path(download.suggested_filename).name
    path = ctx.workspace / name
    await download.save_as(str(path))
    if await download.failure():
        raise ToolFailure("TRANSIENT", "Download failed. Observe the page and retry.")
    return {"path": str(path), "bytes": path.stat().st_size}
