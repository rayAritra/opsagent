import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { query, pool } from "@opsagent/db";
import {
  createRun,
  respond,
  terminal,
  providerAvailable,
} from "@opsagent/core";
import { queue } from "@opsagent/db/queue";
const args = process.argv.slice(2);
if (args[0] !== "run" || !args[1])
  throw Error(
    'Usage: npm run agent run "<task>" [--chaos] [--auto-human=script.yaml] [--employee=<uuid>]',
  );
if (!providerAvailable()) {
  console.error(
    "BLOCKED: configure the selected provider API key in .env. No autonomous run was simulated.",
  );
  process.exit(2);
}
const [employee] = await query<{ id: string; org_id: string }>(
  "SELECT id,org_id FROM platform.ai_employees WHERE ($1::uuid IS NULL OR id=$1::uuid) ORDER BY created_at LIMIT 1",
  [args.find((a) => a.startsWith("--employee="))?.slice(11) || null],
);
if (!employee) throw Error("No employee configured");
if (args.includes("--chaos"))
  await query("UPDATE mock_portal.settings SET value='true' WHERE key='chaos'");
const scriptPath = args.find((a) => a.startsWith("--auto-human="))?.slice(13);
const script = scriptPath
  ? (parse(await readFile(scriptPath, "utf8")) as {
      approval?: "approve" | "reject";
      answers?: Record<string, string>;
    })
  : undefined;
const id = await createRun(employee.org_id, employee.id, args[1]);
console.log("Run", id);
let last = "";
const deadline = Date.now() + 20 * 60 * 1000;
while (Date.now() < deadline) {
  const [run] = await query<{
    status: Parameters<typeof terminal>[0];
    report: unknown;
  }>("SELECT status,report FROM platform.runs WHERE id=$1 AND org_id=$2", [
    id,
    employee.org_id,
  ]);
  if (run.status !== last) {
    console.log(run.status);
    last = run.status;
  }
  if (terminal(run.status)) {
    console.log(JSON.stringify(run.report, null, 2));
    process.exitCode = run.status === "COMPLETED" ? 0 : 1;
    break;
  }
  if (script) {
    for (const row of await query<{ id: string }>(
      "SELECT id FROM platform.approvals WHERE run_id=$1 AND org_id=$2 AND status=$3",
      [id, employee.org_id, "PENDING"],
    ))
      if (script.approval)
        await respond(
          employee.org_id,
          row.id,
          "approval",
          script.approval,
          "Scripted human response",
        );
    for (const row of await query<{ id: string; question: string }>(
      "SELECT id,question FROM platform.questions WHERE run_id=$1 AND org_id=$2 AND status=$3",
      [id, employee.org_id, "PENDING"],
    )) {
      const entry = Object.entries(script.answers || {}).find(([pattern]) =>
        row.question.toLowerCase().includes(pattern.toLowerCase()),
      );
      if (entry) await respond(employee.org_id, row.id, "question", entry[1]);
    }
  }
  await new Promise((r) => setTimeout(r, 1000));
}
if (Date.now() >= deadline) {
  console.error(
    "CLI wait deadline exceeded; run remains persisted for console review.",
  );
  process.exitCode = 1;
}
await (await queue()).stop();
await pool.end();
