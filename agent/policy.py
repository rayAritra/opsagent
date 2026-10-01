"""Risk-tier policy enforcement on real form values before browser submission."""

import hashlib
import json
import re
from decimal import Decimal
from pathlib import Path
from typing import Any

from agent.config import APPS, POLICIES
from agent.evidence import invoice_values
from agent.reader import Reader
from agent.tool_registry import REGISTRY, Risk, ToolFailure


def requires_amount_approval(amount: str) -> bool:
    """Apply the strict greater-than manager-approval threshold using exact money."""
    return Decimal(amount) > Decimal(str(POLICIES["approval_amount_above"]))


class Policy:
    """Separate staging, login and search from business mutations; fail closed."""

    async def inspect_action(self, ctx: Any, name: str, arguments: dict) -> dict | None:
        if name != "browser_click":
            if name in ("browser_type", "browser_select"):
                return None  # Staging a field does not mutate the business system.
            if REGISTRY[name].risk != Risk.READ:
                return {
                    "operation": name,
                    "values": arguments,
                    "reason": "New write tools require approval by default.",
                    "sop": "config/policies.yaml",
                }
            return None
        element = await ctx.browser.element(arguments["element_id"])
        info = await element.evaluate("""e=>{
         const f=e.form; const submit=f && (e.tagName==='BUTTON' || e.type==='submit');
         return {submit,tag:e.tagName,href:e.getAttribute('href'),method:f?.method,
           operation:f?.dataset.operation,action:f?.action,vendor:f?.dataset.vendor,
           values:f?Object.fromEntries([...new FormData(f)].filter(([k])=>!['csrf','password'].includes(k))):{}};
        }""")
        if not info["submit"]:
            return None
        if info["method"] == "get" or "/login" in info["action"]:
            return None
        operation = info.get("operation")
        if operation not in ("payable", "vendor", "send"):
            raise ToolFailure("PERMISSION_DENIED", "Unknown mutation form; no write is allowed.")
        expected_app = "mail" if operation == "send" else "erp"
        if not info["action"].startswith(APPS[expected_app] + "/"):
            raise ToolFailure("PERMISSION_DENIED", "Mutation form is outside its configured application.")
        return {
            "operation": operation,
            "values": info["values"],
            "vendor": info.get("vendor"),
            "url": info["action"],
        }

    async def evaluate(self, ctx: Any, action: dict | None) -> dict:
        """Return ALLOW/APPROVAL/DENY after fresh readback and source validation."""
        if action is None:
            return {"decision": "ALLOW"}
        op = action["operation"]
        values = action["values"]
        reason = action.get("reason", "")
        sop = action.get("sop", "")
        if op in ("payable", "vendor", "send"):
            async with Reader(ctx.workspace / "policy-evidence") as reader:
                if op == "payable":
                    rows = await reader.table("erp", "/", "payables")
                    if any(
                        r["vendor"] == values.get("vendor")
                        and r["invoice_no"] == values.get("invoice_no", "").strip()
                        for r in rows
                    ):
                        return {
                            "decision": "DENY",
                            "reason": "Existing vendor + invoice number. Never create a duplicate.",
                            "sop": "sops/invoice_processing.md",
                        }
                    docs = [invoice_values(Path(p)) for p in ctx.evidence.get("pdfs", {})]
                    match = next(
                        (
                            p
                            for p in docs
                            if p["invoice_no"] == values.get("invoice_no")
                            and values.get("vendor", "") in p["text"]
                        ),
                        None,
                    )
                    if not match or Decimal(values.get("amount", "0")) != Decimal(match["amount"]):
                        return {
                            "decision": "DENY",
                            "reason": "Payable must match an actually extracted source PDF.",
                            "sop": "sops/invoice_processing.md",
                        }
                    invoices = [r for r in await reader.invoices() if r["vendor"] == values.get("vendor")]
                    if not invoices or max(invoices, key=lambda r: r["issued"])["invoice_no"] != values.get(
                        "invoice_no"
                    ):
                        return {
                            "decision": "DENY",
                            "reason": "The selected PDF is not the newest invoice for this vendor.",
                            "sop": "sops/invoice_processing.md",
                        }
                    if match["due"]:
                        due_ok = values.get("due") == match["due"]
                    else:
                        answers = [q["answer"] or "" for q in ctx.store.run(ctx.run_id)["questions"]]
                        due_ok = any(
                            values.get("due") in re.findall(r"\d{4}-\d{2}-\d{2}", answer)
                            for answer in answers
                        )
                    if not due_ok:
                        return {
                            "decision": "DENY",
                            "reason": "Due date must match the PDF or a recorded human answer when absent.",
                            "sop": "sops/invoice_processing.md",
                        }
                    if requires_amount_approval(values["amount"]):
                        reason = "Amount exceeds INR 50,000; manager approval required."
                        sop = "sops/invoice_processing.md"
                elif op == "vendor":
                    vendors = await reader.table("erp", "/vendors", "vendors")
                    vendor = next((r for r in vendors if r["name"] == action["vendor"]), None)
                    messages = await reader.mail("inbox")
                    legitimate = [
                        m
                        for m in messages
                        if vendor
                        and m["sender"].rsplit("@", 1)[-1].lower() == vendor["domain"].lower()
                        and values.get("email", "") in m["body"]
                        and m["subject"] in values.get("notes", "")
                        and (
                            values.get("phone", "") == vendor["phone"]
                            or bool(values.get("phone"))
                            and values["phone"] in m["body"]
                        )
                    ]
                    if not legitimate:
                        return {
                            "decision": "DENY",
                            "reason": "No source email from the vendor domain supports the exact contact and notes.",
                            "sop": "sops/vendor_updates.md",
                        }
                    if POLICIES["approve_vendor_changes"]:
                        reason = "Vendor contact changes require approval; trusted source confirmed."
                        sop = "sops/vendor_updates.md"
                elif op == "send":
                    sent = await reader.mail("sent")
                    if any(
                        m["recipient"] == values.get("to")
                        and m["subject"] == values.get("subject")
                        and m["body"] == values.get("body")
                        for m in sent
                    ):
                        return {
                            "decision": "DENY",
                            "reason": "An identical message already appears in Sent. Inspect it instead of resending.",
                            "sop": "sops/reporting.md",
                        }
                    if not POLICIES["approve_external_send"]:
                        return {"decision": "ALLOW"}
                    reason = "External send requires human review of recipient, subject and body."
                    sop = "sops/reporting.md"
        for rule in ctx.spec.get("requirements", []):
            if op not in rule["applies_to"]:
                continue
            required = rule["kind"] == "approval_all_writes"
            if rule["kind"] == "amount_approval" and values.get("amount"):
                required = Decimal(values["amount"]) > Decimal(rule["threshold"])
            if required:
                reason = rule["description"]
                sop = rule["citation"]
        # SOP-derived restrictions may strengthen but cannot weaken static rules.
        requirements = " ".join(ctx.spec.get("constraints", [])).lower()
        if not reason and "approval" in requirements and op not in ("payable",):
            reason = "Task SOP constraints require approval."
            sop = "TaskSpec.constraints"
        fingerprint = hashlib.sha256(json.dumps(action, sort_keys=True).encode()).hexdigest()
        return {
            "decision": "APPROVAL" if reason else "ALLOW",
            "reason": reason,
            "sop": sop,
            "action": action,
            "fingerprint": fingerprint,
        }
