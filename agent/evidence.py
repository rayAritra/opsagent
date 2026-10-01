"""Independent source parsing shared by verification and submission guards."""

import re
from datetime import date
from decimal import Decimal
from pathlib import Path

import pdfplumber


def invoice_values(path: Path) -> dict:
    """Extract labeled values from source text, never from an agent claim."""
    with pdfplumber.open(path) as pdf:
        text = "\n".join(page.extract_text() or "" for page in pdf.pages)
    fields = {}
    for key, label in [
        ("invoice_no", "Invoice number"),
        ("amount", "Amount INR"),
        ("due", "Due date"),
        ("issued", "Invoice date"),
    ]:
        match = re.search(rf"{label}:\s*([^\n]+)", text)
        fields[key] = match[1].strip() if match else None
    if not fields["invoice_no"] or not fields["amount"] or not fields["issued"]:
        raise ValueError("Unsupported or incomplete source PDF layout; escalate instead of guessing.")
    fields["amount"] = f"{Decimal(fields['amount'].replace(',', '')):.2f}"
    fields["text"] = text
    return fields


def overdue_rows(rows: list[dict], today: date) -> list[dict]:
    """Compute overdue from displayed ERP values with integer calendar days."""
    return [
        dict(row, days_overdue=(today - date.fromisoformat(row["due"])).days)
        for row in rows
        if row["status"].lower() != "paid" and date.fromisoformat(row["due"]) < today
    ]
