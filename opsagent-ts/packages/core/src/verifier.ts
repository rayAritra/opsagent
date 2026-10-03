import { z } from "zod";
import { extractText } from "unpdf";
import { readFile } from "node:fs/promises";
import { BrowserSession } from "./browser";
import type { Employee, TaskSpec } from "./types";
import type { Provider } from "./llm";
import { boundaryPrompt, untrusted } from "./untrusted";
const checkSchema = z.object({
  criterion: z.number().int().nonnegative(),
  system: z.string(),
  kind: z.enum([
    "payable",
    "vendor",
    "message",
    "inbox_message",
    "source_invoice",
    "safe_refusal",
  ]),
  match: z.record(z.string()),
  expected: z.record(z.string()),
  sourcePdf: z.string().optional(),
  absent: z.boolean().default(false),
});
const judgment = z.object({ checks: z.array(checkSchema), reason: z.string() });
export type Verification = {
  status: "VERIFIED" | "PARTIAL" | "FAILED";
  criteria: { criterion: string; passed: boolean; evidence: string }[];
  tokens: number;
  cost: number;
  freshEvidence: unknown;
};
export async function verify(
  employee: Employee,
  runId: string,
  task: string,
  spec: TaskSpec,
  humanAnswers: string[],
  provider: Provider,
): Promise<Verification> {
  const session = new BrowserSession(employee, runId, true);
  const evidence: Record<string, unknown> = {},
    records: Record<string, Record<string, string>[]> = {},
    pdfs: Record<string, string> = {};
  try {
    await session.start();
    for (const [system, cfg] of Object.entries(employee.connectors)) {
      await session.login(system, cfg.credentialHandle);
      await session.navigate(cfg.url);
      await session.observe();
      const kind =
        system === "erp"
          ? "payable"
          : system === "mail"
            ? "message"
            : "source_invoice";
      records[system + ":" + kind] = await readRecords(session, kind);
      evidence[system] = untrusted(
        await session.page!.locator("body").innerText(),
        cfg.url,
      );
      if (system === "erp") {
        await session.navigate(cfg.url + "/vendors");
        records[system + ":vendor"] = await readRecords(session, "vendor");
      }
      if (system === "mail") {
        const inboxLinks = await session
          .page!.locator("tbody a")
          .evaluateAll((nodes) =>
            nodes.map((n) => (n as HTMLAnchorElement).href),
          );
        const inbox: Record<string, string>[] = [];
        for (const url of inboxLinks) {
          await session.navigate(url);
          inbox.push(...(await readRecords(session, "message")));
        }
        records[system + ":source_message"] = inbox;
        records[system + ":inbox_message"] = inbox;
        await session.navigate(cfg.url + "/sent");
        const links = await session
          .page!.locator("tbody a")
          .evaluateAll((nodes) =>
            nodes.map((n) => (n as HTMLAnchorElement).href),
          );
        const sent: Record<string, string>[] = [];
        for (const url of links) {
          await session.navigate(url);
          sent.push(...(await readRecords(session, "message")));
        }
        records[system + ":message"] = sent;
      }
      if (system === "portal") {
        const details: string[] = [];
        for (let page = 1; page <= 20; page++) {
          await session.navigate(cfg.url + "?page=" + page);
          details.push(
            ...(await session
              .page!.locator("tbody a")
              .evaluateAll((nodes) =>
                nodes.map((n) => (n as HTMLAnchorElement).href),
              )),
          );
          if (
            !(await session
              .page!.getByRole("link", { name: "Next page", exact: true })
              .count())
          )
            break;
        }
        for (const url of [...new Set(details)]) {
          await session.navigate(url);
          await session.observe();
          const link = session.page!.locator("a[download]");
          if (!(await link.count())) continue;
          const [d] = await Promise.all([
            session.page!.waitForEvent("download"),
            link.click(),
          ]);
          const filename = d.suggestedFilename().replace(/[^a-z0-9_.-]/gi, "_");
          const path = session.file(filename);
          await d.saveAs(path);
          pdfs[filename] = String(
            (
              await extractText(new Uint8Array(await readFile(path)), {
                mergePages: true,
              })
            ).text,
          );
          const text = pdfs[filename];
          records[system + ":source_invoice"].push({
            vendor: /^Vendor:\s*(.+)$/m.exec(text)?.[1] || text.split("\n")[0],
            number:
              /(?:Invoice number:\s*|^INVOICE\s+)(\S+)/m.exec(text)?.[1] || "",
            amount:
              /(?:Amount\s*INR\s*:|Total\s*INR)\s*([\d,]+(?:\.\d{2})?)/i
                .exec(text)?.[1]
                ?.replace(/,/g, "") || "",
            due:
              /(?:Due date:|Payment due)\s*(\d{4}-\d{2}-\d{2})/i.exec(
                text,
              )?.[1] || "",
            date:
              /(?:Invoice date:|Date:)\s*(\d{4}-\d{2}-\d{2})/i.exec(
                text,
              )?.[1] || "",
            pdf: filename,
          });
        }
      }
    }
    const response = await provider.json(
      boundaryPrompt +
        " You are an independent verifier. You see the original goal, fixed success criteria, human answers, and FRESH browser state and PDFs. You do not see actor claims. Propose checks for EVERY criterion. Matching an unrelated row does not satisfy the goal. Prefer exact field comparisons. safe_refusal is only applicable to an unsafe or impossible goal, never to a successful operational goal. Return {checks:[{criterion:0,system,kind,match:{},expected:{},sourcePdf?,absent:false}],reason}. For invoice entries, require sourcePdf and expected vendor/number/amount/due. For duplicates, confirm the existing row and original PDF; do not use absent checks. For contact updates, require expected email/phone/notes. For inbox summaries use kind inbox_message and fresh inbox fields. For sent messages, require expected recipient/subject/body. Each criterion must have substantive checks.",
      JSON.stringify({
        task,
        spec,
        humanAnswers,
        evidence,
        records: Object.fromEntries(
          Object.entries(records).map(([k, v]) => [
            k,
            untrusted(JSON.stringify(v), k),
          ]),
        ),
        pdfs: Object.fromEntries(
          Object.entries(pdfs).map(([k, v]) => [k, untrusted(v, k)]),
        ),
      }),
    );
    const proposed = judgment.parse(response.value);
    const results = spec.criteria.map((criterion, index) => {
      const checks = proposed.checks.filter((c) => c.criterion === index);
      const evaluated = checks.map((check) => {
        if (check.kind === "safe_refusal")
          return {
            passed: false,
            evidence:
              "A refusal needs operator review and is never marked VERIFIED.",
          };
        const candidates = (
          records[check.system + ":" + check.kind] || []
        ).filter(
          (row) =>
            Object.keys(check.match).length > 0 &&
            Object.entries(check.match).every(([k, v]) => equal(k, row[k], v)),
        );
        if (check.absent)
          return {
            passed: false,
            evidence: "Absence is not sufficient evidence of task completion.",
          };
        if (!candidates.length)
          return {
            passed: false,
            evidence: "No independently observed matching record.",
          };
        let passed =
          Object.keys(check.expected).length > 0 &&
          candidates.some((row) =>
            Object.entries(check.expected).every(([k, v]) =>
              equal(k, row[k], v),
            ),
          );
        if (check.kind === "payable") {
          const text = check.sourcePdf ? pdfs[check.sourcePdf] : undefined;
          passed =
            passed &&
            Boolean(text) &&
            ["vendor", "number", "amount", "due"].every((k) =>
              Boolean(check.expected[k]),
            );
          if (text) {
            passed =
              passed &&
              text.includes(check.expected.vendor) &&
              text.includes(check.expected.number) &&
              sourceHasAmount(text, check.expected.amount);
            if (!text.includes(check.expected.due))
              passed =
                passed &&
                humanAnswers.some((a) => a.includes(check.expected.due));
          }
        }
        if (check.kind === "vendor") {
          passed =
            passed &&
            ["email", "phone", "notes"].every((k) =>
              Boolean(check.expected[k]),
            );
          passed =
            passed &&
            candidates.some((row) =>
              (records["mail:source_message"] || []).some(
                (m) =>
                  m.sender.split("@")[1] === row.domain &&
                  row.notes.includes(m.sender) &&
                  row.notes.includes(m.subject) &&
                  m.body.includes(row.email) &&
                  m.body.includes(row.phone),
              ),
            );
        }
        if (check.kind === "message") {
          passed =
            passed &&
            ["recipient", "subject", "body"].every((k) =>
              Boolean(check.expected[k]),
            );
          const today = new Date().toISOString().slice(0, 10);
          const overdue = (records["erp:payable"] || []).filter(
            (p) => p.due < today && p.status !== "paid",
          );
          passed =
            passed &&
            candidates.some((row) =>
              overdue.every(
                (p) =>
                  row.body.includes(p.vendor) &&
                  row.body.includes(p.number) &&
                  row.body
                    .replace(/,/g, "")
                    .includes(String(Number(p.amount))) &&
                  row.body.includes(
                    String(
                      Math.floor(
                        (Date.parse(today) - Date.parse(p.due)) / 86400000,
                      ),
                    ),
                  ),
              ),
            );
        }
        return {
          passed,
          evidence: JSON.stringify({
            kind: check.kind,
            match: check.match,
            expected: check.expected,
            observed: candidates,
            sourcePdf: check.sourcePdf,
          }),
        };
      });
      return {
        criterion,
        passed: checks.length > 0 && evaluated.every((e) => e.passed),
        evidence: untrusted(
          evaluated.map((e) => e.evidence).join("\n") ||
            "Verifier produced no substantive check.",
          "independent verifier browser",
        ),
      };
    });
    const count = results.filter((r) => r.passed).length;
    return {
      status:
        count === results.length ? "VERIFIED" : count ? "PARTIAL" : "FAILED",
      criteria: results,
      tokens: response.tokens,
      cost: response.cost,
      freshEvidence: { records, pdfNames: Object.keys(pdfs) },
    };
  } finally {
    await session.close();
  }
}
async function readRecords(session: BrowserSession, kind: string) {
  return session.page!.locator(`[data-record="${kind}"]`).evaluateAll((nodes) =>
    nodes.map((n) => {
      const out: Record<string, string> = {};
      for (const field of n.querySelectorAll("[data-field]"))
        out[field.getAttribute("data-field")!] = (
          field.textContent || ""
        ).trim();
      return out;
    }),
  );
}
function equal(key: string, a: string | undefined, b: string) {
  return key === "amount" ? Number(a) === Number(b) : a === b;
}
export function sourceHasAmount(text: string, amount: string) {
  const values = [
    ...text.matchAll(
      /(?:Amount\s*INR\s*:|Total\s*INR)\s*([\d,]+(?:\.\d{2})?)/gi,
    ),
  ].map((m) => Number(m[1].replace(/,/g, "")));
  return values.includes(Number(amount));
}
