import { it, expect } from "vitest";
import { query } from "../packages/db/src/index";
import { hash } from "../packages/db/src/security";
import { initialCheckpoint } from "../packages/core/src/types";
import { executeRun } from "../packages/core/src/runtime";
import { loadEmployee, loadRun } from "../packages/core/src/store";
import { invoiceProvider } from "./fixtures/invoice-provider";
const org = "00000000-0000-4000-8000-000000000001",
  employeeId = "00000000-0000-4000-8000-000000000002";
it("runtime parks exact approval, ends job, restores form and independently verifies resumed submission", async () => {
  const employee = await loadEmployee(org, employeeId);
  const [source] = await query<{
    id: string;
    vendor: string;
    number: string;
    amount: string;
    due: string;
  }>(
    "SELECT id,vendor,number,amount,due FROM mock_portal.invoices WHERE amount>50000 ORDER BY date DESC LIMIT 1",
  );
  await query("DELETE FROM mock_erp.payables WHERE vendor=$1 AND number=$2", [
    source.vendor,
    source.number,
  ]);
  const [run] = await query<{ id: string }>(
    "INSERT INTO platform.runs(org_id,employee_id,task,status,checkpoint) VALUES($1,$2,$3,$4,$5) RETURNING id",
    [
      org,
      employeeId,
      "High-value approval mechanics fixture; not measured autonomy",
      "QUEUED",
      JSON.stringify(initialCheckpoint()),
    ],
  );
  const provider = invoiceProvider(employee, source);
  try {
    await executeRun(org, run.id, provider);
    expect((await loadRun(org, run.id)).status).toBe("AWAITING_APPROVAL");
    const [approval] = await query<{
      id: string;
      action: { values: { amount: string } };
      fingerprint: string;
    }>("SELECT * FROM platform.approvals WHERE org_id=$1 AND run_id=$2", [
      org,
      run.id,
    ]);
    expect(approval.action.values.amount).toBe(source.amount);
    expect(approval.fingerprint).toBe(hash(approval.action));
    expect(
      (
        await query(
          "SELECT id FROM mock_erp.payables WHERE vendor=$1 AND number=$2",
          [source.vendor, source.number],
        )
      ).length,
    ).toBe(0);
    await query(
      "UPDATE platform.approvals SET status=$1 WHERE id=$2 AND org_id=$3",
      ["APPROVED", approval.id, org],
    );
    await executeRun(org, run.id, provider);
    const finished = await loadRun(org, run.id);
    expect(finished.status, JSON.stringify(finished.report)).toBe("COMPLETED");
    expect(JSON.stringify(finished.report)).toContain("VERIFIED");
    expect(
      (
        await query<{ status: string }>(
          "SELECT status FROM platform.approvals WHERE id=$1",
          [approval.id],
        )
      )[0].status,
    ).toBe("EXECUTED");
  } finally {
    await query("DELETE FROM mock_erp.payables WHERE vendor=$1 AND number=$2", [
      source.vendor,
      source.number,
    ]);
  }
}, 120000);
