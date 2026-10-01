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
