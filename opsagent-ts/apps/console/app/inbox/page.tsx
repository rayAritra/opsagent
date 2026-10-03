import { query } from "@opsagent/db";
import { organization } from "../../lib/auth";
import { Shell } from "../../components/shell";
import { InboxCards } from "../../components/inbox-cards";
import type { Approval, Question } from "../../components/human-card";
export const dynamic = "force-dynamic";
export default async function Inbox() {
  const org = await organization();
  const [approvals, questions] = await Promise.all([
    query<Approval>(
      "SELECT * FROM platform.approvals WHERE org_id=$1 AND status=$2 ORDER BY created_at",
      [org.org_id, "PENDING"],
    ),
    query<Question>(
      "SELECT * FROM platform.questions WHERE org_id=$1 AND status=$2 ORDER BY created_at",
      [org.org_id, "PENDING"],
    ),
  ]);
  return (
    <Shell>
      <div className="page-heading">
        <div>
          <span className="eyebrow">HUMAN IN THE LOOP</span>
          <h1>Your attention, where it matters</h1>
          <p className="muted">
            Review exact actions and unblock your employees.
          </p>
        </div>
      </div>
      <InboxCards approvals={approvals} questions={questions} />
    </Shell>
  );
}
