# Code tour and interview preparation

The repository was implemented with AI coding assistance. Use this walkthrough to build your own understanding; do not imply that you manually wrote every line. A passing local fixture test is not evidence that a live LLM task passed. The current live demos/evals are credential-blocked.

## Reading order

| Order | File | What to understand |
| --- | --- | --- |
| 1 | `seed.py` and `mock_company/db.py` | Fixture invariants, integer paise, separate databases, deterministic original PDFs and idempotent seed. |
| 2 | `mock_company/apps.py` and its template | Real login/session/CSRF, HTML forms, visible server validation, pagination and chaos middleware. |
| 3 | `config/apps.yaml`, `config/policies.yaml`, `config/providers.yaml` | Addresses, security scope, approval thresholds and swappable provider defaults. |
| 4 | `agent/models.py` | TaskSpec, typed Criterion, supported SOP PolicyRequirement, plan statuses, judgement and lesson contracts. |
| 5 | `agent/tool_registry.py` and `agent/context.py` | Decorator metadata/schema generation, risk tiers, error boundary and structural tool context. |
| 6 | `agent/browser.py` and `agent/tools/browser_tools.py` | Isolated context, request allowlist, fresh numbered DOM observations, screenshots, action tools and restart state. |
| 7 | `agent/tools/data_tools.py` and `agent/credentials.py` | Resolved path scope, original PDF extraction, BM25, scratchpad, opaque credentials, human question and finish. |
| 8 | `agent/store.py` | Durable lifecycle rows, atomic decisions/checkpoints, trace events, reports and artifact paths. |
| 9 | `agent/llm.py` | Native single-tool provider interface, structured contract tool definitions, token accounting and .env-only secrets. |
| 10 | `agent/policy.py` | Pre-submit form inspection, independent source/domain/duplicate checks, supported SOP rules and exact-values approval fingerprints. |
| 11 | `agent/reader.py`, `agent/evidence.py`, `agent/verifier.py` | Fresh browser readback, deterministic source parsing, document identity and state predicates, separate semantic audit. |
| 12 | `agent/runtime.py` | Phase machine, bounded context, policy dispatch, recovery, replanning, durable pauses, correction rounds and reporting. |
| 13 | `agent/lessons.py` and `agent/__main__.py` | Visible cross-run lessons; real CLI decisions and explicitly evaluation-only human simulation. |
| 14 | `dashboard/app.py`, templates and static JS | Single worker, startup resumption, polling, CSRF cards and protected artifact access. |
| 15 | `evals/tasks.yaml`, `evals/run.py`, `evals/ground_truth.py` | Isolated fixture resets, real model runs, independent SQL oracle and false VERIFIED metrics. |
| 16 | `tests/` and `docs/VERIFICATION.md` | What was actually checked and what is still unknown. |

## The main data structures

`TaskSpec` records intended outcome, task category, inputs, natural-language constraints, structured supported policy requirements and one or more fixed success criteria. A criterion has an ID, adapter kind, requested target and description. Criteria are established during UNDERSTAND rather than accepted from the executor at finish time.

A `Plan` is a list of intent steps with pending/active/done/blocked status. These are visible progress annotations, not proof of completion. `plan_update` changes a status explicitly; the separate verifier determines the outcome.

A registered `Tool` has name, docstring description, risk, implementation and a Pydantic arguments model. The decorator omits `ctx` from model-visible arguments. `invoke` returns exactly `{ok, data, error, error_type}` and classifies operational failures instead of raising them into the loop.

Runtime's checkpoint contains phase, TaskSpec, plan, memory, extracted evidence references, independently collected baseline, bounded history, latest observation, active time, steps, tokens, failures and browser draft. An `in_flight` action exists around business submission. Browser cookie storage is a separate non-exportable file.

An approval card stores a fingerprint of operation, target and exact values, the policy reason and citation, and an immutable decision/comment. A question stores its text and answer. Both are persisted independently of the running browser. Repeating an exact rejected operation does not reset the decision.

A report stores outcome, per-criterion evidence, discovered values, human decisions, actual token counts, recoveries, screenshots and estimated cost availability. VERIFIED requires complete supported checks; unavailable evidence becomes PARTIAL. The trace is a timed JSONL audit of provider summaries, calls, results, policy/recovery/verification events and completion.

## Follow one request through the system

For a newest-invoice request, a dashboard POST creates a run and queues its ID. The worker constructs Runtime. The runtime checks for a real provider, starts its context and captures an independent baseline in a separate context. It retrieves SOPs, obtains a typed TaskSpec and produces an intent plan.

Each iteration sends the original request, configured apps, fixed spec, plan, scratchpad, recent history, observation, relevant lessons and resolved human cards. The provider returns one native tool call. The executor can search/paginate, download the source PDF, extract text and read ERP. These actions are model-selected; there is no vendor/task dispatcher in `agent/`.

When it clicks a payable submit control, Policy inspects the actual form values. A separate Reader checks ERP for an existing record and checks the extracted original source, newest selection and due-date provenance. A high amount produces an approval card. The runtime saves its phase/draft and returns, releasing Chromium.

After approval, a new Runtime loads the persisted state. It restores the page/draft and observes fresh IDs. The next action is checked against current source and form values again; an approval only applies to its exact fingerprint. An in-flight checkpoint precedes submission. On uncertainty the next action must reconcile state rather than blindly replay the write.

When the model calls finish, Verifier uses a new browser to read ERP and portal, independently select the latest invoice, download it again, compare document hashes and parse values. Missing due dates must match a recorded human answer. High values must match an approved action. It checks unrelated state stayed unchanged and then runs a separate evidence-only semantic judgement. Failed evidence allows at most two correction rounds. The final report and trace remain inspectable after process exit.

## Recovery questions you should be able to answer

- Why can retrying a browser send after a timeout be dangerous? The app may already have committed. Explain reconciliation and the current prototype's limited deduplication.
- What does ELEMENT_NOT_FOUND mean? An ID is a transient observation reference; refresh perception rather than guess a selector.
- Who knows the password? Only the local credential resolver and browser action boundary. The model sees an opaque reference.
- Can the model mark a plan step done and fool verification? No. Plan state is executor annotation, not source evidence.
- Why compare the latest PDF hash? Otherwise an executor could provide a real but wrong/historical document whose values match an unrelated record.
- Why does evaluation read DBs while the agent cannot? Evaluation is an independently implemented oracle measuring the browser verifier, not an executor shortcut.
- What happens after rejection, restart or budgets? Durable decisions remain; drafts restore with fresh IDs; unsupported/exhausted work produces an honest report.
- What is not production-ready? Name concurrency, exactly-once arbitrary writes, secrets/artifact isolation, sender authentication, general PDF layouts and the missing live measurements.

## Exercise 1: add a read-only tool

Goal: let the model check whether a permitted file exists. Change **only `agent/tools/data_tools.py`** for the implementation, plus **`tests/test_tools.py`** for verification:

```python
@tool()
def files_exists(ctx: ToolContext, path: str) -> dict:
    """Check existence within the shared drive or current run workspace."""
    candidate = safe_path(ctx, path)
    return {"exists": candidate.exists(), "path": str(candidate)}
```

The existing decorator imports and ToolContext are already available. No registry/schema/provider/runtime edits are necessary. `safe_path` is essential: joining a path without resolving it can allow traversal or symlink escapes. Add a test for a permitted SOP and a denied parent path. Run `python -m pytest tests/test_tools.py -q` and `python -m ruff check .`. Inspect the generated definition to see that `ctx` is absent and `path` is a string.

For a new write tool, add `Risk` to the import from `agent.tool_registry` and declare `@tool(Risk.WRITE)` or `@tool(Risk.EXTERNAL_SEND)`, document the side effect and add appropriate preflight/idempotency checks. Unknown writes require human approval by default. Do not reclassify a mutation as READ to bypass policy.

## Exercise 2: add a recipient-domain policy

Goal: forbid sends to a configurable domain regardless of human approval. Change **`config/policies.yaml`**, **`agent/policy.py`**, and **`tests/test_runtime.py`**:

1. Add `blocked_recipient_domains: [gmail.com]` to configuration. This is a policy example, not an existing prototype rule.
2. In `Policy.evaluate`, inside the `op == 'send'` branch, before approval/Sent matching, derive the exact recipient domain with `values.get('to', '').rsplit('@', 1)[-1].lower()`.
3. If the domain is in `POLICIES.get('blocked_recipient_domains', [])`, return a DENY decision with a clear reason and citation `config/policies.yaml`. Keep this check before approval so an old grant cannot bypass it.
4. Add tests for a denied Gmail recipient, an allowed sandbox domain reaching APPROVAL, and a similar-looking domain that does not accidentally match by substring.
5. Run policy tests and the complete suite with servers stopped. Document the new rule in DECISIONS.md.

To extend **SOP-derived** rules instead, update `PolicyRequirement.kind` in **`agent/models.py`**, implement its evaluation in **`agent/policy.py`**, and test that it can strengthen but never weaken static enforcement. The typed contract intentionally refuses unsupported rule kinds rather than simulate a general policy interpreter.

## Exercise 3: add an evaluation task

Goal: test a different human-supplied due date without changing agent code. Change **only `evals/tasks.yaml`**:

```yaml
  - id: alternate_human_due
    request: Record Wayne Logistics' most recent invoice after asking me for any required missing fields.
    check: {kind: payable, vendor: Wayne Logistics, due: '2027-01-15'}
    human:
      approval: approve
      answers: {due: '2027-01-15', YYYY-MM-DD: '2027-01-15'}
```

The existing SQL oracle derives source amount and invoice number from portal fixtures; the YAML supplies the expected missing date. Run `python -m evals.run --task alternate_human_due`, then its chaos variant. Inspect real ground-truth evidence and trace, not just the final badge. A new outcome type requires an independent checker in **`evals/ground_truth.py`**; it must not import the agent verifier.

## Suggested interview practice

Run the three exercises in a branch. Intentionally break a due date or amount and show that verification/evaluation catches it. Demonstrate an approval rejection and a paused process restart. Explain why a missing key blocks live performance claims, how you would measure false VERIFIED outcomes, and which production components you would build first. State tradeoffs and current limits candidly.
