# Decisions

## 0 — isolated TypeScript implementation

The previous Python prototype is retained. This monorepo is a separate implementation under `opsagent-ts`, allowing the author to compare the two architectures.

The specified Postgres 16 / pg-boss stack remains the default. Docker is not installed on the development Windows machine; a workspace-local PostgreSQL 16 binary is an explicit optional fallback, not a SQLite substitution. It is ignored by Git. Docker remains the clean-machine default.

Use the latest published Next.js 15 patch resolved by npm run rather than the initial vulnerable release. Dependency versions are reproducibly locked. Native provider keys remain optional for app development; no synthetic autonomous outcomes or evaluation scores are reported.

## Validation gate and environment restriction

The npm run installation approval was rejected. Source preparation continues, but phase acceptance and commits are not claimed or performed until dependencies can actually be installed and checks pass. This is an explicit blocked prerequisite, not a successful scaffold check.

## Policy and replay

Tool intent is checkpointed before submission. Exact form values and source provenance are fingerprinted for approval; a changed payload needs a new approval. A worker crash during a write is treated as an uncertain commit and checked independently before any retry. Read steps can be resumed normally. Unknown write forms require human approval. Run advisory locks prevent duplicate jobs operating the same browser concurrently.

## Chaos placement

Chaos lives in authenticated server-rendered page loading rather than Edge middleware, because the toggle is PostgreSQL-backed and the Next.js 15 Edge runtime cannot safely use the Node PostgreSQL driver. Errors, delays, login expiry redirects, and alternate field/button order are still real web behavior.

## Package manager override

The user explicitly requested npm. npm workspaces and package-lock.json replace pnpm workspaces/lockfile. Turborepo is retained. This user instruction takes precedence over the pasted stack requirement. The previous pnpm installation rejection is respected.
