import { z } from "zod";
import { readFile } from "node:fs/promises";
import { extractText } from "unpdf";
import { query, env, transaction } from "@opsagent/db";
import { audit, hash } from "@opsagent/db/security";
import { BrowserSession } from "./browser";
import { Registry } from "./registry";
import { createProvider, type Provider } from "./llm";
import { evaluatePolicy } from "./policy";
import {
  loadRun,
  loadEmployee,
  checkpoint,
  event,
  searchKnowledge,
} from "./store";
import {
  specSchema,
  type Run,
  type Checkpoint,
  type Action,
  type Call,
  type Result,
} from "./types";
import { boundaryPrompt } from "./untrusted";
import { verify, sourceHasAmount, type Verification } from "./verifier";
import { terminal } from "./state";
type DurableCheckpoint = Checkpoint & {
  pendingAction?: Action;
  uncertainAction?: Action;
};
export async function executeRun(
  orgId: string,
  runId: string,
  overrideProvider?: Provider,
) {
  const run = await loadRun(orgId, runId);
  if (terminal(run.status)) return;
  const employee = await loadEmployee(orgId, run.employee_id);
  const cp = run.checkpoint as DurableCheckpoint;
  cp.costKnown=env.OPSAGENT_PROVIDER==='anthropic'&&(employee.model||env.OPSAGENT_MODEL)==='claude-sonnet-5-5';
  let browser: BrowserSession | undefined;
  let activeStart = Date.now();
  async function persist() {
    cp.activeMs += Date.now() - activeStart;
    activeStart = Date.now();
    if (browser?.page) cp.url = browser.page.url();
    await checkpoint(run, cp);
  }
  async function transition(status: Run["status"]) {
    cp.activeMs += Date.now() - activeStart;
    activeStart = Date.now();
    await checkpoint(run, cp, status);
  }
  async function report(verification: unknown) {
    cp.activeMs += Date.now() - activeStart;
    activeStart = Date.now();
    await finishReport(run, cp, verification);
  }
  async function ask(question: string) {
    await query(
      "INSERT INTO platform.questions(org_id,run_id,question) VALUES($1,$2,$3)",
      [orgId, runId, question],
    );
    await event(orgId, runId, "question", { question });
    await transition("AWAITING_INPUT");
  }
  try {
    const provider =
      overrideProvider || createProvider(employee.model || env.OPSAGENT_MODEL);
    const registry = await Registry.load();
    browser = new BrowserSession(employee, runId);
    await browser.start();
    if (run.status === "AWAITING_INPUT") {
      const answered = await query<{ answer: string }>(
        "SELECT answer FROM platform.questions WHERE org_id=$1 AND run_id=$2 AND status=$3 ORDER BY created_at",
        [orgId, runId, "ANSWERED"],
      );
      const pending = await query(
        "SELECT id FROM platform.questions WHERE org_id=$1 AND run_id=$2 AND status=$3",
        [orgId, runId, "PENDING"],
      );
      if (pending.length) return;
      cp.humanAnswers = answered.map((r) => r.answer);
      await transition(cp.spec && cp.plan ? "EXECUTING" : "UNDERSTANDING");
    }
    if (run.status === "AWAITING_APPROVAL") {
      const pending = await query(
        "SELECT id FROM platform.approvals WHERE org_id=$1 AND run_id=$2 AND status=$3",
        [orgId, runId, "PENDING"],
      );
      if (pending.length) return;
      await transition("EXECUTING");
      if (cp.pendingAction) {
        const [approval] = await query<{ status: string }>(
          "SELECT status FROM platform.approvals WHERE org_id=$1 AND run_id=$2 AND fingerprint=$3",
          [orgId, runId, hash(cp.pendingAction)],
        );
        if (approval?.status === "APPROVED") {
          await restoreForm(browser, cp.pendingAction);
          cp.pending = {
            name: "browser_click",
            args: { id: await submissionElement(browser) },
          };
        } else {
          cp.history.push({
            role: "user",
            content:
              "The human REJECTED this exact action. Do not repeat it. Adapt safely: " +
              JSON.stringify(cp.pendingAction),
          });
          cp.pending = undefined;
          cp.pendingAction = undefined;
        }
      }
    }
    if (run.status === "QUEUED") await transition("UNDERSTANDING");
    if (run.status === "UNDERSTANDING") {
      const docs = await searchKnowledge(orgId, employee.id, run.task);
      const lessons = await query<{ content: string }>(
        "SELECT content FROM platform.lessons WHERE org_id=$1 AND employee_id=$2 ORDER BY created_at DESC LIMIT 12",
        [orgId, employee.id],
      );
      await event(orgId, runId, "retrieval", { documents: docs, lessons });
      const reply = await provider.json(
        boundaryPrompt +
          "\n" +
          employee.role_prompt +
          "\nUnderstand the goal using company SOPs. Return {outcome,inputs:[],policies:[{rule,citation}],criteria:[explicit independently checkable statements],blockingQuestion?:string,constraints:[{kind:require_approval|deny_operation|approval_above|required_input,operation,field?,threshold?,citation}]}. A duplicate report can be successful if the SOP mandates no new entry. Do not invent values.",
        JSON.stringify({
          task: run.task,
          knowledge: docs,
          lessons,
          humanAnswers: cp.humanAnswers,
          connectors: employee.connectors,
        }),
      );
      cp.tokens += reply.tokens;
      cp.cost += reply.cost;
      cp.spec = specSchema.parse(reply.value);
      await persist();
      if (cp.spec.blockingQuestion && !cp.humanAnswers.length) {
        await ask(cp.spec.blockingQuestion);
        return;
      }
      await transition("PLANNING");
    }
    if (run.status === "PLANNING") {
      const reply = await provider.json(
        boundaryPrompt +
          " Produce an intent-level plan. Return {steps:[strings]}. Do not script selectors or clicks.",
        JSON.stringify({
          task: run.task,
          spec: cp.spec,
          history: cp.history.slice(-8),
        }),
      );
      cp.plan = z
        .object({ steps: z.array(z.string()).min(1).max(12) })
        .parse(reply.value).steps;
      cp.tokens += reply.tokens;
      cp.cost += reply.cost;
      await transition("EXECUTING");
    }
    if (cp.url && !cp.pendingAction) {
      try {
        await browser.navigate(cp.url);
      } catch {
        cp.recoveries++;
      }
    }
    if (cp.uncertainAction) {
      const action = cp.uncertainAction;
      let rows: Record<string, string>[] = [];
      if (action.operation === "invoice_create")
        rows = await browser.records("erp");
      else if (action.operation === "vendor_update")
        rows = await browser.records("erp", "/vendors", "vendor");
      const matched =
        action.operation === "invoice_create"
          ? rows.some(
              (r) =>
                r.vendor === action.values.vendor &&
                r.number === action.values.number &&
                Number(r.amount) === Number(action.values.amount) &&
                r.due === action.values.due,
            )
          : action.operation === "vendor_update"
            ? rows.some(
                (r) =>
                  r.name === action.vendor &&
                  r.email === action.values.email &&
                  r.phone === action.values.phone &&
                  r.notes === action.values.notes,
              )
            : false;
      if (!matched) {
        await ask(
          "The worker stopped while a write was in flight. Review this exact action in the target system before continuing. Was it committed? " +
            JSON.stringify(action),
        );
        cp.uncertainAction = undefined;
        await persist();
        return;
      }
      cp.history.push({
        role: "user",
        content:
          "Crash recovery independently confirmed the interrupted write already exists. Do not repeat it.",
      });
      cp.uncertainAction = undefined;
      cp.pending = undefined;
      cp.pendingAction = undefined;
      cp.recoveries++;
      await persist();
    }
    const context = {
      employee,
      browser,
      memory: cp.memory,
      ask,
      authorize: async (action: Action) => {
        if (action.operation === "invoice_create") {
          const pdfNames = (await browser!.files()).filter((f) =>
            f.endsWith(".pdf"),
          );
          let matches = false;
          for (const file of pdfNames) {
            const text = String(
              (
                await extractText(
                  new Uint8Array(await readFile(browser!.file(file))),
                  { mergePages: true },
                )
              ).text,
            );
            const due = /(?:Due date:|Payment due)\s*(\d{4}-\d{2}-\d{2})/i.exec(
              text,
            )?.[1];
            if (
              text.includes(action.values.vendor) &&
              text.includes(action.values.number) &&
              sourceHasAmount(text, action.values.amount) &&
              (due === action.values.due ||
                (!due &&
                  cp.humanAnswers.some((answer) =>
                    answer.includes(action.values.due),
                  )))
            )
              matches = true;
          }
          if (!matches)
            throw Error(
              "POLICY_BLOCKED: invoice values must match a downloaded source PDF; missing dates require human input",
            );
        }
        const existing =
          action.operation === "invoice_create"
            ? await browser!.records("erp")
            : [];
        const decision = evaluatePolicy(employee, action, existing,cp.spec?.constraints);
        await event(orgId, runId, "policy", { ...decision, action });
        await audit(orgId, "policy", "action.decision", runId, {
          ...decision,
          action,
        });
        if (decision.decision === "DENY")
          throw Error("POLICY_BLOCKED: " + decision.reason);
        if (decision.decision === "REQUIRE_APPROVAL") {
          const fingerprint = hash(action);
          const [old] = await query<{ status: string }>(
            "SELECT status FROM platform.approvals WHERE org_id=$1 AND run_id=$2 AND fingerprint=$3",
            [orgId, runId, fingerprint],
          );
          if (old?.status === "UNCERTAIN")throw Error("POLICY_BLOCKED: the prior submission has an uncertain receipt; review it before creating a new run");
          if (old?.status === "EXECUTED")
            throw Error(
              "POLICY_BLOCKED: this approved action was already executed",
            );
          if (old?.status === "REJECTED")
            throw Error(
              "POLICY_BLOCKED: Human rejection is final for these exact values",
            );
          if (old?.status !== "APPROVED") {
            cp.pendingAction = action;
            await query(
              "INSERT INTO platform.approvals(org_id,run_id,fingerprint,action,reason,citation) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(run_id,fingerprint) DO NOTHING",
              [
                orgId,
                runId,
                fingerprint,
                JSON.stringify(action),
                decision.reason,
                decision.citation,
              ],
            );
            await transition("AWAITING_APPROVAL");
            return false;
          }
        }
        cp.uncertainAction = action;
        await persist();
        return true;
      },
    };
    while (
      !terminal(run.status) &&
      !["AWAITING_APPROVAL", "AWAITING_INPUT"].includes(run.status)
    ) {
      if (
        cp.steps >= env.OPSAGENT_MAX_STEPS ||
        cp.tokens >= env.OPSAGENT_MAX_TOKENS ||
        cp.activeMs + Date.now() - activeStart >=
          env.OPSAGENT_MAX_SECONDS * 1000
      ) {
        await report({
          status: "PARTIAL",
          reason: "Execution budget exhausted; no verified completion claimed.",
        });
        await transition("ESCALATED");
        return;
      }
      if (run.status === "VERIFYING") {
        if (!cp.spec) throw Error("Missing fixed task specification");
        let result: Verification;
        try {
          result = await verify(
            employee,
            runId,
            run.task,
            cp.spec,
            cp.humanAnswers,
            provider,
          );
        } catch (e) {
          result = {
            status: "FAILED",
            criteria: cp.spec.criteria.map((criterion) => ({
              criterion,
              passed: false,
              evidence: "Fresh verification failed: " + String(e),
            })),
            tokens: 0,
            cost: 0,
            freshEvidence: {},
          };
        }
        cp.tokens += result.tokens;
        cp.cost += result.cost;
        await event(orgId, runId, "verification", result);
        if (result.status === "VERIFIED") {
          await report(result);
          try {
            const learned = await provider.json(
              boundaryPrompt +
                " Write 0–3 short reusable procedural lessons, not task-specific private facts. Return {lessons:[]}.",
              JSON.stringify({
                role: employee.role_prompt,
                spec: cp.spec,
                failures: cp.failures,
                recoveries: cp.recoveries,
              }),
            );
            const lessons = z
              .object({ lessons: z.array(z.string().max(500)).max(3) })
              .parse(learned.value);
            for (const content of lessons.lessons)
              await query(
                "INSERT INTO platform.lessons(org_id,employee_id,content) VALUES($1,$2,$3)",
                [orgId, employee.id, content],
              );
            cp.tokens += learned.tokens;
            cp.cost += learned.cost;
            await persist();
          } catch (e) {
            await event(orgId, runId, "lesson_error", { error: String(e) });
          }
          await report(result);
          await transition("COMPLETED");
          return;
        }
        if (cp.corrections++ >= 2) {
          await report(result);
          await transition("ESCALATED");
          return;
        }
        cp.history.push({
          role: "user",
          content:
            "Independent verification failed. Correct the real system state: " +
            JSON.stringify(result.criteria),
        });
        await transition("EXECUTING");
      }
      let call: Call | undefined = cp.pending;
      let summary = "Resuming checkpointed action";
      if (!call) {
        const observed = await safeObserve(browser);
        cp.observation = JSON.stringify(observed);
        const reply = await provider.turn(
          boundaryPrompt +
            "\n" +
            employee.role_prompt +
            "\nSelect ONE tool. Navigation URLs only from connector config. Brief decision summary only. Respect human rejection and policy results.",
          [
            {
              role: "user",
              content: JSON.stringify({
                task: run.task,
                spec: cp.spec,
                plan: cp.plan,
                connectors: employee.connectors,
                policy: employee.policies,
                memory: cp.memory,
                humanAnswers: cp.humanAnswers,
                history: cp.history.slice(-12),
                observation: observed,
              }),
            },
          ],
          registry.definitions(employee.allowed_tools),
        );
        cp.tokens += reply.tokens;
        cp.cost += reply.cost;
        call = reply.call;
        summary = reply.text.slice(0, 1500);
        if (!call) {
          cp.steps++;
          cp.history.push({
            role: "user",
            content:
              "Choose a permitted tool or finish. Text alone does not execute anything.",
          });
          await persist();
          continue;
        }
        cp.pending = call;
        await persist();
      }
      const started = Date.now();
      let result: Result = {
        ok: false,
        error: "Not executed",
        errorType: "UNKNOWN",
      };
      for (let retry = 0; retry < 3; retry++) {
        result = await registry.execute(call, context);
        if (result.ok || result.errorType !== "TRANSIENT") break;
        cp.recoveries++;
        await event(orgId, runId, "recovery", {
          type: "TRANSIENT",
          retry: retry + 1,
          tool: call.name,
        });
        if (cp.uncertainAction) break;
        await new Promise((r) =>
          setTimeout(r, Math.min(4000, 500 * 2 ** retry)),
        );
      }
      cp.steps++;
      const data = result.ok
        ? (result.data as Record<string, unknown>)
        : undefined;
      await transaction(async (c) => {
        await c.query(
          "INSERT INTO platform.run_steps(org_id,run_id,index,kind,tool,args,result,error_type,screenshot,tokens,latency) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(run_id,index) DO NOTHING",
          [
            orgId,
            runId,
            cp.steps,
            "tool",
            call!.name,
            JSON.stringify(call!.args),
            JSON.stringify({ summary, ...result }),
            result.ok ? null : result.errorType,
            data?.screenshot || null,
            cp.tokens,
            Date.now() - started,
          ],
        );
      });
      await event(orgId, runId, "step", {
        index: cp.steps,
        tool: call.name,
        args: call.args,
        summary,
        result,
      });
      await audit(orgId, "worker", "tool.executed", runId, {
        name: call.name,
        args: call.args,
        ok: result.ok,
      });
      cp.history.push(
        { role: "assistant", content: JSON.stringify({ tool: call, summary }) },
        {
          role: "user",
          content: JSON.stringify({
            toolResultSummary: JSON.stringify(result).slice(0, 1800),
          }),
        },
      );
      cp.history = cp.history.slice(-24);
      if (run.status === "AWAITING_INPUT") {
        cp.pending = undefined;
      }
      if (!["AWAITING_APPROVAL", "AWAITING_INPUT"].includes(run.status)) {
        cp.pending = undefined;
        cp.pendingAction = undefined;
        if (cp.uncertainAction) {
          if (result.ok) {
            await query(
              "UPDATE platform.approvals SET status=$1 WHERE org_id=$2 AND run_id=$3 AND fingerprint=$4 AND status=$5",
              ["EXECUTED", orgId, runId, hash(cp.uncertainAction), "APPROVED"],
            );
            cp.uncertainAction = undefined;
          } else {
            await ask(
              "A submission did not return a confirmed result. Review the target system before retrying: " +
                JSON.stringify(cp.uncertainAction),
            );
            await persist();
            return;
          }
        }
      }
      if (!result.ok) {
        const fingerprint = hash(call),
          count = (cp.failures[fingerprint] || 0) + 1;
        cp.failures[fingerprint] = count;
        if (result.errorType === "ELEMENT_NOT_FOUND") {
          cp.recoveries++;
          cp.observation = JSON.stringify(await safeObserve(browser));
        }
        if (result.errorType === "AUTH_EXPIRED") {
          const entry = Object.entries(employee.connectors).find(([, c]) =>
            browser!.page!.url().startsWith(c.url),
          );
          if (entry) {
            await browser.login(entry[0], entry[1].credentialHandle);
            cp.recoveries++;
          }
        }
        if (count >= 3) {
          cp.history.push({
            role: "user",
            content:
              "REPLAN REQUIRED: the same action failed three times. Use a different strategy.",
          });
          const plan = await provider.json(
            boundaryPrompt +
              " Revise the plan after repeated failure. Return {steps:[]}.",
            JSON.stringify({ spec: cp.spec, history: cp.history.slice(-10) }),
          );
          cp.plan = z
            .object({ steps: z.array(z.string()).max(12) })
            .parse(plan.value).steps;
          cp.tokens += plan.tokens;
          cp.cost += plan.cost;
          cp.failures[fingerprint] = 0;
          cp.recoveries++;
        }
      }
      await browser.save();
      await persist();
      if (["AWAITING_APPROVAL", "AWAITING_INPUT"].includes(run.status)) return;
      if (call.name === "finish" && result.ok) await transition("VERIFYING");
    }
  } catch (e) {
    const latest = await loadRun(orgId, runId);
    if (latest.status === "CANCELLED") return;
    await report({
      status: "FAILED",
      reason: e instanceof Error ? e.message : String(e),
    });
    if (!terminal(run.status)) await transition("FAILED");
  } finally {
    await browser?.close();
  }
}
async function safeObserve(browser: BrowserSession) {
  try {
    return await browser.observe();
  } catch (e) {
    return { error: String(e), url: browser.page?.url() };
  }
}
async function restoreForm(browser: BrowserSession, action: Action) {
  browser.source = action.source;
  await browser.navigate(action.url);
  for (const [key, value] of Object.entries(action.values)) {
    const field = browser.page!.locator(
      `[name="${key.replace(/[^a-z0-9_]/gi, "")}"]`,
    );
    if (!(await field.count()))
      throw Error("Prepared form changed; approval cannot be replayed");
    const tag = await field.first().evaluate((e) => e.tagName);
    if (tag === "SELECT") await field.first().selectOption(value);
    else if ((await field.first().getAttribute("type")) !== "hidden")
      await field.first().fill(value);
  }
  await browser.observe();
}
async function submissionElement(browser: BrowserSession) {
  for (let i = 1; i <= browser.elements.length; i++) {
    const action = await browser.actionFor(i);
    if (action && action.operation !== "login") return i;
  }
  throw Error("ELEMENT_NOT_FOUND: prepared submission unavailable");
}
async function finishReport(run: Run, cp: Checkpoint, verification: unknown) {
  const approvals = await query(
    "SELECT action,reason,citation,status,comment FROM platform.approvals WHERE org_id=$1 AND run_id=$2",
    [run.org_id, run.id],
  );
  const screenshots = await query(
    "SELECT index,screenshot FROM platform.run_steps WHERE org_id=$1 AND run_id=$2 AND screenshot IS NOT NULL ORDER BY index",
    [run.org_id, run.id],
  );
  const report = {
    approvals,
    screenshots,
    task: run.task,
    verification,
    metrics: {
      steps: cp.steps,
      tokens: cp.tokens,
      costUsdEstimate: cp.costKnown===false?null:cp.cost,
      activeMs: cp.activeMs,
      recoveries: cp.recoveries,
    },
    spec: cp.spec,
    plan: cp.plan,
    humanAnswers: cp.humanAnswers,
    completedAt: new Date().toISOString(),
  };
  await query("UPDATE platform.runs SET report=$1 WHERE org_id=$2 AND id=$3", [
    JSON.stringify(report),
    run.org_id,
    run.id,
  ]);
  await event(run.org_id, run.id, "report", report);
}
