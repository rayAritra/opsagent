import { pool, query } from "@opsagent/db";
import { queue, queueName } from "@opsagent/db/queue";
import { executeRun } from "@opsagent/core/runtime";
import {Registry} from '@opsagent/core/registry';
const registry=await Registry.load();
for(const org of await query<{org_id:string}>('SELECT org_id FROM platform.orgs'))for(const tool of registry.tools.values())await query('INSERT INTO platform.tool_catalog(org_id,name,description,risk_tier) VALUES($1,$2,$3,$4) ON CONFLICT(org_id,name) DO UPDATE SET description=EXCLUDED.description,risk_tier=EXCLUDED.risk_tier',[org.org_id,tool.name,tool.description,tool.riskTier]);
const boss = await queue();
async function recover() {
  const active = await query<{ id: string; org_id: string }>(
    "SELECT id,org_id FROM platform.runs WHERE (status IN ('QUEUED','UNDERSTANDING','PLANNING','EXECUTING','VERIFYING') AND updated_at < now()-interval '60 seconds') OR (status='AWAITING_APPROVAL' AND EXISTS(SELECT 1 FROM platform.approvals a WHERE a.run_id=platform.runs.id AND a.org_id=platform.runs.org_id AND a.status IN ('APPROVED','REJECTED')) AND NOT EXISTS(SELECT 1 FROM platform.approvals a WHERE a.run_id=platform.runs.id AND a.org_id=platform.runs.org_id AND a.status='PENDING')) OR (status='AWAITING_INPUT' AND EXISTS(SELECT 1 FROM platform.questions q WHERE q.run_id=platform.runs.id AND q.org_id=platform.runs.org_id AND q.status='ANSWERED') AND NOT EXISTS(SELECT 1 FROM platform.questions q WHERE q.run_id=platform.runs.id AND q.org_id=platform.runs.org_id AND q.status='PENDING'))",
  );
  for (const run of active)
    await boss.send(
      queueName,
      { orgId: run.org_id, runId: run.id },
      { singletonKey: run.id + "-recovery-" + Math.floor(Date.now() / 60000) },
    );
}
await boss.work<{ orgId: string; runId: string }>(
  queueName,
  { batchSize: 1, pollingIntervalSeconds: 1 },
  async (jobs) => {
    for (const job of jobs) {
      const client = await pool.connect();
      try {
        const { orgId, runId } = job.data;
        const [lock] = (
          await client.query<{ locked: boolean }>(
            "SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked",
            [runId],
          )
        ).rows;
        if (!lock.locked) return;
        try {
          await executeRun(orgId, runId);
        } finally {
          await client.query(
            "SELECT pg_advisory_unlock(hashtextextended($1,0))",
            [runId],
          );
        }
      } finally {
        client.release();
      }
    }
  },
);
await recover();
const timer = setInterval(() => {
  void recover().catch(console.error);
}, 30000);
console.log("Durable browser worker ready");
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    clearInterval(timer);
    void boss
      .stop()
      .then(() => pool.end())
      .then(() => process.exit(0));
  });
