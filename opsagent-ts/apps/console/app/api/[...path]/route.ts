import { NextResponse } from "next/server";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { query, transaction, projectRoot, env } from "@opsagent/db";
import { encryptSecret, audit, hash } from "@opsagent/db/security";
import {
  createRun,
  respond,
  providerAvailable,
  employeeSchema,
} from "@opsagent/core";
import { organization } from "../../../lib/auth";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const uuid = z.string().uuid();
const failure = (e: unknown) =>
  NextResponse.json(
    { error: e instanceof Error ? e.message : "Request failed" },
    { status: 400 },
  );
export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const org = await organization();
  const { path } = await params;
  const [resource, id, part] = path;
  try {
    if (resource === "runs" && id) {
      uuid.parse(id);
      const [run] = await query(
        "SELECT * FROM platform.runs WHERE org_id=$1 AND id=$2",
        [org.org_id, id],
      );
      if (!run)
        return NextResponse.json({ error: "Run not found" }, { status: 404 });
      if (part === "events") {
        const after =
          Number(new URL(request.url).searchParams.get("after")) || 0;
        let cursor = after;
        const encoder = new TextEncoder();
        let closed = false;
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            const end = Date.now() + 55000;
            while (Date.now() < end && !request.signal.aborted && !closed) {
              const rows = await query<{
                id: number;
                kind: string;
                payload: unknown;
              }>(
                "SELECT id,kind,payload FROM platform.run_events WHERE org_id=$1 AND run_id=$2 AND id>$3 ORDER BY id LIMIT 100",
                [org.org_id, id, cursor],
              );
              for (const row of rows) {
                cursor = row.id;
                controller.enqueue(
                  encoder.encode(
                    `id: ${row.id}\ndata: ${JSON.stringify(row)}\n\n`,
                  ),
                );
              }
              if (!rows.length)
                controller.enqueue(encoder.encode(": heartbeat\n\n"));
              await new Promise((r) => setTimeout(r, 1000));
            }
            if (!closed) controller.close();
          },
          cancel() {
            closed = true;
          },
        });
        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
          },
        });
      }
      const [steps, approvals, questions, events] = await Promise.all([
        query(
          "SELECT * FROM platform.run_steps WHERE org_id=$1 AND run_id=$2 ORDER BY index",
          [org.org_id, id],
        ),
        query(
          "SELECT * FROM platform.approvals WHERE org_id=$1 AND run_id=$2 ORDER BY created_at",
          [org.org_id, id],
        ),
        query(
          "SELECT * FROM platform.questions WHERE org_id=$1 AND run_id=$2 ORDER BY created_at",
          [org.org_id, id],
        ),
        query(
          "SELECT * FROM platform.run_events WHERE org_id=$1 AND run_id=$2 ORDER BY id",
          [org.org_id, id],
        ),
      ]);
      if (part === "report") {
        const report = run.report as Record<string, unknown> | null;
        return new Response(
          `# OpsAgent run ${id}\n\nTask: ${run.task}\nStatus: ${run.status}\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n`,
          {
            headers: {
              "Content-Type": "text/markdown",
              "Content-Disposition": `attachment; filename="run-${id}.md"`,
            },
          },
        );
      }
      if (part === "trace")
        return new Response(
          JSON.stringify({ run, steps, approvals, questions, events }, null, 2),
          {
            headers: {
              "Content-Type": "application/json",
              "Content-Disposition": `attachment; filename="trace-${id}.json"`,
            },
          },
        );
      return NextResponse.json({ run, steps, approvals, questions, events });
    }
    if (resource === "artifacts" && id) {
      uuid.parse(id);
      const [run] = await query(
        "SELECT id FROM platform.runs WHERE org_id=$1 AND id=$2",
        [org.org_id, id],
      );
      if (!run) return new Response("Not found", { status: 404 });
      const file = path.slice(2).join("/");
      if (!/^(actor|verifier)\/screen-\d+\.png$/.test(file))
        return new Response("Forbidden", { status: 403 });
      const base = resolve(projectRoot, "artifacts/runs", id),
        target = resolve(base, file);
      if (relative(base, target).startsWith(".."))
        return new Response("Forbidden", { status: 403 });
      return new Response(new Uint8Array(await readFile(target)), {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "private,max-age=60",
        },
      });
    }
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const org = await organization();
  const origin = request.headers.get("origin");
  if (
    origin &&
    origin !== new URL(request.url).origin &&
    origin !== new URL(env.CONSOLE_URL).origin
  )
    return new Response("Origin rejected", { status: 403 });
  const { path } = await params;
  const [resource, id, part] = path;
  try {
    const body = (await request.json()) as unknown;
    if (resource === "runs" && !id) {
      const input = z
        .object({
          task: z.string().min(3).max(5000),
          employeeId: uuid,
          chaos: z.boolean().default(false),
        })
        .parse(body);
      if (!providerAvailable())
        return NextResponse.json(
          {
            error:
              "Configure the provider API key before autonomous execution.",
          },
          { status: 503 },
        );
      await query(
        "UPDATE mock_portal.settings SET value=$1 WHERE key='chaos'",
        [JSON.stringify(input.chaos)],
      );
      return NextResponse.json({
        id: await createRun(org.org_id, input.employeeId, input.task),
      });
    }
    if (["approval", "question"].includes(resource)) {
      uuid.parse(id);
      const input = z
        .object({
          answer: z.string().min(1).max(5000),
          comment: z.string().max(2000).default(""),
        })
        .parse(body);
      if (resource === "approval")
        z.enum(["approve", "reject"]).parse(input.answer);
      await respond(
        org.org_id,
        id,
        resource as "approval" | "question",
        input.answer,
        input.comment,
      );
      return NextResponse.json({ ok: true });
    }
    if (resource === "runs" && part === "cancel") {
      uuid.parse(id);
      await transaction(async (c) => {
        const rows = (
          await c.query(
            "UPDATE platform.runs SET status=$1,updated_at=now() WHERE org_id=$2 AND id=$3 AND status NOT IN ($4,$5,$6,$7) RETURNING id",
            [
              "CANCELLED",
              org.org_id,
              id,
              "COMPLETED",
              "FAILED",
              "ESCALATED",
              "CANCELLED",
            ],
          )
        ).rows;
        if (!rows.length) throw Error("Run cannot be cancelled");
        await c.query(
          "UPDATE platform.approvals SET status=$1 WHERE org_id=$2 AND run_id=$3 AND status=$4",
          ["CANCELLED", org.org_id, id, "PENDING"],
        );
        await c.query(
          "UPDATE platform.questions SET status=$1 WHERE org_id=$2 AND run_id=$3 AND status=$4",
          ["CANCELLED", org.org_id, id, "PENDING"],
        );
      });
      await audit(org.org_id, "operator", "run.cancelled", id, {});
      return NextResponse.json({ ok: true });
    }
    if (resource === "employees" && !part) {
      const input = z
        .object({
          name: z.string().min(2).max(100),
          role_prompt: z.string().min(10).max(10000),
          allowed_tools: employeeSchema.shape.allowed_tools,
          policies: employeeSchema.shape.policies,
          connectors: employeeSchema.shape.connectors,
          model: z.string().nullable(),
        })
        .parse(body);
      let employeeId = id;
      if (id) {
        uuid.parse(id);
        const rows = await query(
          "UPDATE platform.ai_employees SET name=$1,role_prompt=$2,allowed_tools=$3,policies=$4,connectors=$5,model=$6 WHERE org_id=$7 AND id=$8 RETURNING id",
          [
            input.name,
            input.role_prompt,
            JSON.stringify(input.allowed_tools),
            JSON.stringify(input.policies),
            JSON.stringify(input.connectors),
            input.model,
            org.org_id,
            id,
          ],
        );
        if (!rows.length) throw Error("Employee not found");
      } else {
        const [row] = await query<{ id: string }>(
          "INSERT INTO platform.ai_employees(org_id,name,role_prompt,allowed_tools,policies,connectors,model) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id",
          [
            org.org_id,
            input.name,
            input.role_prompt,
            JSON.stringify(input.allowed_tools),
            JSON.stringify(input.policies),
            JSON.stringify(input.connectors),
            input.model,
          ],
        );
        employeeId = row.id;
      }
      await audit(org.org_id, "operator", "employee.saved", employeeId!, {
        name: input.name,
      });
      return NextResponse.json({ id: employeeId });
    }
    if (resource === "employees" && id) {
      uuid.parse(id);
      const [employee] = await query(
        "SELECT id FROM platform.ai_employees WHERE org_id=$1 AND id=$2",
        [org.org_id, id],
      );
      if (!employee) throw Error("Employee not found");
      if (part === "credentials") {
        const input = z
          .object({
            handle: z.string().regex(/^[a-z0-9_-]{1,80}$/i),
            username: z.string().min(1).max(200),
            password: z.string().min(1).max(200),
          })
          .parse(body);
        const encrypted = encryptSecret(
          JSON.stringify({
            username: input.username,
            password: input.password,
          }),
          `${org.org_id}:${id}:${input.handle}`,
        );
        await query(
          "INSERT INTO platform.credentials(org_id,employee_id,handle,ciphertext) VALUES($1,$2,$3,$4) ON CONFLICT(org_id,employee_id,handle) DO UPDATE SET ciphertext=EXCLUDED.ciphertext",
          [org.org_id, id, input.handle, encrypted],
        );
        await audit(org.org_id, "operator", "credential.configured", id, {
          handle: input.handle,
        });
        return NextResponse.json({ ok: true });
      }
      if (part === "knowledge") {
        const input = z
          .object({
            id: uuid.optional(),
            title: z.string().min(1).max(100),
            content: z.string().min(1).max(100000),
          })
          .parse(body);
        await transaction(async (c) => {
          let docId = input.id;
          if (docId) {
            const rows = (
              await c.query(
                "UPDATE platform.knowledge_docs SET title=$1,content=$2 WHERE id=$3 AND org_id=$4 AND employee_id=$5 RETURNING id",
                [input.title, input.content, docId, org.org_id, id],
              )
            ).rows;
            if (!rows.length) throw Error("Document not found");
            await c.query(
              "DELETE FROM platform.knowledge_chunks WHERE doc_id=$1 AND org_id=$2",
              [docId, org.org_id],
            );
          } else {
            docId = (
              await c.query<{ id: string }>(
                "INSERT INTO platform.knowledge_docs(org_id,employee_id,title,content) VALUES($1,$2,$3,$4) RETURNING id",
                [org.org_id, id, input.title, input.content],
              )
            ).rows[0].id;
          }
          const chunks = input.content.match(/[\s\S]{1,4000}/g) || [];
          for (const content of chunks)
            await c.query(
              "INSERT INTO platform.knowledge_chunks(org_id,employee_id,doc_id,content) VALUES($1,$2,$3,$4)",
              [org.org_id, id, docId, content],
            );
        });
        await audit(org.org_id, "operator", "knowledge.saved", id, {
          title: input.title,
          contentHash: hash(input.content),
        });
        return NextResponse.json({ ok: true });
      }
    }
    if (resource === "lessons" && id) {
      uuid.parse(id);
      const input = z
        .object({
          content: z.string().max(500),
          remove: z.boolean().default(false),
        })
        .parse(body);
      if (input.remove)
        await query("DELETE FROM platform.lessons WHERE id=$1 AND org_id=$2", [
          id,
          org.org_id,
        ]);
      else
        await query(
          "UPDATE platform.lessons SET content=$1 WHERE id=$2 AND org_id=$3",
          [input.content, id, org.org_id],
        );
      await audit(org.org_id, "operator", "lesson.edited", id, {
        remove: input.remove,
      });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch (e) {
    return failure(e);
  }
}
