"use client";
import { useState } from "react";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
export type Approval = {
  id: string;
  run_id: string;
  status: string;
  reason: string;
  citation: string;
  action: unknown;
};
export type Question = {
  id: string;
  run_id: string;
  status: string;
  question: string;
  answer?: string;
};
export function HumanCard({
  approval,
  question,
  onDone,
}: {
  approval?: Approval;
  question?: Question;
  onDone?: () => void;
}) {
  const [text, setText] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const item = approval || question;
  if (!item) return null;
  async function reply(answer: string) {
    setBusy(true);
    try {
      const r = await fetch(
        `/api/${approval ? "approval" : "question"}/${item!.id}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answer, comment: approval ? text : "" }),
        },
      );
      if (!r.ok) throw Error(((await r.json()) as { error: string }).error);
      onDone?.();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className={approval ? "approval" : "question"}>
      <div className="row mb-3">
        <Badge tone={approval ? "blue" : "amber"}>
          {approval ? "APPROVAL REQUIRED" : "INPUT REQUIRED"}
        </Badge>
        <a className="muted text-xs" href={"/runs/" + item.run_id}>
          Open run →
        </a>
      </div>
      <h2>
        {approval
          ? "Review this exact action"
          : "Your employee needs an answer"}
      </h2>
      {approval ? (
        <>
          <p>{approval.reason}</p>
          <small>{approval.citation}</small>
          <pre>{JSON.stringify(approval.action, null, 2)}</pre>
        </>
      ) : (
        <p>{question!.question}</p>
      )}
      {item.status === "PENDING" ? (
        <>
          <label className="field mt-4">
            <span>{approval ? "Optional review comment" : "Your answer"}</span>
            <textarea
              aria-label={approval ? "Approval comment" : "Human answer"}
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={2}
            />
          </label>
          <div className="actions">
            {approval ? (
              <>
                <Button disabled={busy} onClick={() => void reply("approve")}>
                  Approve action
                </Button>
                <Button
                  variant="destructive"
                  disabled={busy}
                  onClick={() => void reply("reject")}
                >
                  Reject
                </Button>
              </>
            ) : (
              <Button
                disabled={busy || !text.trim()}
                onClick={() => void reply(text)}
              >
                Send answer
              </Button>
            )}
          </div>
        </>
      ) : (
        <Badge tone="green">{item.status}</Badge>
      )}
      {error && <p className="error-text">{error}</p>}
    </Card>
  );
}
