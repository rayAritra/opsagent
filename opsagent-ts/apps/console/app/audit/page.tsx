import { query } from "@opsagent/db";
import { organization } from "../../lib/auth";
import { Shell } from "../../components/shell";
import { Card } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
export const dynamic = "force-dynamic";
export default async function Audit({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const org = await organization();
  const q = (await searchParams).q || "";
  const rows = await query<{
    id: string;
    actor: string;
    action: string;
    target: string;
    payload_hash: string;
    payload: unknown;
    created_at: Date;
  }>(
    "SELECT * FROM platform.audit_log WHERE org_id=$1 AND (action ILIKE $2 OR actor ILIKE $2 OR target ILIKE $2) ORDER BY created_at DESC LIMIT 200",
    [org.org_id, "%" + q + "%"],
  );
  return (
    <Shell>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ACCOUNTABILITY BY DEFAULT</span>
          <h1>Audit trail</h1>
          <p className="muted">
            Append-only events for actions, decisions, and credential use.
          </p>
        </div>
      </div>
      <form className="row mb-5">
        <input
          name="q"
          placeholder="Filter actor, action, or target"
          defaultValue={q}
        />
        <Button variant="outline">Filter</Button>
      </form>
      <Card className="table-card">
        <table>
          <thead>
            <tr>
              <th>TIME</th>
              <th>ACTOR</th>
              <th>ACTION</th>
              <th>TARGET / EVIDENCE</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="muted">
                  {new Date(r.created_at).toISOString().slice(0, 19)}
                </td>
                <td>{r.actor}</td>
                <td>{r.action}</td>
                <td>
                  <details>
                    <summary>{r.target.slice(0, 30)}</summary>
                    <small>SHA-256 {r.payload_hash}</small>
                    <pre>{JSON.stringify(r.payload, null, 2)}</pre>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <div className="empty">No matching audit events.</div>}
      </Card>
    </Shell>
  );
}
