# Demo acceptance status

Recorded on 2026-10-02. All five CLI commands were actually invoked with the simulated-human file.
Each exited with status 1 and produced a FAILED report because no API key is configured.
No browser business actions or LLM calls were made. These are blocked live acceptance checks,
not successful demonstrations. Full command outputs are in results.json.

| Scenario | Live status |
| --- | --- |
| Latest high-value invoice | BLOCKED: API key missing |
| Existing payable / duplicate trap | BLOCKED: API key missing |
| Missing due date / human question | BLOCKED: API key missing |
| Trusted billing email / impostor | BLOCKED: API key missing |
| Overdue finance summary | BLOCKED: API key missing |

Local integration coverage separately validates source extraction, approval policy, duplicate blocking,
missing-date blocking, vendor-domain checks, mail forms and independent browser readback.
After configuring .env, run `python -m demos.run` with `python run_all.py` running in another terminal.
