"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { query } from "@opsagent/db";
import { signSession } from "@opsagent/db/security";
import { requireSession } from "../lib/session";
const systemSchema = z.enum(["portal", "erp", "mail"]);
export async function login(form: FormData) {
  const system = systemSchema.parse(form.get("system"));
  if (form.get("username") !== "demo" || form.get("password") !== "demo")
    redirect(`/${system}/login?error=Invalid+credentials`);
  (await cookies()).set("acme_" + system, signSession(system), {
    httpOnly: true,
    sameSite: "strict",
    secure: false,
    path: "/" + system,
    maxAge: 3600,
  });
  redirect("/" + system);
}
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (s) =>
      !isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s,
    "Invalid calendar date",
  );
const payableSchema = z.object({
  vendor: z.string().min(1),
  number: z.string().min(1).max(100),
  amount: z.coerce.number().positive().max(100000000),
  due: date,
  notes: z.string().max(10000),
});
export async function createPayable(form: FormData) {
  await requireSession("erp");
  const data = payableSchema.safeParse(Object.fromEntries(form));
  if (!data.success)
    redirect(
      "/erp/new?error=" +
        encodeURIComponent(
          data.error.issues
            .map((i) => i.path.join(".") + ": " + i.message)
            .join("; "),
        ),
    );
  const p = data.data;
  const found = await query("SELECT id FROM mock_erp.vendors WHERE name=$1", [
    p.vendor,
  ]);
  if (!found.length) redirect("/erp/new?error=Unknown+vendor");
  try {
    await query(
      "INSERT INTO mock_erp.payables(vendor,number,amount,due,notes) VALUES($1,$2,$3,$4,$5)",
      [p.vendor, p.number, p.amount, p.due, p.notes],
    );
  } catch (e) {
    if ((e as { code?: string }).code === "23505")
      redirect("/erp/new?error=Duplicate+vendor+and+invoice+number");
    throw e;
  }
  revalidatePath("/erp");
  redirect("/erp?created=1");
}
export async function updateVendor(form: FormData) {
  await requireSession("erp");
  const result = z
    .object({
      id: z.string().min(1),
      email: z.string().email(),
      phone: z.string().min(5).max(40),
      notes: z.string().min(1).max(10000),
    })
    .safeParse(Object.fromEntries(form));
  if (!result.success)
    redirect(
      "/erp/vendors/" +
        String(form.get("id")) +
        "?error=" +
        encodeURIComponent(
          result.error.issues.map((i) => i.message).join("; "),
        ),
    );
  const p = result.data;
  await query(
    "UPDATE mock_erp.vendors SET email=$1,phone=$2,notes=$3 WHERE id=$4",
    [p.email, p.phone, p.notes, p.id],
  );
  revalidatePath("/erp/vendors");
  redirect("/erp/vendors?updated=1");
}
export async function sendMail(form: FormData) {
  await requireSession("mail");
  const result = z
    .object({
      to: z.string().email(),
      subject: z.string().min(1).max(200),
      body: z.string().min(1).max(50000),
    })
    .safeParse(Object.fromEntries(form));
  if (!result.success)
    redirect(
      "/mail/compose?error=" +
        encodeURIComponent(
          result.error.issues.map((i) => i.message).join("; "),
        ),
    );
  const p = result.data;
  await query(
    "INSERT INTO mock_mail.messages(sender,recipient,subject,body,folder) VALUES($1,$2,$3,$4,$5)",
    ["finance@acme.test", p.to, p.subject, p.body, "sent"],
  );
  revalidatePath("/mail/sent");
  redirect("/mail/sent?sent=1");
}
