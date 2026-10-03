import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { validSession } from "@opsagent/db/security";
import { query, env } from "@opsagent/db";
export async function authenticated(system: string) {
  return validSession((await cookies()).get("acme_" + system)?.value, system);
}
export async function requireSession(system: string) {
  if (!(await authenticated(system))) redirect(`/${system}/login`);
}
export async function chaos(system: string) {
  const [setting] = await query<{ value: boolean }>(
    "SELECT value FROM mock_portal.settings WHERE key='chaos'",
  );
  const enabled = setting?.value || env.OPSAGENT_CHAOS === 1;
  if (!enabled) return false;
  await new Promise((r) => setTimeout(r, 1000 + Math.random() * 2000));
  if (Math.random() < 0.2)
    throw Error("Temporary company service failure; retry this page.");
  if (Math.random() < 0.08) redirect(`/${system}/expire`);
  return true;
}
