# Stage 7C-A — Backend deployment readiness (code only)

Nothing was deployed, no hosting was configured, no database was migrated, `vercel.json` (the Cloudflare tunnel) was **not** touched, real payments and real taxi dispatch stay off.

## 1. Current backend architecture

One long-lived Node.js (>= 24.7) process, started by `src/server.ts`:

| Part | Where | Lifecycle |
|---|---|---|
| Config validation | `src/lib/preflight.ts` → `config-check.ts` | First import; exits 1 before anything connects |
| Fastify API + Mini App static (`/app/`) | `src/app.ts` | `listen(HOST, PORT)` |
| Prisma client | `src/lib/db.ts` | `$connect()` at start, `$disconnect()` at shutdown |
| Payment maintenance | `setInterval` in `server.ts` (`MAINTENANCE_SECONDS`) | Guarded against overlap; awaited on shutdown |
| Gmail poller | `modules/payment/gmail.ts` | Only if `GMAIL_ENABLED=true`; now started **after** Telegram polling is confirmed |
| Customer bot (polling) + notifiers | `bot/client.ts`, `notify.ts`, `restaurant-notify.ts`, `support-notify.ts` | Only if `BOT_ENABLED=true` |
| Taxi operator bot (polling) + dispatcher | `bot/taxi-bot.ts`, `modules/taxi/worker.ts` | Only with `TAXI_BOT_TOKEN`; DB-backed queue |

Verdict: it runs reliably as a single process. No rewrite was needed. There is no file-system state except the optional Mini App `dist` directory (read-only) and Gmail credential files (only when Gmail is enabled). Scheduled work is `setInterval` timers inside the process, all stopped on shutdown.

**Single instance only.** Both bots use long polling. A second instance gets Telegram 409 and exits (`launchPolling` in `server.ts`); workers and Gmail start only after polling is confirmed, so a duplicate never runs them. Payment matching and checkout use PostgreSQL advisory locks and unique constraints, and taxi dispatch and notifications keep their DB idempotency. There is still no database-level "leader" lock; do not run replicas. With `BOT_ENABLED=false` an extra instance would run the payment maintenance loop (it is lock-serialized and idempotent), but that mode is for tests only.

## 2. Production build commands

```
npm ci
npm run build:prod        # prisma generate + clean dist + tsc -p tsconfig.build.json
npm run db:deploy         # prisma migrate deploy  (never `migrate reset` / `migrate dev` in production)
npm run start:prod        # node dist/src/server.js   (environment from the host / container, no --env-file)
```

- `npm run dev` and `npm start` (`--env-file=.env`) are unchanged.
- `tsconfig.build.json` excludes tests; `dist/` is cleaned first so stale files never ship.
- Prisma stays at exactly 6.18.0 (`@prisma/client` and `prisma` pinned, no `audit fix`).
- Windows note: `prisma generate` fails with `EPERM` on `query_engine-windows.dll.node` while a Node process (e.g. the dev backend) has the client loaded. Stop it first, or skip generate when the schema did not change (`npm run build`). Docker/Linux is unaffected.
- The Mini App (`apps/customer-miniapp`) has its own `package.json`/build and is not imported by the backend; it can be deployed independently (Vercel). The backend can serve a built copy at `/app/` only if `MINIAPP_ENABLED=true` and `dist` exists; this is optional.

## 3. Docker deployment

Files: `Dockerfile` (stages `build`, `migrate`, `runtime`), `.dockerignore`, `docker-compose.example.yml`, `deploy/production.env.example`.

- Multi-stage; runtime image has production dependencies only, the generated Prisma client/engine copied from the build stage (same Debian + OpenSSL base), `tini` as PID 1 so `docker stop` delivers SIGTERM, non-root `node` user.
- No `.env`, tokens or credentials are copied (`.dockerignore`); configuration comes from `deploy/production.env` at run time (git-ignored).
- Compose: PostgreSQL 16 on a named volume (`pgdata`), no published DB port, backend bound to `127.0.0.1:4000` for a TLS reverse proxy, `restart: unless-stopped`, `stop_grace_period: 30s`, read-only root fs, `cap_drop: ALL`, `no-new-privileges`, healthcheck on `/health/live`.
- Commands (all non-destructive; never `down -v`):
  ```
  copy docker-compose.example.yml docker-compose.yml ; copy deploy\production.env.example deploy\production.env   (then fill in)
  docker compose --env-file deploy/production.env build
  docker compose --env-file deploy/production.env up -d db
  docker compose --env-file deploy/production.env run --rm migrate
  docker compose --env-file deploy/production.env up -d backend
  ```
- **Not verified here:** Docker was not run (no image build, no `compose config`). Validate with `docker compose config` and a build on the server/Linux first.
- If `read_only` blocks Gmail token writes when Gmail is enabled later, mount a dedicated volume for that path.

## 4. Environment variables

Template: `deploy/production.env.example` (names only). Validated at start by `checkConfig` (values are never printed):

| Variable | Rule |
|---|---|
| `DATABASE_URL` | Required, `postgresql://`, names a database; in production no placeholder password and no "test" in the name |
| `INTERNAL_API_KEY` | >= 20 chars; >= 32 and not a placeholder in production |
| `PORT`, `HOST` | Valid port; default host `127.0.0.1` (use `0.0.0.0` only in the container) |
| `TRUST_PROXY` | unset/`false`, `true`, or hop count (`1`); typos rejected; `true` and "non-loopback without proxy" warn |
| `NODE_ENV` | `production` refuses MOCK; use `staging` for MOCK test deployments |
| `BOT_ENABLED`, `BOT_TOKEN`, `TAXI_BOT_TOKEN` | Token format checked; taxi token must differ from the customer token |
| `MINIAPP_ENABLED`, `MINIAPP_URL` | Mini App needs the bot token (initData signature) |
| `BOT_PAYMENT_MODE` | `MOCK` (default) or `REAL`; REAL requires `GMAIL_ENABLED=true`, non-test DB, valid `BOT_REAL_CARD_NUMBERS_JSON`, and in production `CONFIRM_REAL_PAYMENTS=yes` |
| interval variables | Positive integers |
| `SHUTDOWN_TIMEOUT_SECONDS` | Default 15 |
| `POSTGRES_PASSWORD` | Compose only |

## 5. Database migration strategy

- Only `prisma migrate deploy` (compose `migrate` job, run before starting the new backend). It applies pending migrations and never resets.
- All 14 stage migrations are additive; review any new migration for locks/rewrites before applying to production data.
- Take a `pg_dump` immediately before each migration (section 7). Roll forward with a new migration; do not edit applied ones.
- Migrating the existing local data to a server is **not** done in this stage.

## 6. Health and readiness

- `GET /health` legacy (unchanged payload).
- `GET /health/live` — process alive; never touches the DB (so a DB blip does not restart the container). Used by the Docker healthcheck.
- `GET /health/ready` — 200 only when startup finished **and** `SELECT 1` answers within 2 s, else 503. Body: `{ok, phase, checks:{database, customerBot, taxiBot}}` — coarse states only, no tokens, URLs or DB names. Use it for the reverse proxy / uptime monitor.

## 7. Backup and recovery

- PostgreSQL is the only state. Daily `pg_dump -Fc` (cron on the host, off-server copy) plus a dump before every migration; test a restore into a scratch database periodically.
- Orders, payments, ledger and taxi dispatch records live there, so the dump is also the audit trail. Treat dumps as sensitive (phone numbers, addresses); never commit them.
- Recovery: restore the dump to a new database, run `migrate deploy`, start one backend. Pending taxi/notification work resumes from the DB-backed queues; outcomes uncertain after a crash require the existing manual operator/administrator confirmation (Stage 7A recovery).
- Keep `deploy/production.env` in a password manager/secret store, not in the repo.

## 8. Vercel API integration plan (not applied)

Current: `apps/customer-miniapp/vercel.json` rewrites `/api/v1/miniapp` and `/api/v1/miniapp/:path*` to a temporary `*.trycloudflare.com` host. **Unchanged.**

When a permanent HTTPS API host exists (e.g. `https://<api-host>`):
1. Deploy and verify `https://<api-host>/health/ready`.
2. In `vercel.json` replace only the two `destination` hosts with `https://<api-host>`; keep the rewrite paths. The Mini App keeps calling same-origin `/api/v1/miniapp/*`, so no CORS and no frontend change.
3. Redeploy the Mini App; check `GET /api/v1/miniapp/config` through the Vercel URL (expect 401 without initData) and then one real Telegram open.
4. Set `MINIAPP_URL` on the backend to the Vercel URL; keep `TRUST_PROXY` matched to the number of proxies. Note a Vercel rewrite adds one more hop in front of your proxy; client IPs for rate limits then come from `X-Forwarded-For` — verify with a test request before relying on per-IP limits (hop count may need to be `2`).
5. Rollback: restore the previous `destination`.
Only a placeholder is documented; no URL was invented.

## 9. Known security limitations

- Rate limiter is in memory (single process); fine for one instance, blocks scaling out.
- Per-IP limits depend on a correct `TRUST_PROXY`; a wrong hop count either shares one bucket or trusts spoofed headers.
- No database-level leader election; single instance is an operational rule enforced by Telegram 409, not by the DB.
- MOCK payments in `staging` let any authenticated Telegram user mark test orders paid: staging only, test bot, never real customers.
- Mini App initData is accepted for `MINIAPP_AUTH_MAX_AGE_SECONDS`; no WebSocket/push.
- Docker/compose and graceful SIGTERM exit were not exercised on this Windows machine.
- Dependency audit not run (and `npm audit fix --force` is forbidden: it would move Prisma).

## 10. Recommended server requirements

Linux x86_64/arm64 VPS, 2 vCPU, 2 GB RAM (backend ~ a few hundred MB; PostgreSQL gets the rest), 20 GB SSD with room for backups, Docker + Compose, a TLS reverse proxy (Caddy/nginx), a static IP/DNS name, outbound HTTPS to api.telegram.org. Time sync (NTP) enabled. Starting point only — not benchmarked.

## 11. Estimated monthly resource usage

Qualitative, not measured: low CPU (idle polling + 5 s timers); network is Telegram long polling plus API traffic; storage grows with orders (text rows, small) and logs. No cost figures are given because none were verified. Measure memory/CPU for a week in staging before choosing a plan.

## 12. Tomorrow's deployment / test checklist

1. Choose host; on it: install Docker, create `deploy/production.env` (`NODE_ENV=staging`, `BOT_PAYMENT_MODE=MOCK`, **test** bot tokens, new random `INTERNAL_API_KEY`, `TRUST_PROXY=1`).
2. `docker compose config`, build, `up -d db`, `run --rm migrate`, `up -d backend`; confirm `/health/ready` is 200 through the TLS proxy.
3. Stop the local dev backend and the Cloudflare tunnel **before** the server starts polling the same tokens (never both).
4. Confirm logs: no secrets, "Telegram client bot started", taxi worker started; `docker stop` exits cleanly within the grace period.
5. Only after step 2 passes: change the two `vercel.json` destinations (section 8), redeploy, open the Mini App from Telegram.
6. Run the manual E2E list in `docs/STAGE_7A.md` §7 (MOCK only), plus Android restaurant login against the new API URL.
7. Verify a second `docker compose up` of the backend does not start duplicate workers (it should exit with the 409 message).
8. Take a `pg_dump`, restore it to a scratch DB.
9. Keep real payments and real taxi requests off until the owner approves.

## Verification run on 2026-10-20

| Check | Result |
|---|---|
| `tsc --noEmit` | pass |
| Deploy tests (config-check, shutdown, health) | 15/15 pass |
| All backend unit tests | 89/89 pass |
| `npm run build` (tsc → `dist/`) | pass |
| `npm run build:prod` | `prisma generate` blocked by EPERM (dev backend holding the engine DLL); build step itself passes |
| `scripts/smoke-prod.mjs` on `ds_delivery_test` (port 4010, bots/Gmail off) | 8 pass, SIGTERM check skipped on Windows |
| 17 DB suites on `ds_delivery_test` | all pass |

Not run: Docker build/compose, SIGTERM exit on Linux, real Telegram, Android, Mini App rebuild, any REAL payment or taxi request.
