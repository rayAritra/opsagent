import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { query } from "@opsagent/db";
import { validSession } from "@opsagent/db/security";
export async function organization() {
  const [org] = await query<{ org_id: string; name: string }>(
    "SELECT org_id,name FROM platform.orgs ORDER BY id LIMIT 1",
  );
  if (!org) throw Error("Database not seeded. Run npm run setup.");
  if (
    !validSession(
      (await cookies()).get("opsagent_console")?.value,
      "console:" + org.org_id,
    )
  )
    redirect("/login");
  return org;
}
