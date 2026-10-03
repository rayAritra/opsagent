import { query, transaction, db, employees, and, eq } from "@opsagent/db";
import { audit, hash } from "@opsagent/db/security";
import { enqueue } from "@opsagent/db/queue";
import { assertTransition } from "./state";
import {
  employeeSchema,
  initialCheckpoint,
  type Employee,
  type Run,
  type State,
  type Checkpoint,
} from "./types";
export async function loadRun(orgId: string, id: string) {
  const [run] = await query<Run>(
    "SELECT * FROM platform.runs WHERE org_id=$1 AND id=$2",
    [orgId, id],
  );
  if (!run) throw Error("Run not found in organization");
  return run;
}
export async function loadEmployee(
  orgId: string,
  id: string,
): Promise<Employee> {
  const [row] = await db
    .select()
    .from(employees)
    .where(and(eq(employees.orgId, orgId), eq(employees.id, id)));
  if (!row) throw Error("Employee not found in organization");
  return employeeSchema.parse({
    id: row.id,
    org_id: row.orgId,
    name: row.name,
    role_prompt: row.rolePrompt,
    allowed_tools: row.allowedTools,
    policies: row.policies,
    connectors: row.connectors,
    model: row.model,
  });
}
export async function event(
  orgId: string,
  runId: string,
  kind: string,
  payload: unknown,
) {
  await query(
    "INSERT INTO platform.run_events(org_id,run_id,kind,payload) VALUES($1,$2,$3,$4)",
    [orgId, runId, kind, JSON.stringify(payload)],
  );
}
export async function checkpoint(
  run: Run,
  cp: Checkpoint,
  status: State = run.status,
) {
  assertTransition(run.status, status);
  await transaction(async (c) => {
    const [row] = (
      await c.query<{ status: State }>(
        "SELECT status FROM platform.runs WHERE org_id=$1 AND id=$2 FOR UPDATE",
        [run.org_id, run.id],
      )
    ).rows;
    if (row.status === "CANCELLED") throw Error("Run was cancelled");
    await c.query(
      "UPDATE platform.runs SET status=$1,checkpoint=$2,updated_at=now() WHERE org_id=$3 AND id=$4",
      [status, JSON.stringify(cp), run.org_id, run.id],
    );
    await c.query(
      "INSERT INTO platform.run_events(org_id,run_id,kind,payload) VALUES($1,$2,$3,$4)",
      [
        run.org_id,
        run.id,
        "state",
        JSON.stringify({ status, steps: cp.steps, tokens: cp.tokens }),
      ],
    );
    await c.query(
      "INSERT INTO platform.audit_log(org_id,actor,action,target,payload_hash,payload) VALUES($1,$2,$3,$4,$5,$6)",
      [
        run.org_id,
        "worker",
        "run.transition",
        run.id,
        hash({ from: run.status, to: status }),
        JSON.stringify({ from: run.status, to: status }),
      ],
    );
  });
  run.status = status;
  run.checkpoint = cp;
}
export async function createRun(
  orgId: string,
  employeeId: string,
  task: string,
) {
  await loadEmployee(orgId, employeeId);
  const [row] = await query<{ id: string }>(
    "INSERT INTO platform.runs(org_id,employee_id,task,status,checkpoint) VALUES($1,$2,$3,$4,$5) RETURNING id",
    [orgId, employeeId, task, "QUEUED", JSON.stringify(initialCheckpoint())],
  );
  await audit(orgId, "operator", "run.created", row.id, { task, employeeId });
  await enqueue(orgId, row.id);
  return row.id;
}
export async function searchKnowledge(
  orgId: string,
  employeeId: string,
  q: string,
) {
  return query<{ title: string; content: string; rank: number }>(
    `SELECT d.title,c.content,ts_rank(c.search,websearch_to_tsquery('english',$3)) AS rank FROM platform.knowledge_chunks c JOIN platform.knowledge_docs d ON d.id=c.doc_id AND d.org_id=c.org_id WHERE c.org_id=$1 AND c.employee_id=$2 ORDER BY rank DESC LIMIT 8`,
    [orgId, employeeId, q],
  );
}
export async function respond(
  orgId: string,
  id: string,
  kind: "approval" | "question",
  answer: string,
  comment = "",
) {
  await transaction(async (c) => {
    if (kind === "approval") {
      const rows = (
        await c.query<{ run_id: string }>(
          "UPDATE platform.approvals SET status=$1,comment=$2 WHERE id=$3 AND org_id=$4 AND status=$5 RETURNING run_id",
          [
            answer === "approve" ? "APPROVED" : "REJECTED",
            comment,
            id,
            orgId,
            "PENDING",
          ],
        )
      ).rows;
      if (!rows.length) throw Error("Approval already answered or not found");
      await c.query(
        "UPDATE platform.runs SET updated_at=now() WHERE id=$1 AND org_id=$2",
        [rows[0].run_id, orgId],
      );
    } else {
      const rows = (
        await c.query<{ run_id: string }>(
          "UPDATE platform.questions SET status=$1,answer=$2 WHERE id=$3 AND org_id=$4 AND status=$5 RETURNING run_id",
          ["ANSWERED", answer, id, orgId, "PENDING"],
        )
      ).rows;
      if (!rows.length) throw Error("Question already answered or not found");
    }
  });
  const table = kind === "approval" ? "approvals" : "questions";
  const [row] = await query<{ run_id: string }>(
    `SELECT run_id FROM platform.${table} WHERE id=$1 AND org_id=$2`,
    [id, orgId],
  );
  await audit(orgId, "operator", kind + ".response", id, { answer, comment });
  await enqueue(orgId, row.run_id);
}
