import Link from "next/link";
import { query } from "@opsagent/db";
import { organization } from "../../lib/auth";
import { Shell } from "../../components/shell";
import { Card } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
export const dynamic = "force-dynamic";
export default async function Employees() {
  const org = await organization();
  const rows = await query<{
    id: string;
    name: string;
    role_prompt: string;
    allowed_tools: string[];
  }>(
    "SELECT id,name,role_prompt,allowed_tools FROM platform.ai_employees WHERE org_id=$1 ORDER BY created_at",
    [org.org_id],
  );
  return (
    <Shell>
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR AI TEAM</span>
          <h1>Employees that work your way</h1>
          <p className="muted">
            Each role has its own tools, procedures, credentials, and memory.
          </p>
        </div>
        <Link href="/employees/new">
          <Button>Create employee</Button>
        </Link>
      </div>
      <div className="grid3">
        {rows.map((e) => (
          <Link key={e.id} href={"/employees/" + e.id}>
            <Card>
              <div className="employee-card mb-4">
                <span className="avatar">✦</span>
                <strong>{e.name}</strong>
              </div>
              <p className="muted text-xs">{e.role_prompt.slice(0, 140)}</p>
              <small className="mt-4">
                {e.allowed_tools.length} allowed capabilities · Configure →
              </small>
            </Card>
          </Link>
        ))}
      </div>
    </Shell>
  );
}
