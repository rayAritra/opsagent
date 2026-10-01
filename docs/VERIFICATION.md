# Verification record

## Current local evidence

- Mock apps: real HTTP login/session/CSRF, PDF download, pagination, search, payable creation, validation/duplicates, vendor editing, inbox/compose/Sent and app-database isolation checks pass.
- Browser tools: actual Chromium operates running web apps. Source PDF extraction, BM25 retrieval, select/fill/click/download, screenshot observations, path/navigation guards and structured failures are checked.
- Runtime safety: all error types, transient retries, fresh IDs, auth recovery, repeated-failure replanning, exact approval threshold, supported SOP requirements and durable human decisions are checked.
- Independent verifier: missing/wrong state fails; matching PDF/payable, duplicate non-entry, trusted contact and complete sent content pass. A contact deliberately corrupted through a real form fails readback.
- Restart: a new Runtime consumes a persisted answer; approval pauses before mutation and restored exact values can proceed only after a durable decision.
- Real chaos: renamed/reordered controls, HTTP 503 and forced session expiry are exercised against live apps.
- Dashboard: HTTP/CSRF/card/history/artifact checks and a real Chromium UI smoke passed with no JS errors. Missing API credentials produce an honest FAILED report.
- Dependency consistency: standard Python 3.12.10 venv installs requirements.lock.txt successfully; `pip check` and Ruff pass.
- Latest full development run: 43 tests passed without skips; the added SOP strengthening and dashboard checks also pass. The complete final suite is checked again from a fresh clone below.

## Fresh-clone check

Executed on 2026-10-02 in `.scratch/fresh-clone-review`, cloned from committed implementation `52c9169`. Draft submission documentation was copied into the clone so the exact written setup could be followed. The final reserved-file guard and its focused test were also checked there before the final commit.

| Check | Actual outcome |
| --- | --- |
| New standard Python 3.12.10 venv | PASS |
| `python -m pip install -r requirements.lock.txt` | PASS; fresh package installation using the package cache |
| `python -m playwright install chromium` | PASS; browser binaries downloaded into the clone's own directory |
| Copy .env.example and `python manage.py seed` | PASS; 20 PDFs, 5 vendors, 6 payables, 8 inbox messages |
| `python -m pip check` | PASS; no broken requirements |
| `python manage.py test` | PASS; **44 tests**, 293.97 seconds, no warnings/skips; Ruff passes |
| Added browser-session-file scope check | PASS; **1 additional test**, 0.71 seconds in the fresh clone |
| `python manage.py run` | PASS; all four servers healthy |
| Real Chromium dashboard smoke | PASS; input, run navigation, polling, honest missing-key FAILED report; no JS errors |
| Five CLI tasks with `--simulated-human` | All actually invoked; each exited 1 due solely to missing API key |
| Normal and chaos evaluation entry points | Both actually invoked; BLOCKED, zero completed live runs out of ten requested per mode |
| README local links and evaluation table | PASS; links exist and table matches the actual evaluation results |
| Git tracked-file scope | PASS; no .env, browser state, run state, runtimes or browser binaries tracked |

GNU Make is not installed on this Windows machine. The documented `manage.py` equivalents execute the same Python commands as the Makefile, and those were run. The clone's servers were stopped after checking. A clean-machine test on Linux/macOS and real credentialed LLM acceptance are still outstanding.

The final local suite contains **45 tests**: the 44-test complete fresh-clone run plus the separately added and executed reserved-file safety check. These results validate the implementation mechanics; they are not live autonomous task scores.

## Live LLM limitations

All five CLI demos were invoked with the simulated-human flag and exited with missing-key FAILED reports, with zero LLM tokens and no business mutation. Normal and chaos evaluation commands were invoked and recorded BLOCKED with 0 completed live runs out of 10 requested per mode.

Task success, verifier agreement, false VERIFIED counts, average live steps/tokens/cost and live recovery rates are **unmeasured**. Contract provider fixtures exist only under tests to verify lifecycle mechanics; product code offers only real Anthropic and OpenAI-compatible providers.

Configure a real key in .env, run the five demonstrations and repeated evaluations, fix genuine failures, and update this record with the actual results before claiming full autonomous acceptance or recording a success demo.
