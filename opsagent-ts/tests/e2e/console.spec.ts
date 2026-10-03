import { test, expect } from "@playwright/test";
import { query } from "../../packages/db/src/index";
import { initialCheckpoint } from "../../packages/core/src/types";
const org = "00000000-0000-4000-8000-000000000001",
  employee = "00000000-0000-4000-8000-000000000002";
async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Username", { exact: true }).fill("demo");
  await page.getByLabel("Password", { exact: true }).fill("demo");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Command center", exact: true }),
  ).toBeVisible();
}
test("console login, honest no-key state, theme and page navigation", async ({
  page,
}) => {
  await login(page);
  await expect(
    page.getByText("Connect a model to start autonomous runs", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Run task", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Toggle color theme", exact: true })
    .click();
  await expect(page.locator("html")).not.toHaveClass("dark");
  await page.getByRole("link", { name: "Human inbox", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your attention, where it matters" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Audit trail", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Audit trail", exact: true }),
  ).toBeVisible();
});
test("exact-value approval and SSE report update", async ({ page }) => {
  const [run] = await query<{ id: string }>(
    "INSERT INTO platform.runs(org_id,employee_id,task,status,checkpoint) VALUES($1,$2,$3,$4,$5) RETURNING id",
    [
      org,
      employee,
      "UI approval fixture â€” not an autonomous model run",
      "AWAITING_APPROVAL",
      JSON.stringify(initialCheckpoint()),
    ],
  );
  const [approval] = await query<{ id: string }>(
    "INSERT INTO platform.approvals(org_id,run_id,fingerprint,action,reason,citation) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
    [
      org,
      run.id,
      "fixture",
      JSON.stringify({
        operation: "invoice_create",
        values: { amount: "78500", number: "FIXTURE-UI" },
      }),
      "High-value payable requires approval",
      "invoice_processing.md",
    ],
  );
  await login(page);
  await page.goto("/runs/" + run.id);
  await expect(page.getByText("78500", { exact: false })).toBeVisible();
  await page
    .getByLabel("Approval comment", { exact: true })
    .fill("Reviewed exact values in browser test");
  await page
    .getByRole("button", { name: "Approve action", exact: true })
    .click();
  await expect
    .poll(async () => {
      const [a] = await query<{ status: string }>(
        "SELECT status FROM platform.approvals WHERE id=$1",
        [approval.id],
      );
      return a.status;
    })
    .toBe("APPROVED");
  await query(
    "INSERT INTO platform.run_events(org_id,run_id,kind,payload) VALUES($1,$2,$3,$4)",
    [org, run.id, "test", { test: "sse" }],
  );
  await expect(
    page.getByRole("button", { name: "Approve action", exact: true }),
  ).toHaveCount(0);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: "artifacts/console-run.png", fullPage: true });
});
test("second employee created entirely through UI with different tools and SOP", async ({
  page,
}) => {
  await login(page);
  await page.goto("/employees/new");
  await page.getByRole("textbox").first().fill("Vendor Relations Assistant");
  await page
    .locator("textarea")
    .first()
    .fill(
      "Maintain vendor relationships using authenticated vendor messages. Escalate all proposed changes for human review.",
    );
  await page
    .getByLabel("Connector configuration JSON")
    .fill(
      JSON.stringify({
        mail: {
          url: "http://127.0.0.1:3001/mail",
          credentialHandle: "vendor-mail",
        },
      }),
    );
  await page
    .getByRole("button", { name: "Save employee", exact: true })
    .click();
  await expect(page).toHaveURL(/\/employees\/[a-f0-9-]{36}$/);
  const id = page.url().split("/").at(-1)!;
  await page.getByRole("button", { name: "New document", exact: true }).click();
  await page
    .getByText("Title", { exact: true })
    .locator("..")
    .locator("input")
    .fill("vendor_relations.md");
  await page
    .getByText("Markdown content", { exact: true })
    .locator("..")
    .locator("textarea")
    .fill(
      "# Vendor relations\nOnly inspect authenticated vendor mail. Never update records without an approved change request.",
    );
  await page
    .getByRole("button", { name: "Save knowledge", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Knowledge saved");
  await page.getByText('Handle',{exact:true}).locator('..').locator('input').fill('vendor-mail');
  await page.getByText('Username',{exact:true}).locator('..').locator('input').fill('demo');
  await page.getByText('Password · write only',{exact:true}).locator('..').locator('input').fill('demo');
  await page.getByRole('button',{name:'Save credential',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('Encrypted credential saved');
  const [row] = await query<{ name: string; allowed_tools: string[] }>(
    "SELECT name,allowed_tools FROM platform.ai_employees WHERE id=$1 AND org_id=$2",
    [id, org],
  );
  expect(row.name).toBe("Vendor Relations Assistant");
  expect(row.allowed_tools).not.toContain("browser_click");
  await page.screenshot({
    path: "artifacts/console-employee.png",
    fullPage: true,
  });
});
