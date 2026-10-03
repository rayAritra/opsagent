"use client";
import { useCallback, useEffect, useState } from "react";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { HumanCard, type Approval, type Question } from "./human-card";
type Snapshot = {
  run: {
    id: string;
    task: string;
    status: string;
    checkpoint: {
      spec?: {
        outcome: string;
        criteria: string[];
        policies: { rule: string; citation: string }[];
      };
      plan?: string[];
      steps: number;
      tokens: number;
      cost: number;
      costKnown?:boolean;
      recoveries: number;
    };
    report?: {
      verification: {
        status: string;
        criteria?: { criterion: string; passed: boolean; evidence: string }[];
        reason?: string;
      };
      metrics: unknown;
    };
  };
  steps: {
    id: string;
    index: number;
    tool: string;
    args: unknown;
    result: unknown;
    screenshot?: string;
    latency: number;
    error_type?: string;
  }[];
  events: { id: number; kind: string; payload: unknown }[];
  approvals: Approval[];
  questions: Question[];
};
export function RunView({ id }: { id: string }) {
  const [data, setData] = useState<Snapshot>(),
    [error, setError] = useState("");
  const reload = useCallback(async () => {
    try {
      const r = await fetch("/api/runs/" + id);
      if (!r.ok) throw Error("Unable to load run");
      setData((await r.json()) as Snapshot);
    } catch (e) {
      setError(String(e));
    }
  }, [id]);
  useEffect(() => {
    void reload();
    let cursor = 0;
    let source: EventSource | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    function connect() {
      if (disposed) return;
      source = new EventSource(`/api/runs/${id}/events?after=${cursor}`);
      source.onmessage = (e) => {
        const event = JSON.parse(e.data) as { id: number };
        cursor = event.id;
        void reload();
      };
      source.onerror = () => {
        source?.close();
        timer = setTimeout(connect, 1500);
      };
    }
    connect();
    return () => {
      disposed = true;
      source?.close();
      if (timer) clearTimeout(timer);
    };
  }, [id, reload]);
  if (!data) return <Card>{error || "Loading operation…"}</Card>;
  const { run, steps, approvals, questions, events } = data,
    cp = run.checkpoint;
  const latest = steps.filter((s) => s.screenshot).at(-1);
  const report = run.report;
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">OPERATION {id.slice(0, 8)}</span>
          <h1 className="text-2xl">{run.task}</h1>
          <p className="muted">
            Every decision, action, and recovery is persisted.
          </p>
        </div>
        <Badge
          tone={
            run.status === "COMPLETED"
              ? "green"
              : run.status.startsWith("AWAITING")
                ? "amber"
                : "blue"
          }
        >
          {run.status.replaceAll("_", " ")}
        </Badge>
      </div>
      <div className="state-strip">
        {[
          "QUEUED",
          "UNDERSTANDING",
          "PLANNING",
          "EXECUTING",
          "AWAITING_APPROVAL",
          "AWAITING_INPUT",
          "VERIFYING",
          "COMPLETED",
        ].map((s) => (
          <span
            className={"state-dot " + (s === run.status ? "active" : "")}
            key={s}
          >
            {s.replaceAll("_", " ")}
          </span>
        ))}
      </div>
      <div className="run-grid">
        <div className="stack">
          {approvals
            .filter((a) => a.status === "PENDING")
            .map((a) => (
              <HumanCard key={a.id} approval={a} onDone={() => void reload()} />
            ))}
          {questions
            .filter((q) => q.status === "PENDING")
            .map((q) => (
              <HumanCard key={q.id} question={q} onDone={() => void reload()} />
            ))}
          {cp.spec && (
            <Card>
              <h2>Success criteria</h2>
              <p className="muted text-xs">{cp.spec.outcome}</p>
              <ul className="mt-4 space-y-3">
                {cp.spec.criteria.map((c, i) => (
                  <li key={i} className="row">
                    <Badge tone="blue">{i + 1}</Badge>
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
              <details className="mt-4">
                <summary className="muted text-xs">
                  Applicable procedures
                </summary>
                <pre>{JSON.stringify(cp.spec.policies, null, 2)}</pre>
              </details>
            </Card>
          )}
          <Card>
            <h2>
              Execution timeline{" "}
              <span className="muted text-xs ml-2">{steps.length} steps</span>
            </h2>
            {!steps.length && (
              <p className="muted">Waiting for the worker’s next checkpoint.</p>
            )}
            {steps.map((s) => (
              <div
                className={"step " + (s.error_type ? "recovery" : "")}
                key={s.id}
              >
                <div className="step-head">
                  <strong>
                    {s.index}. {s.tool}
                  </strong>
                  <span className="muted">
                    {s.latency} ms{" "}
                    {s.error_type && <Badge tone="amber">{s.error_type}</Badge>}
                  </span>
                </div>
                <details>
                  <summary>Arguments and observed result</summary>
                  <pre>
                    {JSON.stringify(
                      { args: s.args, result: s.result },
                      null,
                      2,
                    )}
                  </pre>
                </details>
              </div>
            ))}
            {events
              .filter((e) =>
                ["policy", "recovery", "verification"].includes(e.kind),
              )
              .map((e) => (
                <div key={e.id} className={"step " + e.kind}>
                  <div className="step-head">
                    <Badge tone={e.kind === "recovery" ? "amber" : "blue"}>
                      {e.kind.toUpperCase()}
                    </Badge>
                  </div>
                  <details>
                    <summary>Evidence</summary>
                    <pre>{JSON.stringify(e.payload, null, 2)}</pre>
                  </details>
                </div>
              ))}
          </Card>
          {report && (
            <Card>
              <div className="row mb-4">
                <h2 className="mb-0">Independent verification</h2>
                <Badge
                  tone={
                    report.verification.status === "VERIFIED"
                      ? "green"
                      : report.verification.status === "PARTIAL"
                        ? "amber"
                        : "red"
                  }
                >
                  {report.verification.status}
                </Badge>
              </div>
              {report.verification.reason && (
                <p>{report.verification.reason}</p>
              )}
              {report.verification.criteria?.map((c, i) => (
                <div className="mt-4" key={i}>
                  <div className="row">
                    <Badge tone={c.passed ? "green" : "red"}>
                      {c.passed ? "PASS" : "FAIL"}
                    </Badge>
                    <strong>{c.criterion}</strong>
                  </div>
                  <details className="mt-2">
                    <summary className="muted text-xs">Fresh evidence</summary>
                    <pre>{c.evidence}</pre>
                  </details>
                </div>
              ))}
              <div className="actions mt-5">
                <a href={"/api/runs/" + id + "/report"}>
                  <Button variant="outline" size="sm">
                    Export report
                  </Button>
                </a>
                <a href={"/api/runs/" + id + "/trace"}>
                  <Button variant="outline" size="sm">
                    Download trace JSON
                  </Button>
                </a>
              </div>
            </Card>
          )}
        </div>
        <div className="stack">
          <Card>
            <h2>Run budget</h2>
            <div className="grid grid-cols-2 gap-5">
              <div>
                <small>Steps</small>
                <strong>{cp.steps} / 60</strong>
              </div>
              <div>
                <small>Tokens</small>
                <strong>{cp.tokens.toLocaleString()}</strong>
              </div>
              <div>
                <small>Estimated cost</small>
                <strong>{cp.costKnown===false?'Unmeasured':'$'+cp.cost.toFixed(4)}</strong>
              </div>
              <div>
                <small>Recoveries</small>
                <strong>{cp.recoveries}</strong>
              </div>
            </div>
          </Card>
          <Card>
            <h2>Current plan</h2>
            <ol className="space-y-4">
              {cp.plan?.map((p, i) => (
                <li key={i} className="row">
                  <Badge>{i + 1}</Badge>
                  <span>{p}</span>
                </li>
              )) || (
                <p className="muted">Plan will appear after understanding.</p>
              )}
            </ol>
          </Card>
          <Card>
            <h2>Latest browser evidence</h2>
            {latest ? (
              <a
                href={`/api/artifacts/${id}/${latest.screenshot}`}
                target="_blank"
                rel="noreferrer"
              >
                <img
                  alt="Latest browser screenshot"
                  className="screenshot"
                  src={`/api/artifacts/${id}/${latest.screenshot}`}
                />
              </a>
            ) : (
              <div className="empty">No screenshot yet.</div>
            )}
          </Card>
          {steps.some((s) => s.screenshot) && (
            <Card>
              <h2>Evidence gallery</h2>
              <div className="grid grid-cols-2 gap-2">
                {steps
                  .filter((s) => s.screenshot)
                  .map((s) => (
                    <a
                      key={s.id}
                      href={`/api/artifacts/${id}/${s.screenshot}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <img
                        className="screenshot"
                        alt={"Step " + s.index}
                        src={`/api/artifacts/${id}/${s.screenshot}`}
                      />
                    </a>
                  ))}
              </div>
            </Card>
          )}
          {!["COMPLETED", "FAILED", "ESCALATED", "CANCELLED"].includes(
            run.status,
          ) && (
            <Button
              variant="destructive"
              onClick={async () => {
                await fetch(`/api/runs/${id}/cancel`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: "{}",
                });
                await reload();
              }}
            >
              Cancel operation
            </Button>
          )}
        </div>
      </div>
      {error && <p className="error-text">{error}</p>}
    </>
  );
}
