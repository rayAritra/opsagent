"use client";
import { useRouter } from "next/navigation";
import { HumanCard, type Approval, type Question } from "./human-card";
import { Card } from "./ui/card";
export function InboxCards({
  approvals,
  questions,
}: {
  approvals: Approval[];
  questions: Question[];
}) {
  const router = useRouter();
  return (
    <div className="stack">
      {approvals.map((a) => (
        <HumanCard key={a.id} approval={a} onDone={() => router.refresh()} />
      ))}
      {questions.map((q) => (
        <HumanCard key={q.id} question={q} onDone={() => router.refresh()} />
      ))}
      {!approvals.length && !questions.length && (
        <Card className="empty">
          You’re all caught up.
          <small>Approval requests and questions will appear here.</small>
        </Card>
      )}
    </div>
  );
}
