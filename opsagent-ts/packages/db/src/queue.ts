import { PgBoss } from "pg-boss";
import { env } from "./config";
export const queueName = "employee-run";
let singleton: Promise<PgBoss> | undefined;
export function queue() {
  return (singleton ??= (async () => {
    const boss = new PgBoss(env.DATABASE_URL);
    boss.on("error", console.error);
    await boss.start();
    await boss.createQueue(queueName, {
      retryLimit: 3,
      retryDelay: 5,
      expireInSeconds: 900,
    });
    return boss;
  })());
}
export async function enqueue(orgId: string, runId: string) {
  const boss = await queue();
  return boss.send(
    queueName,
    { orgId, runId },
    { singletonKey: runId, retryLimit: 3 },
  );
}
