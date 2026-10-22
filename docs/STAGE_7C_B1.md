# Stage 7C-B1 — Linux deployment validation

Run 2026-10-20 on the Windows 11 development laptop. **Docker and Linux were not available, so every container/Linux test is NOT RUN.** PostgreSQL validation was possible and passed. Nothing was deployed, installed, committed or reset; real payments, real taxi dispatch, real tokens and real customer data were not used.

> **Update 2026-10-22:** the items below marked NOT RUN because Docker/Linux was missing were executed on the Contabo VPS (Ubuntu 24.04, Docker 29.9.2). See **section 10** at the end of this file and `docs/STAGE_7C_B2.md`. Sections 1–9 are kept as the original Windows-day record.

Legend: **PASS** · **FAIL** · **NOT RUN** (could not be executed here) · **NOT VERIFIED**.

## 1. Environment capabilities

| Capability | Status | Detail |
|---|---|---|
| Docker / Docker Compose | **absent** | `docker` not on PATH, no Docker Desktop service |
| Podman | absent | |
| WSL2 / Linux distro | **absent** | `wsl.exe` reports "Windows Subsystem for Linux is not installed"; `vmcompute` service is stopped; hypervisor is present (virtualization is available) |
| Linux build tools (make/gcc) | absent | not needed by this project (pure JS + Prisma binaries) |
| Node.js | 24.15 | meets `engines` (>=24.7 <25) |
| PostgreSQL | **18.4 installed locally** (service running), not on PATH; `pg_dump`/`pg_restore`/`psql`/`createdb`/`dropdb` found in `C:\Program Files\PostgreSQL\18\bin` | |
| RAM | 16 GB | |

Nothing was installed and no Windows setting was changed.

### Exact setup to unlock the NOT RUN tests (needs your approval; run yourself in an elevated PowerShell)

Option A — Docker Desktop (recommended, includes WSL2 backend):
1. `wsl --install --no-distribution` (enables WSL2 + Virtual Machine Platform), reboot.
2. Install Docker Desktop for Windows (WSL2 backend); reboot if asked.
3. Verify: `docker version`, `docker compose version`, `docker run --rm hello-world`.

Option B — WSL2 Ubuntu only: `wsl --install -d Ubuntu-24.04`, then inside it install Node 24 and Docker Engine, or just run Node 24 + the existing scripts for the SIGTERM test.

Then run the commands in section 8 (Stage 7C-B2).

## 2. Tests

| # | Test | Result |
|---|---|---|
| 1 | `docker compose config`, image build, non-root check, image secret scan, container health | **NOT RUN** (no Docker) |
| 2 | Container restart policy, persistent volume survives `down`/`up` | **NOT RUN** |
| 3 | SIGTERM graceful shutdown of the compiled process | **NOT RUN** (Windows cannot deliver SIGTERM; `createShutdown` ordering/timeouts covered by unit tests, PASS) |
| 4 | Worker shutdown on SIGTERM, multiple-instance 409 against a live token | **NOT RUN** (needs Linux signal / a test bot token; fake-Telegram 409 handling is covered by `telegram.integration`, PASS) |
| 5 | `prisma migrate deploy` on an **empty** database (18 migrations on disk = 18 found = 18 recorded) | **PASS** |
| 6 | `migrate status` up to date; second `migrate deploy` is a no-op | **PASS** |
| 7 | Fresh schema: 33 tables, all empty | **PASS** |
| 8 | `pg_dump -Fc` of `ds_delivery_test` (read-only; 125 KiB), archive readable | **PASS** |
| 9 | `pg_restore` into a **new** database; row counts equal for all 33 tables (454 rows); 321 constraints and 108 indexes (incl. partial unique indexes) identical; restored DB passes `migrate status` | **PASS** |
| 10 | Compiled server starts against the restored database, `/health/ready` 200 | **PASS** |
| 11 | Database made unreachable (connections refused + backends terminated, PostgreSQL service untouched): `/health/ready` 503 with `database: down`, `/health/live` 200, no secret in body | **PASS** |
| 12 | Database returns: `/health/ready` recovers to 200 **without restarting the process** (Prisma reconnects) | **PASS** |
| 13 | Server logs contain no DB password | **PASS** |
| 14 | Startup rejects unreachable DB / unsafe production config / unsafe REAL payments (compiled process) | **PASS** (`reliability.proc` 3/3) |
| 15 | Production smoke (`smoke-prod`), `tsc`, deploy unit tests | **PASS** (8/8, clean, 15/15) |
| 16 | `npm ci --dry-run` accepts the lockfile; compiled code imports only `@prisma/client`, `zod`, `telegraf`, `fastify` (no dev-only package) | **PASS** |
| 17 | PostgreSQL **service restart** recovery, Linux persistent volume | **NOT RUN** (restarting the service would interrupt the running dev server; needs your OK) |

Reproduce 5–13: `npm run build` then `npm run validate:postgres` (`scripts/validate-postgres.mjs`). The script refuses any source database other than `ds_delivery_test`, only reads it, creates `ds_b1_<nonce>_migrate` and `ds_b1_<nonce>_restore`, and drops only those two (verified: none remain; `ds_delivery_test` row counts unchanged).

## 3. Docker / Linux findings (static review — nothing was executed)

Fixed (hardening, **unverified because Docker is unavailable**):
1. **Prisma schema engine in the `migrate` image.** The build stage ran `npm ci --ignore-scripts`; `@prisma/engines`' `postinstall` (which downloads the schema-engine binary) was therefore skipped, so `prisma migrate deploy` would have to download it at run time as the non-root user into root-owned `node_modules`. The build stage now runs `npm ci` with scripts (runtime stage still `--ignore-scripts`). Confirm with `docker compose run --rm migrate`.
2. **CRLF line endings** in `Dockerfile`, `.dockerignore`, `docker-compose.example.yml`, `deploy/production.env.example` (Windows authoring; no `.gitattributes`). Converted to LF and added `.gitattributes` pinning LF for these files. A CR in a filled-in env file can corrupt values.
3. **Password characters.** `POSTGRES_PASSWORD` is embedded in the `postgresql://` URL; `@ / : #` break it. A comment in the env template now says to use hex/`-`/`_` only.

Open — needs a decision in 7C-B2:
4. **PostgreSQL major mismatch.** Compose pins `postgres:16`; every database test and the dump/restore above ran on **18.4**. A dump from 18 cannot be restored into 16, and Prisma/migrations were not exercised on 16. Either pin `postgres:18` (note: the 18 image changed its data-directory layout, so mount the volume at `/var/lib/postgresql`, not `/var/lib/postgresql/data`) or test everything on 16. Not changed here because it cannot be tested.
5. `read_only: true` is set; if Gmail is enabled later its token file needs a writable volume.
6. Image size/time, `tini` path and the healthcheck were reviewed by reading only.

## 4. Bugs discovered and fixed

No application bug was found in this stage. Build-file hardening items 1–3 above were changed; none was reproduced by a running container, so they are **fixes of risk, not verified fixes**. The previous stage's `ensureCustomer` fix is unaffected (re-run: not repeated here).

## 5. PostgreSQL backup / restore results

Measured today on the local PG 18.4 test database: custom-format dump 125 KiB for 33 tables / 454 rows; restore into a new database succeeded with `--exit-on-error`; counts, constraints (321) and indexes (108) identical; the application served from the restored copy and passed readiness. This is a functional proof of the procedure, **not** a size or duration estimate for production data. Cross-version (18 → 16) restore was not attempted and is not supported by PostgreSQL.

## 6. Resource recommendations (no prices, no benchmarks)

Measured: compiled backend with bots/Gmail off, Windows working set ≈ **96 MB idle, ≈ 100 MB after 200 readiness calls**. With Telegram polling, workers and real traffic expect more; measure on staging for a week before sizing. Order-creation burst on this laptop: 50 concurrent checkouts ≈ 1 s (Stage 7C-QA; not a production figure).

Starting point for a single VPS (an engineering estimate, to be validated):
- 2 vCPU, 2 GB RAM (backend a few hundred MB incl. Telegram; PostgreSQL + OS use the rest), 20–40 GB SSD (database is small; reserve space for dumps and logs), Linux x86_64 or arm64, public IPv4, NTP.
- Upgrade trigger: sustained memory > 70 % or p95 API latency rising during order peaks; then move PostgreSQL to a managed/separate host before adding CPU.

## 7. Deployment plan (single VPS)

**Layout** — one host: Caddy (or nginx) with automatic TLS on 443 → `127.0.0.1:4000` backend container; PostgreSQL container on an internal network with a named volume (no published port); one `migrate` job image. The single backend process contains the Fastify API, the customer bot, the taxi operator bot and all workers (this is by design: exactly **one** instance).

**Staging vs production** — two separate compose projects (`-p ds-staging`, `-p ds-prod`) with separate env files, databases, volumes, bot tokens (a different BotFather bot per environment), `INTERNAL_API_KEY`s and domains. Staging: `NODE_ENV=staging`, MOCK payments, test bot. Production: `NODE_ENV=production`, MOCK refused by the backend, REAL only after owner/bank approval and `CONFIRM_REAL_PAYMENTS=yes`. Never point a staging process at a production token (409 conflicts and real messages).

**Secrets** — `deploy/production.env` created on the server (`chmod 600`, owner root), never in Git/images/chat; bot tokens revocable via BotFather; keep a copy in a password manager; rotate `INTERNAL_API_KEY` and bot tokens if a laptop with `.env` is lost. The image contains no secrets (`.dockerignore`) — to be confirmed by `docker history` / `docker run … env` in 7C-B2.

**Migrations** — `docker compose run --rm migrate` (`prisma migrate deploy`) **before** starting the new backend; never `migrate dev/reset` on a server; take a `pg_dump -Fc` immediately before every migration; migrations stay additive (expand → backfill → contract) so the previous image can still run against the new schema for rollback.

**Backups** — nightly `pg_dump -Fc` (cron or a sidecar) to a directory outside the Docker volume, copied off-host (object storage or another machine); suggested retention 7 daily + 4 weekly + 3 monthly (adjust to the owner's legal/accounting needs); dumps contain phone numbers and addresses → encrypt at rest, restrict access. Quarterly restore drill with `scripts/validate-postgres.mjs`-style checks (restore into a new database, row-count and `migrate status` comparison).

**Restore procedure** — stop the backend (`docker compose stop backend`); create a new database; `pg_restore --no-owner --no-privileges --exit-on-error -d <new> <dump>`; run `migrate status`; point `DATABASE_URL` at it (or rename); start one backend; check `/health/ready`; resume. Orders in flight resume from DB-backed queues; uncertain taxi sends still need the operator/administrator confirmation (Stage 7A).

**Monitoring** — external uptime check on `https://<api-host>/health/ready` (alert on non-200 for > 2 min); container restart count and `docker stats` memory; disk usage (dumps/logs); Docker log rotation (`max-size`, `max-file`) in compose; PostgreSQL `pg_isready`; Telegram 409 / "polling stopped" log lines; alert when an order stays in `READY`/taxi `REQUESTED` too long (existing admin alerts + `/taxiadmin`).

**Vercel integration** — keep the Mini App on Vercel with same-origin `/api/v1/miniapp/*` rewrites. When the permanent API host is live and `/health/ready` is 200 through TLS, replace only the two `destination` hosts in `apps/customer-miniapp/vercel.json` (the trycloudflare host) and redeploy; set `MINIAPP_URL` on the backend to the Vercel URL; re-verify `TRUST_PROXY` (Vercel adds a hop; test with a request and confirm the rate-limiter sees distinct client IPs). **Not edited today.**

**Safe rollback** — keep the previous image tag; app rollback = `docker compose up -d backend` with the old tag (schema is backward compatible by the additive rule); data rollback = restore the pre-migration dump into a new database as above; Vercel rollback = redeploy the previous `vercel.json` destination (Vercel keeps previous deployments). Before cut-over, stop the local dev backend and the Cloudflare tunnel so two processes never poll one bot token.

## 8. Production blockers

1. Docker image build, compose stack, non-root/secret checks, container health and restart — **NOT RUN**.
2. SIGTERM graceful shutdown on Linux and the worker-shutdown order under a real signal — **NOT RUN**.
3. Postgres 16 (compose) vs 18 (tested) mismatch — decision needed.
4. Real Telegram clients, Android app against the deployed API, real MOCK end-to-end on a server — **NOT VERIFIED**.
5. In-memory rate limiter ⇒ exactly one backend instance; no DB-level leader lock.
6. No host chosen, no DNS/TLS, no off-host backup target, no monitoring account.
7. REAL payments, payee requisites and restaurant verification workflow not approved.
8. PostgreSQL service-restart recovery and host-reboot behaviour untested.

## 9. Exact requirements for Stage 7C-B2

Prerequisites (owner action): Docker Engine + Compose v2 available (section 1) — on this laptop or the staging VPS; a **separate test bot token** (and test taxi bot token) created in BotFather *only if* live polling/409 is to be tested; permission to restart the local PostgreSQL service or a disposable container database; the decision for blocker 3.

Work to execute, in order, all with fake/test credentials and isolated databases:
1. `docker compose config` (using a filled-in example env with fake values) → no warnings.
2. `docker build --target runtime` and `--target migrate`; record sizes; confirm the Prisma query engine and (migrate image) schema engine exist and match 6.18.0.
3. `docker run --rm <img> id` → non-root; `docker history` / `docker run env` / file scan → no `.env`, tokens or credentials; `docker run … node -e` confirms NODE_ENV=production.
4. `docker compose up -d db`; `run --rm migrate` against an empty volume database; start backend with `NODE_ENV=staging`, MOCK, `BOT_ENABLED=false`; `/health/live`, `/health/ready` 200 through the loopback port.
5. `docker compose stop backend` → exit code 0 within the grace period and logs show the ordered shutdown steps; also `docker kill -s SIGTERM`.
6. `docker compose restart backend`; `docker compose down` (never `-v`) then `up` → data persists; `docker restart db` → backend `/health/ready` goes 503 then recovers.
7. Run `scripts/validate-postgres.mjs`-equivalent inside compose (dump → new database → restore → counts).
8. Two backend containers against one test DB with `BOT_ENABLED=false` (document the double-worker behaviour); with a *test* bot token, a second container must exit on 409 (only if a test token is provided).
9. Run the full existing suite once in Linux (Node 24): `npm ci`, `tsc`, unit tests, DB suites on a throwaway container database, `test:qa:*` (UI test needs a Linux Chromium; otherwise mark NOT RUN).
10. Update this document with PASS/FAIL per item; only then plan the real VPS rollout.

Files changed or added in 7C-B1: `scripts/validate-postgres.mjs`, `package.json` (`validate:postgres`), `Dockerfile`, `.dockerignore`, `docker-compose.example.yml`, `deploy/production.env.example` (LF + comment), `.gitattributes`, `docs/STAGE_7C_B1.md`.

## 10. Linux validation on the VPS (2026-10-22) — closes the NOT RUN items of section 2

Environment: Contabo VPS, Ubuntu 24.04.5, Docker Engine 29.9.2 + Compose v5.6.1, PostgreSQL **18.6** container, Node v24.22.1 in the image, Prisma 6.18.0. Deployed package `a20cc1b066d3` (first deploy `ce4335c10d07`). Details, commands and evidence: `docs/STAGE_7C_B2.md`.

| Original # | Test | Result on Linux |
|---|---|---|
| 1 | `compose config`, image build, non-root, image secret scan, container health | **PASS** — user `node`, no `.env`/credential files, `docker history` clean, healthcheck `healthy` |
| 2 | Restart policy; persistent volume survives `down`/`up` | **PASS** — `down` (no `-v`) + `up` kept orders/customers/guest sessions/19 migrations; host reboot brought all containers back |
| 3 | SIGTERM graceful shutdown of the compiled process | **PASS** — `docker stop` / `docker kill -s SIGTERM`: exit code 0 in ≈1 s |
| 4 | Worker shutdown / 409 against a live token | **NOT RUN** — no staging bot token yet (bots are OFF); a second bots-off instance ran next to the first without errors |
| 5–7 | `migrate deploy` on an empty DB, status, schema | **PASS** — 19/19 migrations (incl. `customer_guest_android`), 35 tables, second run no-op |
| 8–9 | Dump and restore into a new database, counts equal | **PASS** — restored into a disposable PG 18 container; 35 tables, identical row counts |
| 11–12 | DB unreachable → `/health/ready` 503, `/health/live` 200; recovery without restart | **PASS** — recovered in ≈2 s, backend `RestartCount` 0 |
| 17 | PostgreSQL restart recovery, Linux volume, host reboot | **PASS** — DB stop/start while the backend kept running; reboot test |
| Open item 4 | PostgreSQL 16 (compose) vs 18 (tested) | **Decided: PostgreSQL 18** in `deploy/staging/docker-compose.staging.yml` (volume mounted at `/var/lib/postgresql`, as the 18 image requires). `docker-compose.example.yml` (production example) still says 16 and must be changed to 18 before a production deploy. |
| Open item 1 | Prisma schema engine in the `migrate` image | **Verified** — `npx prisma migrate deploy` ran as non-root `node` in the migrate image |
| Blockers 1–3, 8 | Docker/compose/SIGTERM/reboot | **Closed for staging** |

Still open from B1: real Telegram polling/409 test, Android against the deployed API, monitoring/off-host backup automation (see B2 §10).
