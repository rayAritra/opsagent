import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { query } from "../packages/db/src/index";
import { loadEmployee } from "../packages/core/src/store";
import { BrowserSession } from "../packages/core/src/browser";
import { Registry } from "../packages/core/src/registry";
import type { ToolContext } from "../packages/core/src/tools/define";
import type { Call } from "../packages/core/src/types";
const org = "00000000-0000-4000-8000-000000000001",
  employeeId = "00000000-0000-4000-8000-000000000002";
let browser: BrowserSession, registry: Registry, ctx: ToolContext;
async function execute(name: string, args: Call["args"] = {}) {
  return registry.execute({ name, args }, ctx);
}
async function id(label: string) {
  await browser.observe();
  for (let i = 0; i < browser.elements.length; i++) {
    const text = await browser.elements[i].evaluate((n) => {
      const e = n as HTMLInputElement;
      return e.labels?.[0]?.innerText || e.textContent || "";
    });
    if (text.trim().split("\n")[0] === label) return i + 1;
  }
  throw Error("Missing element " + label);
}
beforeAll(async () => {
  await query(
    "UPDATE mock_portal.settings SET value='false' WHERE key='chaos'",
  );
  const employee = await loadEmployee(org, employeeId);
  browser = new BrowserSession(employee, randomUUID());
  await browser.start();
  registry = await Registry.load();
  ctx = {
    employee,
    browser,
    memory: {},
    authorize: async () => false,
    ask: async () => {},
  };
});
afterAll(async () => {
  await browser?.close();
});
describe("native tool registry against real browser", () => {
  it("discovers tool schemas", () => {
    expect(registry.tools.size).toBeGreaterThanOrEqual(14);
    expect(registry.definitions(ctx.employee.allowed_tools)).toHaveLength(14);
  });
  it("login resolves encrypted handle", async () => {
    expect(
      await execute("browser_login", {
        system: "portal",
        credential_handle: "portal-demo",
      }),
    ).toMatchObject({ ok: true, data: { signedIn: true } });
  });
  it("navigation and compact numbered observations", async () => {
    const r = await execute("browser_navigate", {
      url: ctx.employee.connectors.portal.url,
    });
    expect(r).toMatchObject({ ok: true });
    const obs = await execute("browser_observe");
    expect(obs.ok && JSON.stringify(obs.data)).toContain("untrusted_content");
    expect(browser.elements.length).toBeGreaterThan(5);
  });
  it("clicks pagination and downloads/extracts a real PDF", async () => {
    expect(
      await execute("browser_click", { id: await id("Next page") }),
    ).toMatchObject({ ok: true });
    await browser.page!.locator("tbody a").first().click();
    await browser.observe();
    const downloaded = await execute("browser_download", {
      id: await id("Download PDF"),
    });
    expect(downloaded.ok).toBe(true);
    if (!downloaded.ok) return;
    const { file } = downloaded.data as { file: string };
    expect(await execute("pdf_extract", { file })).toMatchObject({ ok: true });
    expect(await execute("files_list")).toMatchObject({ ok: true });
  });
  it("types search field and selects a real vendor", async () => {
    await browser.navigate(ctx.employee.connectors.portal.url);
    expect(
      await execute("browser_type", {
        id: await id("Search"),
        text: "Initech",
      }),
    ).toMatchObject({ ok: true });
    await browser.login("erp", "erp-demo");
    await browser.navigate(ctx.employee.connectors.erp.url + "/new");
    const vendor = await id("Vendor");
    expect(
      await execute("browser_select", { id: vendor, value: "Initech" }),
    ).toMatchObject({ ok: true });
  });
  it("write submission parks at enforced authorization boundary", async () => {
    await browser.page!.locator("[name=number]").fill("NO-WRITE");
    await browser.page!.locator("[name=amount]").fill("78500");
    await browser.page!.locator("[name=due]").fill("2026-10-20");
    const result = await execute("browser_click", {
      id: await id("Create payable"),
    });
    expect(result).toMatchObject({ ok: true, data: { parked: true } });
    expect(
      (
        await query("SELECT id FROM mock_erp.payables WHERE number=$1", [
          "NO-WRITE",
        ])
      ).length,
    ).toBe(0);
  });
  it("knowledge, memory, human input, finish all return structured results", async () => {
    expect(
      await execute("knowledge_search", {
        query: "invoice duplicate approval",
      }),
    ).toMatchObject({ ok: true });
    expect(
      await execute("memory_note", { key: "source", value: "checked" }),
    ).toMatchObject({ ok: true });
    expect(ctx.memory.source).toBe("checked");
    expect(
      await execute("ask_human", { question: "What is the due date?" }),
    ).toMatchObject({ ok: true, data: { parked: true } });
    expect(
      await execute("finish", {
        summary: "Test fixture",
        claimed_outcome: "Not independently verified",
      }),
    ).toMatchObject({ ok: true });
  });
  it("read can never access credential-bearing browser state", async () => {
    expect(
      await execute("files_read", { file: "browser-state.json" }),
    ).toMatchObject({ ok: false, errorType: "PERMISSION_DENIED" });
    expect(await execute("files_read", { file: "../../.env" })).toMatchObject({
      ok: false,
      errorType: "PERMISSION_DENIED",
    });
  });
  it("permissions, bad selectors, invalid schema, invalid handle are classified", async () => {
    expect(await execute("browser_click", { id: 9999 })).toMatchObject({
      ok: false,
      errorType: "ELEMENT_NOT_FOUND",
    });
    expect(await execute("browser_click", { id: -1 })).toMatchObject({
      ok: false,
      errorType: "VALIDATION",
    });
    expect(
      await execute("browser_login", {
        system: "portal",
        credential_handle: "wrong",
      }),
    ).toMatchObject({ ok: false, errorType: "PERMISSION_DENIED" });
    const allowed = ctx.employee.allowed_tools;
    ctx.employee.allowed_tools = [];
    expect(await execute("browser_observe")).toMatchObject({
      ok: false,
      errorType: "PERMISSION_DENIED",
    });
    ctx.employee.allowed_tools = allowed;
  });
});
