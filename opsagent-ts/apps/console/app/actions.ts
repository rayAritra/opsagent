"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { query } from "@opsagent/db";
import { signSession } from "@opsagent/db/security";
export async function login(form: FormData) {
  if (form.get("username") !== "demo" || form.get("password") !== "demo")
    redirect("/login?error=Invalid+credentials");
  const [org] = await query<{ org_id: string }>(
    "SELECT org_id FROM platform.orgs ORDER BY id LIMIT 1",
  );
  if (!org) throw Error("Run npm run setup first");
  (await cookies()).set(
    "opsagent_console",
    signSession("console:" + org.org_id),
    {
      httpOnly: true,
      sameSite: "strict",
      secure: false,
      path: "/",
      maxAge: 3600,
    },
  );
  redirect("/");
}
export async function logout() {
  (await cookies()).delete("opsagent_console");
  redirect("/login");
}
