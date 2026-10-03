import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
  type Locator,
} from "playwright";
import { mkdir, readFile, readdir, rename } from "node:fs/promises";
import { resolve, relative, basename, isAbsolute } from "node:path";
import { existsSync } from "node:fs";
import { projectRoot, query } from "@opsagent/db";
import { decryptSecret, audit } from "@opsagent/db/security";
import type { Employee, Action } from "./types";
import { untrusted } from "./untrusted";
export class BrowserSession {
  browser?: Browser;
  context?: BrowserContext;
  page?: Page;
  elements: Locator[] = [];
  generation = 0;
  source?: Action["source"];
  readonly directory: string;
  constructor(
    readonly employee: Employee,
    readonly runId: string,
    readonly fresh = false,
  ) {
    this.directory = resolve(
      projectRoot,
      "artifacts/runs",
      runId,
      fresh ? "verifier" : "actor",
    );
  }
  async start() {
    await mkdir(this.directory, { recursive: true });
    this.browser = await chromium.launch({ headless: true });
    const state = resolve(this.directory, "browser-state.json");
    this.context = await this.browser.newContext({
      acceptDownloads: true,
      ...(!this.fresh && existsSync(state) ? { storageState: state } : {}),
    });
    await this.context.route("**/*", async (route) => {
      const req = route.request(),
        url = new URL(req.url());
      if (!this.employee.policies.allowedOrigins.includes(url.origin)) {
        await route.abort("blockedbyclient");
        return;
      }
      await route.continue();
    });
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(10000);
  }
  allowed(url: string) {
    if (!this.employee.policies.allowedOrigins.includes(new URL(url).origin))
      throw Error("PERMISSION_DENIED: URL outside configured connectors");
  }
  async navigate(url: string) {
    this.allowed(url);
    const response = await this.page!.goto(url, {
      waitUntil: "domcontentloaded",
    });
    this.invalidate();
    if (response && response.status() >= 500)
      throw Error("TRANSIENT: remote server error");
    if (
      (this.page!.url().includes("/login") && !url.includes("/login")) ||
      response?.status() === 401
    )
      throw Error("AUTH_EXPIRED: sign in required");
  }
  invalidate() {
    this.elements = [];
    this.generation++;
  }
  async save() {
    if (!this.context) return;
    const tmp = resolve(this.directory, "browser-state.tmp");
    await this.context.storageState({ path: tmp });
    await rename(tmp, resolve(this.directory, "browser-state.json"));
  }
  async close() {
    await this.context?.close();
    await this.browser?.close();
  }
  async observe() {
    const p = this.page!;
    await p.waitForLoadState("domcontentloaded");
    const text = (await p.locator("body").innerText()).slice(0, 24000);
    if (/Temporary service failure/.test(text))
      throw Error("TRANSIENT: company error page");
    const interactive = p.locator(
      "a[href],button,input:not([type=hidden]),select,textarea,[role=button]",
    );
    this.elements = [];
    const list: string[] = [];
    for (let i = 0; i < (await interactive.count()); i++) {
      const el = interactive.nth(i);
      if (!(await el.isVisible())) continue;
      const info = await el.evaluate((node) => {
        const e = node as HTMLInputElement;
        const label =
          e.labels?.[0]?.innerText ||
          e.getAttribute("aria-label") ||
          e.getAttribute("placeholder") ||
          e.textContent ||
          e.name ||
          "";
        return {
          href:node.tagName==='A'?(node as HTMLAnchorElement).href:undefined,
          tag: e.tagName.toLowerCase(),
          label: label.trim().slice(0, 140),
          type: e.type,
          value: e.type === "password" ? "[redacted]" : e.value,
        };
      });
      this.elements.push(el);
      list.push(
        `[${this.elements.length}] ${info.tag} ${info.type || ""} "${info.label}"${info.value ? " value=" + info.value : ""}${info.href?" href="+info.href:""}`,
      );
    }
    const screenshot = `screen-${Date.now()}.png`;
    await p.screenshot({
      path: resolve(this.directory, screenshot),
      fullPage: true,
    });
    const message = p.locator("[data-record=message]");
    if (await message.count())
      this.source = {
        sender: await message.locator("[data-field=sender]").innerText(),
        subject: await message.locator("[data-field=subject]").innerText(),
        body: await message.locator("[data-field=body]").innerText(),
      };
    return {
      url: p.url(),
      title: untrusted(await p.title(), p.url() + "#title"),
      text: untrusted(text, p.url()),
      elements: list.map((item) => untrusted(item, p.url() + "#interactive")),
      screenshot: `${this.fresh ? "verifier" : "actor"}/${screenshot}`,
    };
  }
  element(id: number) {
    const el = this.elements[id - 1];
    if (!el)
      throw Error(
        "ELEMENT_NOT_FOUND: observe again for fresh numbered elements",
      );
    return el;
  }
  async login(system: string, handle: string) {
    const cfg = this.employee.connectors[system];
    if (!cfg || cfg.credentialHandle !== handle)
      throw Error(
        "PERMISSION_DENIED: credential handle does not belong to connector",
      );
    const [row] = await query<{ ciphertext: string }>(
      "SELECT ciphertext FROM platform.credentials WHERE org_id=$1 AND employee_id=$2 AND handle=$3",
      [this.employee.org_id, this.employee.id, handle],
    );
    if (!row) throw Error("PERMISSION_DENIED: credential handle not found");
    const secret = JSON.parse(
      decryptSecret(
        row.ciphertext,
        `${this.employee.org_id}:${this.employee.id}:${handle}`,
      ),
    ) as { username: string; password: string };
    await audit(this.employee.org_id, "worker", "credential.used", this.runId, {
      handle,
      system,
    });
    await this.navigate(cfg.url + "/login");
    await this.page!.getByLabel("Username", { exact: true }).fill(
      secret.username,
    );
    await this.page!.getByLabel("Password", { exact: true }).fill(
      secret.password,
    );
    await this.page!.getByRole("button", {
      name: "Sign in",
      exact: true,
    }).click();
    await this.page!.waitForURL((url) => !url.pathname.endsWith("/login"));
    await this.save();
    return { signedIn: true, system };
  }
  async actionFor(id: number): Promise<Action | undefined> {
    const element = this.element(id);
    return element.evaluate((node, source) => {
      const e = node as HTMLButtonElement;
      const form = e.form;
      if (
        !form ||
        !(
          e.type === "submit" ||
          (node.tagName === "INPUT" &&
            (node as HTMLInputElement).type === "submit")
        )
      )
        return undefined;
      if (form.method.toLowerCase() === "get") return undefined;
      const values: Record<string, string> = {};
      for (const [k, v] of new FormData(form).entries())
        if (!k.startsWith("$ACTION_")) values[k] = String(v);
      return {
        operation: form.dataset.operation || "unknown_write",
        values,
        url: location.href,
        domain: form.dataset.vendorDomain,
        vendor: form.dataset.vendorName,
        source,
      };
    }, this.source);
  }
  async records(system: string, path = "", kind = "payable") {
    const fresh = new BrowserSession(this.employee, this.runId, true);
    try {
      await fresh.start();
      const c = this.employee.connectors[system];
      if (!c) throw Error("Unknown connector");
      await fresh.login(system, c.credentialHandle);
      await fresh.navigate(c.url + path);
      return await fresh
        .page!.locator(`[data-record="${kind.replace(/[^a-z_]/g, "")}"]`)
        .evaluateAll((nodes) =>
          nodes.map((node) => {
            const row: Record<string, string> = {};
            for (const field of node.querySelectorAll("[data-field]"))
              row[field.getAttribute("data-field")!] = (
                field.textContent || ""
              ).trim();
            return row;
          }),
        );
    } finally {
      await fresh.close();
    }
  }
  async download(id: number) {
    const el = this.element(id);
    const [download] = await Promise.all([
      this.page!.waitForEvent("download"),
      el.click(),
    ]);
    const name =
      Date.now() +
      "-" +
      basename(download.suggestedFilename()).replace(/[^a-z0-9_.-]/gi, "_");
    await download.saveAs(resolve(this.directory, name));
    this.invalidate();
    return { file: name };
  }
  file(name: string) {
    const file = resolve(this.directory, name);
    if (
      relative(this.directory, file).startsWith("..") ||
      isAbsolute(relative(this.directory, file)) ||
      resolve(file) === this.directory ||
      /browser-state|\.tmp$/i.test(name)
    )
      throw Error("PERMISSION_DENIED: reserved file or path outside run");
    return file;
  }
  async files() {
    return (await readdir(this.directory)).filter(
      (f) => !f.startsWith("browser-state") && !f.endsWith(".tmp"),
    );
  }
  async read(name: string) {
    return (await readFile(this.file(name), "utf8")).slice(0, 30000);
  }
}
