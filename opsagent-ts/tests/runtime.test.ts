import { it, expect } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { query, env } from "../packages/db/src/index";
import { initialCheckpoint } from "../packages/core/src/types";
import { executeRun } from "../packages/core/src/runtime";
import {
  loadRun,
  loadEmployee,
  searchKnowledge,
} from "../packages/core/src/store";
import { BrowserSession } from "../packages/core/src/browser";
import { verify } from "../packages/core/src/verifier";
import type { Provider } from "../packages/core/src/llm";
const org = "00000000-0000-4000-8000-000000000001",
  employee = "00000000-0000-4000-8000-000000000002";
async function insert(status = "QUEUED") {
  const [run] = await query<{ id: string }>(
    "INSERT INTO platform.runs(org_id,employee_id,task,status,checkpoint) VALUES($1,$2,$3,$4,$5) RETURNING id",
    [
      org,
      employee,
      "Deterministic mechanics fixture; not a measured autonomous run",
      status,
      JSON.stringify(initialCheckpoint()),
    ],
  );
  return run.id;
}
it("missing provider key persists an honest FAILED report", async () => {
  const id = await insert();
  const keys = [env.ANTHROPIC_API_KEY, env.OPENAI_API_KEY];
  try {
    env.ANTHROPIC_API_KEY = undefined;
    env.OPENAI_API_KEY = undefined;
    await executeRun(org, id);
  } finally {
    [env.ANTHROPIC_API_KEY, env.OPENAI_API_KEY] = keys;
  }
  const run = await loadRun(org, id);
  expect(run.status).toBe("FAILED");
  expect(JSON.stringify(run.report)).toContain("Missing");
});
it("organization and employee scope reject cross-tenant reads", async () => {
  const id = await insert();
  await expect(loadRun(randomUUID(), id)).rejects.toThrow();
  expect(await searchKnowledge(randomUUID(), employee, "invoice")).toHaveLength(
    0,
  );
  expect(await searchKnowledge(org, randomUUID(), "invoice")).toHaveLength(0);
});
it("audit rows cannot be edited or deleted", async () => {
  const [row] = await query<{ id: string }>(
    "SELECT id FROM platform.audit_log WHERE org_id=$1 LIMIT 1",
    [org],
  );
  expect(row).toBeDefined();
  await expect(
    query("DELETE FROM platform.audit_log WHERE id=$1", [row.id]),
  ).rejects.toThrow("append-only");
});
it("fresh verifier refuses plausible but wrong ERP values", async () => {
  const employeeConfig = await loadEmployee(org, employee);
  const provider: Provider = {
    turn: async () => {
      throw Error("Verifier must never call actor tools");
    },
    json: async () => ({
      value: {
        checks: [
          {
            criterion: 0,
            system: "erp",
            kind: "payable",
            match: { number: "UMBRELLA-2026-4" },
            expected: {
              vendor: "Umbrella Supplies",
              number: "UMBRELLA-2026-4",
              amount: "999",
              due: "2026-10-20",
            },
            sourcePdf: "UMBRELLA-2026-4.pdf",
            absent: false,
          },
        ],
        reason: "Mechanics fixture",
      },
      tokens: 1,
      cost: 0,
    }),
  };
  const result = await verify(
    employeeConfig,
    randomUUID(),
    "Check the actual payable against its source",
    {
      constraints:[],
      outcome: "Exact values",
      inputs: [],
      policies: [],
      criteria: ["The payable matches the source PDF"],
    },
    [],
    provider,
  );
  expect(result.status).toBe("FAILED");
  expect(result.criteria[0].passed).toBe(false);
}, 60000);
it("worker process kill and restart resumes the persisted checkpoint", async () => {
  const id = await insert();
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "tests/fixtures/runtime-child.ts", org, id, "block"],
    {
      stdio: "pipe",
      windowsHide: true,
      detached: process.platform !== "win32",
      env: process.env,
    },
  );
  let output = "";
  child.stderr.on("data", (b) => {
    output += String(b);
  });
  try {
    await expect
      .poll(
        async () => {
          const run = await loadRun(org, id);
          if (child.exitCode !== null) throw Error("Child exited: " + output);
          return run.checkpoint.memory.checkpoint;
        },
        { timeout: 25000 },
      )
      .toBe("survived crash");
    if (process.platform === "win32")
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
    else if (child.pid) process.kill(-child.pid, "SIGKILL");
    const restarted = spawn(
      process.execPath,
      ["--import", "tsx", "tests/fixtures/runtime-child.ts", org, id, "resume"],
      { stdio: "pipe", windowsHide: true, env: process.env },
    );
    let restartError = "";
    restarted.stderr.on("data", (b) => {
      restartError += String(b);
    });
    const code = await new Promise<number | null>((resolve) =>
      restarted.on("exit", resolve),
    );
    expect(code, restartError).toBe(0);
    const run = await loadRun(org, id);
    expect(run.status).toBe("AWAITING_INPUT");
    expect(run.checkpoint.memory.checkpoint).toBe("survived crash");
    expect(run.checkpoint.steps).toBe(2);
    expect(run.checkpoint.pending).toBeUndefined();
  } finally {
    if (child.exitCode === null) child.kill();
  }
}, 60000);
it("chaos actually changes labels and produces observable failures or delays", async () => {
  await query("UPDATE mock_portal.settings SET value='true' WHERE key='chaos'");
  const employeeConfig = await loadEmployee(org, employee),
    browser = new BrowserSession(employeeConfig, randomUUID());
  try {
    await browser.start();
    await browser.login("erp", "erp-demo");
    let changed = false;
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        await browser.navigate(employeeConfig.connectors.erp.url + "/new");
        changed = await browser
          .page!.getByRole("button", { name: "Record payable", exact: true })
          .isVisible();
        if (changed) break;
      } catch {
        await browser.login("erp", "erp-demo");
      }
    }
    expect(changed).toBe(true);
  } finally {
    await browser.close();
    await query(
      "UPDATE mock_portal.settings SET value='false' WHERE key='chaos'",
    );
  }
}, 60000);
