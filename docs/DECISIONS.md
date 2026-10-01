# Decisions

## Phase 1
- Real forms, separate SQLite databases, integer paise, CSRF and signed sessions.
- Idempotent seed preserves work unless explicitly reset.
- No API key available: live evaluations remain unmeasured; no scripted agent substitute.
- Disposable local embedded Python is excluded from Git; clean setup uses a standard venv.
## Phase 2
- Compact visible DOM controls are freshly numbered; stale IDs fail explicitly.
- Browser context blocks all requests outside configured local app origins, including redirects.
- File tools resolve paths before enforcing scope. Credentials use opaque references and login-only substitution.
- A typed decorated function automatically provides the provider schema and structured error boundary.

- Phase 1 acceptance: 8 HTTP tests passed. A Git ownership difference requires repository-scoped safe.directory for commits; no global Git configuration was changed.
- Dependencies are recorded in requirements.lock.txt to make fresh setup reproducible.
- Phase 2 acceptance: all 10 HTTP and real Chromium tests pass; SOP filenames normalized for Windows and Unix.
## Phase 3
- Typed criteria use a narrow set of independent state adapters. A separate browser rereads ERP, mail and original latest PDFs; it never trusts the executor's claim or scratchpad values.
- Source PDFs use independent labeled-value parsing and document hash comparison. Unsupported PDFs escalate rather than silently verify.
- Approval fingerprints include operation, target and exact staged values. Rejection is durable and blocks repeated operations in that run.
- Runs pause by checkpointing and releasing Chromium; a new Runtime consumes persisted answers/decisions and restores the draft in a fresh context.
- In-flight writes are checkpointed before submission. Uncertain writes are reconciled rather than blindly retried; duplicate payables and identical sent messages are blocked.
- Provider calls use native tool calling with exactly one action per iteration. A contract-only test fixture exercises lifecycle; no scripted provider exists in agent code.
- Live LLM acceptance remains unavailable without a user-supplied API key. Local integration checks verify the runtime mechanics independently.
- Phase 3 local acceptance: 23 checks passed; added durable runtime restart and updated send policy checks both pass. Live provider behavior is explicitly pending credentials.
## Phase 4
- Use server-rendered HTML and vanilla JavaScript polling; no frontend build pipeline is required.
- The dashboard queues runs onto one worker so simultaneous browser mutations cannot contaminate verification baselines.
- Human card decisions use signed sessions and CSRF headers. Secret browser storage is excluded from artifact access.
- Startup requeues interrupted runs and resumes resolved human cards. Unanswered cards remain paused across restarts.
- Phase 4 acceptance: dashboard HTTP tests and actual Chromium UI smoke pass. Task input, polling, report display and no-JavaScript-error checks verified; missing-key run honestly reports FAILED. All four servers start with one command.
## Phase 5
- Added five real CLI requests and an explicitly labeled simulated-human file. Human simulation supplies only approvals and missing-date answers, never browser actions.
- Actually invoked every CLI demo: all five safely exited with FAILED and zero LLM tokens due to missing API credentials. Live demonstration acceptance is BLOCKED, not passed.
- The user's follow-up explicitly requested building/testing locally without a key. Continue implementing evaluation and submission artifacts while keeping live acceptance pending.
## Phase 6
- Ten YAML tasks include five required demos, two additional invoice requests, manager rejection, an outside-sandbox banking request and an unknown vendor.
- Evaluation runs use isolated app databases and serial resets; they do not discard the interactive sandbox's work.
- Ground truth reads SQLite directly and independently of the agent's browser verifier. It checks exact field values and unrelated state changes, plus refusal evidence and recorded human decisions.
- Implemented configurable repetitions, token/cost accounting, recovery totals, verifier agreement and false VERIFIED counts. Cost is unknown until per-token prices are configured.
- Actually ran normal and chaos evaluation commands. Both are BLOCKED before live runs because .env has no API key. Success rates, verifier agreement and false VERIFIED counts remain unmeasured; no numbers were fabricated.
## Phase 7
- Added integration coverage for duplicate non-entry, trusted contact updates and corrupted-contact detection, exact sent-summary content, durable approval before mutation, real renamed/reordered controls, HTTP failures and session expiry.
- Reset isolated live databases per operation test; require exclusive ports to avoid accidentally testing a running interactive sandbox.
- All six tool error classifications, exact INR 50,000 boundary behavior, SOP-derived structured requirements, loop recovery and generalization constraints are covered.
- Full local suite: 43 tests passed with no skips; one additional SOP strengthening test and targeted validation checks also passed. A fresh-clone full run follows in phase 8.
- Added a structural ToolContext interface and type annotations to tools and HTTP boundaries. Ruff and pip dependency consistency checks pass.
- Installed standard Python locally without PATH changes or shortcuts, created a normal venv and installed the locked dependencies successfully.
