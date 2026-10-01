# Six-minute demo script

This is a recording plan, not proof that the live agent tasks have passed. Configure a real API key and run the normal and chaos evaluations first. Replace the README video placeholder only after recording an actual successful demonstration. If a task fails, show and explain the real report; do not splice fabricated actions or scores into the video.

## Preparation

1. Start from seeded mock data with `python seed.py --reset`; stop any active tasks first.
2. Configure .env and open the dashboard at 127.0.0.1:8000 with `python run_all.py` running.
3. Keep ERP and Mail tabs available for independent human readback. Use demo/demo.
4. Open actual evaluation results and the Mermaid architecture. Rehearse approvals and a YYYY-MM-DD answer.
5. Because LLM latency is variable, state clearly if waits are sped up in the recording. Do not edit outcomes.

## 0:00–0:35 — Problem and scope

“Operations work crosses invoices, finance records and email. A useful agent needs to complete a narrow workflow, obey policy and show proof. OpsAgent operates three real local web apps, learns the procedure from company SOPs, and uses a separate browser to verify results. This is an AI-assisted prototype; I can explain the loop and every safety boundary.”

Show the request field, company workspace and plan/evidence areas. Mention that the prototype is a local sandbox, not access to real company finances.

## 0:35–2:05 — Latest invoice with approval

Enter `Process the latest invoice from Globex.` Show retrieval, the structured outcome and plan. Highlight that portal order is not newest-first and the agent searches/observes dates. Show the downloaded PDF and its INR 72,500 amount.

At the approval card: “The runtime reads the real staged form and binds my approval to these exact values. The invoice SOP requires approval above INR 50,000.” Approve. Show the ERP entry, final VERIFIED badge, per-field expected/observed values and original-document evidence.

If asked how this was verified: point out the fresh browser and original PDF hash check. The executor’s `finish` call alone never earns a VERIFIED result.

## 2:05–2:45 — Duplicate trap

Enter `Process Umbrella's latest invoice.` Show the existing ERP payable and unchanged row count. Explain the unique vendor/invoice constraint and independent before/after comparison. Correct completion is non-entry, not a second payable.

## 2:45–3:35 — Real chaos recovery

Turn chaos on. Choose a low-value invoice task not already entered, such as the Initech newest invoice. Show actual renamed controls, an actual service/session error if it occurs, and highlighted recovery events. Explain bounded retry/re-observation/login behavior. Do not claim an error occurred if this run did not inject one; use a genuinely recorded chaos trace from evaluation instead.

Explain uncertain-write handling: “A timeout after submission causes reconciliation, not a blind replay.” Show the honest final badge, including PARTIAL/FAILED if recovery cannot finish. Turn chaos off afterward.

## 3:35–4:30 — Legitimate vendor email versus impostor

Enter `Initech says their billing contact changed — update our records.` Show both inbox messages, the ERP trusted domain, the supported contact and the source subject in Notes. Explain why the personal-domain impostor is rejected. Approve the exact contact update. Show independent vendor readback.

The sender-domain demonstration is intentionally narrow; production requires authenticated mail metadata, not a trusted display string.

## 4:30–5:05 — Actual evaluation evidence

Open `evals/results.md`. State real completed/requested counts, success rate, verifier agreement and false VERIFIED count. Point to the independent SQL checker and varied/unsafe tasks. Human simulation supplies decisions and missing dates only; the model still selects every tool.

If credentials have still not been configured, say “Live results are blocked and unmeasured.” Do not describe the current table as a benchmark. The local safety suite passing is a different claim from autonomous task success.

## 5:05–6:00 — Architecture and engineering depth

Show `agent/runtime.py`, the tool decorator, policy boundary and verifier. Walk the loop in one sentence: understand, plan, act, observe, recover, independently verify and report.

Explain durable cards/checkpoints, bounded budgets and one worker. Finish with the production direction: per-tenant workers, vault-backed scoped credentials, APIs preferred through connectors, Temporal for long workflows, desktop adapters and eval regression gates.

End by naming one limitation you can defend and one concrete next milestone. Add the recorded video link to README and submit the repository only with truthful status and attribution.
