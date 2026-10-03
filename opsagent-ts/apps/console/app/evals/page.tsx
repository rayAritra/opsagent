import { query } from "@opsagent/db";
import { organization } from "../../lib/auth";
import { Shell } from "../../components/shell";
import { Card } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
export const dynamic = "force-dynamic";
export default async function Evals() {
  const org = await organization();
  const rows = await query<{
    id: string;
    chaos: boolean;
    results: {
      status: string;
      summary?: {
        falseVerified: number;
        policyViolations: number;
        successRate: number;
      };
      tasks?: unknown[];
      reason?: string;
    };
    created_at: Date;
  }>(
    "SELECT * FROM platform.evals WHERE org_id=$1 ORDER BY created_at DESC LIMIT 20",
    [org.org_id],
  );
  const latest = rows[0];
  return (
    <Shell>
      <div className="page-heading">
        <div>
          <span className="eyebrow">MEASURED, NEVER ASSUMED</span>
          <h1>Evaluation lab</h1>
          <p className="muted">
            Independent database oracles check what the verifier claims.
          </p>
        </div>
        <Badge tone="blue">FALSE VERIFIED IS THE HEADLINE METRIC</Badge>
      </div>
      <div className="grid3">
        {[
          ["False VERIFIED", latest?.results.summary?.falseVerified],
          ["Policy violations", latest?.results.summary?.policyViolations],
          [
            "Success rate",
            latest?.results.summary
              ? Math.round(latest.results.summary.successRate * 100) + "%"
              : undefined,
          ],
        ].map(([label, value]) => (
          <Card key={String(label)}>
            <span className="stat-label">{label}</span>
            <strong className="block text-3xl mt-3">
              {value === undefined ? "Unmeasured" : value}
            </strong>
          </Card>
        ))}
      </div>
      <div className="stack">
        {rows.map((r) => (
          <Card key={r.id}>
            <div className="row mb-4">
              <Badge tone={r.results.status === "BLOCKED" ? "amber" : "green"}>
                {r.results.status}
              </Badge>
              <strong>{r.chaos ? "Chaos suite" : "Normal suite"}</strong>
              <small>{new Date(r.created_at).toISOString()}</small>
            </div>
            {r.results.reason && <p className="muted">{r.results.reason}</p>}
            <details>
              <summary>Per-task outcomes and oracle evidence</summary>
              <pre>{JSON.stringify(r.results, null, 2)}</pre>
            </details>
          </Card>
        ))}
        {!rows.length && (
          <Card className="empty">
            No evaluations recorded.
            <small>
              Run npm run eval and npm run eval:chaos after adding a provider
              key.
            </small>
          </Card>
        )}
      </div>
    </Shell>
  );
}
