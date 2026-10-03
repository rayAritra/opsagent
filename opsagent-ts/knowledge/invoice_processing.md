# Invoice processing SOP

Find the newest source invoice by invoice date, read its real PDF, and extract vendor, invoice number, amount INR, and due date. Search all payables for matching vendor + invoice number before entry. Never create a duplicate; report the existing record as the outcome. Amount strictly above INR 50,000 requires human approval with exact values. Missing due date requires requester input; do not invent one. Confirm the entered row field-by-field against the source PDF and the human answer.
