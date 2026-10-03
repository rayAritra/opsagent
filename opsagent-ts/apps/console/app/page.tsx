import Link from "next/link";
import {
  Activity,
  CheckCircle2,
  Inbox,
  Info,
  ArrowUpRight,
} from "lucide-react";
import { query } from "@opsagent/db";
import { providerAvailable } from "@opsagent/core";
import { organization } from "../lib/auth";
import { Shell } from "../components/shell";
import { Card } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { CommandBar } from "../components/command";
export const dynamic = "force-dynamic";
export default async function Home() {
  const org = await organization();
  const [employees, runs] = await Promise.all([
    query<{ id: string; name: string }>(
      "SELECT id,name FROM platform.ai_employees WHERE org_id=$1 ORDER BY created_at",
      [org.org_id],
    ),
    query<{
      id: string;
      task: string;
      status: string;
      created_at: Date;
      name: string;
    }>(
      "SELECT r.id,r.task,r.status,r.created_at,e.name FROM platform.runs r JOIN platform.ai_employees e ON e.id=r.employee_id AND e.org_id=r.org_id WHERE r.org_id=$1 ORDER BY r.created_at DESC LIMIT 20",
      [org.org_id],
    ),
  ]);
  const [stats] = await query<{
    active: string;
    completed: string;
    pending: string;
  }>(
    `SELECT count(*) FILTER(WHERE status IN ('UNDERSTANDING','PLANNING','EXECUTING','VERIFYING')) AS active,count(*) FILTER(WHERE status='COMPLETED') AS completed,count(*) FILTER(WHERE status IN ('AWAITING_APPROVAL','AWAITING_INPUT')) AS pending FROM platform.runs WHERE org_id=$1`,
    [org.org_id],
  );
  const enabled = providerAvailable();
  return (
    <Shell>
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR OPERATIONS, IN MOTION</span>
          <h1>Command center</h1>
          <p className="muted">
            Delegate the work. Stay in control of the decisions.
          </p>
        </div>
        <Badge tone="green">SANDBOX</Badge>
      </div>
      <div className="grid3">
        <Card className="stat">
          <div>
            <span className="stat-label">Active operations</span>
            <strong>{stats.active}</strong>
          </div>
          <Activity />
        </Card>
        <Card className="stat">
          <div>
            <span className="stat-label">Verified completions</span>
            <strong>{stats.completed}</strong>
          </div>
          <CheckCircle2 />
        </Card>
        <Card className="stat">
          <div>
            <span className="stat-label">Needs your attention</span>
            <strong>{stats.pending}</strong>
          </div>
          <Inbox />
        </Card>
      </div>
      <CommandBar employees={employees} enabled={enabled} />
      {!enabled && (
        <div className="banner">
          <Info size={18} />
          <div>
            <strong>Connect a model to start autonomous runs</strong>
            <p className="muted">
              The workspace and company sandbox are ready to explore. Add your
              provider API key to the local .env, then restart the apps and
              worker. No runs are simulated.
            </p>
          </div>
        </div>
      )}
      <div className="section-heading">
        <h2>Recent operations</h2>
        <span className="muted text-xs">Persisted runs · Live evidence</span>
      </div>
      <Card className="table-card">
        <table>
          <thead>
            <tr>
              <th>OPERATION</th>
              <th>AI EMPLOYEE</th>
              <th>STATUS</th>
              <th>STARTED</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td className="task-cell">
                  <Link href={"/runs/" + r.id}>{r.task}</Link>
                  <small>{r.id.slice(0, 8)}</small>
                </td>
                <td>{r.name}</td>
                <td>
                  <Badge
                    tone={
                      r.status === "COMPLETED"
                        ? "green"
                        : r.status.startsWith("AWAITING")
                          ? "amber"
                          : r.status === "FAILED"
                            ? "red"
                            : "blue"
                    }
                  >
                    {r.status.replaceAll("_", " ")}
                  </Badge>
                </td>
                <td className="muted">
                  {new Date(r.created_at).toLocaleString("en-IN", {
                    timeZone: "Asia/Kolkata",
                  })}
                </td>
                <td>
                  <Link href={"/runs/" + r.id}>
                    <ArrowUpRight size={15} />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!runs.length && (
          <div className="empty">
            Your first operation starts here.
            <br />
            <small>
              Configure an employee, connect a model, and delegate a task.
            </small>
          </div>
        )}
      </Card>
      <div className="section-heading">
        <h2>Your AI team</h2>
        <Link href="/employees" className="muted text-xs">
          Manage employees →
        </Link>
      </div>
      <div className="grid3">
        {employees.map((e) => (
          <Link href={"/employees/" + e.id} key={e.id}>
            <Card className="employee-card">
              <span className="avatar">✦</span>
              <div>
                <strong>{e.name}</strong>
                <small>Configurable tools, policies & knowledge</small>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </Shell>
  );
}
