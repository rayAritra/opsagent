import type { Action, Employee, Requirement } from "./types";
export type Decision = {
  decision: "ALLOW" | "DENY" | "REQUIRE_APPROVAL";
  reason: string;
  citation: string;
};
export function evaluatePolicy(
  employee: Employee,
  action: Action,
  existing: Record<string, string>[] = [],
  requirements:Requirement[]=[],
): Decision {
  const deny = (reason: string): Decision => ({
    decision: "DENY",
    reason,
    citation: "Employee connector and safety policy",
  });
  let sopApproval:Decision|undefined;
  for(const rule of requirements.filter(r=>r.operation===action.operation)){
    if(rule.kind==='deny_operation')return {decision:'DENY',reason:'Task SOP forbids this operation',citation:rule.citation};
    if(rule.kind==='required_input'&&rule.field&&!action.values[rule.field])return {decision:'DENY',reason:'Required SOP input is missing: '+rule.field,citation:rule.citation};
    if(rule.kind==='require_approval'||rule.kind==='approval_above'&&rule.threshold!==undefined&&Number(action.values.amount)>rule.threshold)sopApproval={decision:'REQUIRE_APPROVAL',reason:'Task-specific SOP requires approval',citation:rule.citation};
  }
  if (!employee.policies.allowedOrigins.includes(new URL(action.url).origin))
    return deny("Connector origin is not allowed");
  if (action.operation === "invoice_create") {
    if (
      existing.some(
        (r) =>
          r.vendor === action.values.vendor &&
          r.number === action.values.number,
      )
    )
      return deny("Duplicate vendor and invoice number");
    if (!action.values.due || !/^\d{4}-\d{2}-\d{2}$/.test(action.values.due))
      return deny("A real due date is required; ask the requester");
    if (
      !Number.isFinite(Number(action.values.amount)) ||
      Number(action.values.amount) <= 0
    )
      return deny("Amount must be positive");
    if (Number(action.values.amount) > employee.policies.approvalAbove)
      return {
        decision: "REQUIRE_APPROVAL",
        reason: `Amount exceeds INR ${employee.policies.approvalAbove}`,
        citation: "invoice_processing.md: high-value invoices",
      };
  }
  if (
    (action.operation === "mail_send" || action.riskTier === "EXTERNAL_SEND") &&
    !employee.policies.allowedEmailDomains.includes(
      (action.values.to || "").split("@")[1]?.toLowerCase(),
    )
  )
    return deny("Recipient domain is not allowed by employee policy");
  if (action.operation === "vendor_update") {
    const sender = action.source?.sender.toLowerCase();
    if (!sender || sender.split("@")[1] !== action.domain?.toLowerCase())
      return deny("Source sender does not match the vendor registered domain");
    if (
      !action.source?.body.includes(action.values.email) ||
      !action.source?.body.includes(action.values.phone)
    )
      return deny(
        "Proposed contact values are not in the authenticated source message",
      );
    if (
      !action.values.notes.includes(action.source?.subject || "") ||
      !action.values.notes.includes(sender)
    )
      return deny("Notes must include source sender and subject");
  }
  if (
    employee.policies.requireApprovalFor.includes(action.operation) ||
    !["invoice_create"].includes(action.operation)
  )
    return {
      decision: "REQUIRE_APPROVAL",
      reason: "Human approval required for this exact submission",
      citation:
        action.operation === "vendor_update"
          ? "vendor_updates.md: contact changes"
          : action.operation === "mail_send"
            ? "reporting.md: outbound mail"
            : "Employee write policy",
    };
  if(sopApproval)return sopApproval;
  return {
    decision: "ALLOW",
    reason: "Within configured policy",
    citation: "invoice_processing.md",
  };
}
export function assertAllowedTool(employee: Employee, name: string) {
  if (!employee.allowed_tools.includes(name))
    throw Error("Employee is not allowed to use " + name);
}
