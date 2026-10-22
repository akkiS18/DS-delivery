# Stage 7C-B2 — Contabo VPS test staging (private, MOCK)

Run 2026-10-22. A real Linux/Docker staging of the DS Delivery backend is running at **https://staging.sultonxoja.uz** on the Contabo VPS, independent of the laptop and of any Quick Tunnel. It is a **test staging**: MOCK payments, test database, **bots OFF**, **not public** (edge IP allowlist), no real orders, no real payments, no real taxi dispatch. Production was not started. Vercel rewrites, the BotFather menu URL and existing APK settings were **not** changed. No git commit/push/merge/reset/checkout was made.

Legend: **PASS** · **FAIL** · **NOT RUN** (not executed) · **BLOCKED** (needs an action only the owner can take).

## 0. Summary

| Area | Result |
|---|---|
| CODE PASS | `npm run test:deploy` 16/16 (incl. the new staging-gate rule), `tsc --noEmit` clean. Earlier Windows suites were deliberately **not** repeated. |
| LINUX BUILD PASS | Docker image build (Node 24, Debian bookworm), `prisma generate` 6.18.0, `tsc` build, runtime image non-root, no secret/`.env` in image or `docker history` |
| DEPLOY PASS (private staging) | 19/19 migrations on a fresh PostgreSQL 18.6, backend healthy, **public HTTPS with a Let's Encrypt certificate**, update + rollback + reboot + SIGTERM + DB-outage + data-persistence + backup/restore all verified |
| BLOCKED | Telegram bots (needs a dedicated **staging** bot token from the owner), public (non-allowlisted) tester access, mobile E2E |
| NOT RUN | Real Telegram polling / 409 duplicate-bot test, Android phone E2E, off-server backup automation, Vercel/BotFather/APK reconfiguration (deliberately untouched) |

Mobile E2E was **not performed**.

## 1. What was deployed (source identification)

| Item | Value |
|---|---|
| Source basis | the **local worktree** of branch `feat/claude-stage3b` (uncommitted + untracked files included; GitHub was not used) |
| Pre-work source backup | `DS-backups\DS-7CB-before-20261022-120148.zip` — 387 files, SHA-256 `8563008821ca2f0f37bdadd4ae28d59ca2c22bc6a613acc66422ec9c5cee21b2`. Contains no `.env`, `.git`, `node_modules`, `dist`, APK or Gradle output. |
| Post-work source backup | `DS-backups\DS-7CB-after-20261022-124053.zip` — SHA-256 `109f457d64c49b2c62026cff54dcaa720f3ada2b92abfbe7e2d6b361636a9533` (adds `deploy/staging/*`, `scripts/smoke-staging.mjs`, the config-check rule and these docs) |
| Deploy package (live) | **`a20cc1b066d3`** — `DS-backups\deploy-packages\ds-staging-a20cc1b066d3.tar.gz`, 171 files, SHA-256 `ab1954829677656e09c3db5c6fd04afa8c4414b1dd0b917735bb282078ecca94` |
| Previous package (rollback target) | `ce4335c10d07` (first deploy; differs only in helper scripts) |
| Package id | first 12 hex of SHA-256 of `MANIFEST.sha256` (one hash per file, inside the archive). `release.sh` refuses a package whose manifest or any file hash does not match. |
| Contents | `src/`, `prisma/` (**all 19 migrations incl. `20261029000100_customer_guest_android`** and `seed.ts`), `scripts/`, `package.json`, `package-lock.json`, `tsconfig*.json`, `Dockerfile`, `.dockerignore`, `deploy/` (incl. `deploy/staging/*`). |
| Not shipped | `.env*`, `.git`, `node_modules`, `dist`, `apps/` (Mini App ships via Vercel), `.claude`, docs, APKs, ZIPs, logs, credentials. A key-material grep runs before packaging. |
| Build tool | `deploy/staging/bin/package-release.sh` (Git Bash). It lists files with `git ls-files -c -o --exclude-standard` (tracked + untracked-not-ignored) and then filters explicitly — it does not blindly follow `.gitignore`. |

## 2. Server and services

Host: Contabo VPS `169.58.84.10` (Ubuntu 24.04.5, 4 vCPU, 8 GB, 100 GB). Before any change it was inspected: no Docker, no web server, no database, only `sshd` listening; one pre-existing locked user `ubuntu` (no key, no password) — left untouched.

| Layer | Detail |
|---|---|
| Docker | Docker Engine 29.9.2 + Compose plugin v5.6.1 (official Docker apt repo); `/etc/docker/daemon.json`: json-file logs `10m × 5`, `live-restore` |
| Project | `docker compose -p ds-staging`, file `deploy/staging/docker-compose.staging.yml` |
| Services | `db` (postgres:18-bookworm, 18.6, DB `ds_delivery_test`, named volume `ds-staging_pgdata`, **internal network only**), `backend` (`ds-staging-backend:<package-id>`, non-root `node`, read-only rootfs, `cap_drop ALL`, `no-new-privileges`, 1 GB cap), `caddy` (caddy:2-alpine = v2.11.7, only published ports 80/443), `migrate` (profile `tools`, on demand) |
| Networks | `internal` (`internal: true`: db + backend, no route out) and `edge` (backend + caddy). **The backend has no published port**; PostgreSQL has none either. Because Docker publishing bypasses ufw, nothing but 80/443 is ever published. |
| Restart | `restart: unless-stopped` on db/backend/caddy; Docker enabled at boot. **Reboot test PASS**: all three containers came back healthy by themselves, cert reused. |
| Paths | `/opt/ds-staging/{releases/<id>,current,previous,config/staging.env (600),backups/db (700),inbox}` |
| Users / SSH | user `deploy` (docker group, sudo), key `~/.ssh/ds_staging_ed25519` on the workstation (private key never left it; alias `ds-staging` in `~/.ssh/config`). `/etc/ssh/sshd_config.d/10-ds-hardening.conf`: `PasswordAuthentication no`, `PermitRootLogin no`, `AllowUsers deploy`. |
| Firewall | ufw active: `22/tcp LIMIT`, `80/tcp`, `443/tcp` (v4+v6); default deny incoming |
| Time | host `UTC` (chrony/timesyncd synchronized), containers `UTC`. The Asia/Tashkent restaurant rules are explicit in the application (`Intl` with `timeZone: 'Asia/Tashkent'`, fixed `+05:00` report offset) and are independent of the host zone. |
| TLS | Caddy, Let's Encrypt (issuer CN=YE1), valid 2026-10-22 → 2027-01-20, automatic renewal; certificates persisted in volume `ds-staging_caddy_data`. HTTP → HTTPS 308. No ACME contact e-mail was configured. |

DNS (checked from 8.8.8.8 and 1.1.1.1): `staging.sultonxoja.uz A 169.58.84.10`, **no AAAA**. Only the staging subdomain is used.

SSH hardening order: key login as root verified → `deploy` user created with the same public key → separate `deploy` key login + `sudo` + `docker` tested → hardening applied with a 4-minute dead-man revert timer → fresh `deploy` login re-tested, root and password logins confirmed refused → timer cancelled → reboot → re-login. Break-glass: the Contabo VNC/serial console (root password is unchanged).

## 3. Configuration names (values are never in Git, images, logs or this document)

`/opt/ds-staging/config/staging.env` (mode 600, owner `deploy`, outside the build context). Created by `bin/init-config.sh` with random secrets taken from `/dev/urandom` **on the server**; nothing secret passed through the terminal.

| Name | Staging value / rule |
|---|---|
| `STAGING_DOMAIN` | `staging.sultonxoja.uz` |
| `STAGING_ALLOW_IPS` | space-separated IPs allowed past the edge gate (currently the two public egress IPs of the owner's connection) |
| `POSTGRES_PASSWORD`, `INTERNAL_API_KEY` | random, secret |
| `BOT_ENABLED` | `false` |
| `BOT_TOKEN` | **random PLACEHOLDER** (`100000001:PLACEHOLDER…`): `MINIAPP_ENABLED=true` requires a syntactically valid token even with the bot off; the placeholder makes Telegram initData always fail verification |
| `TAXI_BOT_TOKEN` | unset |
| `MINIAPP_ENABLED` / `ANDROID_GUEST_ENABLED` | `true` / `true`; `GUEST_BOOTSTRAP_PER_IP_HOUR=20` |
| `TAXI_OPERATOR_ALLOWLIST` | `0` — no real operator id can match, so no real taxi message is possible |
| `MINIAPP_URL`, `BOT_USERNAME` | unset on purpose (the bot's menu button is never touched) |
| `SHUTDOWN_TIMEOUT_SECONDS` | `15` |
| Pinned in compose (cannot be edited away by mistake) | `NODE_ENV=staging`, `TRUST_PROXY=1`, `STAGING_ACCESS_GATE=edge`, `BOT_PAYMENT_MODE=MOCK`, `GMAIL_ENABLED=false`, `HOST=0.0.0.0`, `PORT=4000` |

`GMAIL_ENABLED=false`; no Gmail credentials exist on the server. `BOT_PAYMENT_MODE=REAL` is impossible here: config validation rejects REAL with a `…test…` database name, without Gmail, or without a card map.

## 4. Safe "explicit staging" mode (MOCK is not silently open)

Production preflight still refuses `NODE_ENV=production` + MOCK — unchanged. MOCK is only reachable with `NODE_ENV=staging`, which already existed. Two new protections:

1. **Code (`src/lib/config-check.ts`, +1 unit test).** `NODE_ENV=staging` + `BOT_PAYMENT_MODE=MOCK` + `ANDROID_GUEST_ENABLED=true` + a non-loopback `HOST` now **refuses to start** unless `STAGING_ACCESS_GATE=edge` is set, i.e. the operator explicitly confirms an edge restriction exists. Local development (no `NODE_ENV=staging`) and all other combinations are unaffected. `src/lib/config-check.test.ts` covers the matrix (16/16 pass).
2. **Edge gate (`deploy/staging/Caddyfile`).** Everything except `/health/live` is answered only to `STAGING_ALLOW_IPS`; everyone else gets `403`. The check uses the TCP peer address, not any header.

Why not a shared secret in the APK: it is extractable from the APK and would give a false sense of security; it was not used.

Measured (see §6): non-allowlisted callers get 403 on `/health/ready`, `/api/*`, `POST /guest/session`, with or without forged `X-Forwarded-For` / `X-Real-IP` / `Forwarded`. Internet scanners hit the host within minutes of the certificate issuance (`/config.json`, `/login.action`, …) and were all refused.

### Public (non-allowlisted) tester access — prepared, **not enabled**
The anonymous guest sign-up plus MOCK checkout must not face the open internet. The owner's connection egresses from **two alternating IPs**, so an IP allowlist is fragile for a phone on mobile data. Options, in order of preference:
1. **Per-tester invite codes (recommended; needs a code change).** `POST /guest/session` additionally requires an invite code that the server checks against a list of SHA-256 hashes in `staging.env` (per-code use limit, revocable by removing the hash); the APK shows one extra input on first launch. Then the edge gate can be opened for `/api/v1/miniapp/*` only. This is real access control because each code is revocable and not shared by everybody who has the APK. **Not implemented** (needs backend + APK + tests).
2. **Allowlist the tester's phone IP** (`bin/set-secret.sh STAGING_ALLOW_IPS --value "<ip> <ip>"` then `bin/release.sh restart caddy`). Works today; breaks when the carrier IP changes.
3. VPN (WireGuard/Tailscale) for testers; ACME HTTP-01 still needs port 80 open.

## 5. Bots and workers

Bots are **OFF** (`BOT_ENABLED=false`), therefore: no Telegram polling, no payment notifier, no restaurant notifier, no support notifier, no taxi dispatcher worker, no Gmail. Only the in-process payment maintenance timer runs.

- **BLOCKED — owner action needed to enable bots:** a *dedicated staging* bot token. The local `.env` has `BOT_ENABLED=true` with its own tokens; those tokens were **not** copied to the server and the local bot was not touched. Two polling processes on one token produce Telegram 409 and the server process exits (`launchPolling`), so use a **new bot** for staging (BotFather → `/newbot`). Then:
  - `ssh -t ds-staging /opt/ds-staging/current/deploy/staging/bin/set-secret.sh BOT_TOKEN` (hidden prompt; nothing in shell history or logs)
  - `ssh ds-staging /opt/ds-staging/current/deploy/staging/bin/set-secret.sh BOT_ENABLED --value true`, then `release.sh restart`.
  - For the taxi flow use a second new bot as `TAXI_BOT_TOKEN`, set `TAXI_OPERATOR_ALLOWLIST` to **your own** Telegram id, and link the test taxi company to that same id (§9). Taxi requests then go only to you.
- Worker/duplicate behaviour verified without a token: a second backend container on the same DB started healthy with no errors in either log (it only runs the lock-serialised, idempotent payment maintenance loop — the same caveat as in 7C-A: never run replicas). The 409-on-second-poller path is covered by `telegram.integration` (fake Telegram) but **not run against live Telegram** (NOT RUN).
- Telegram-unlinked guest customers do not break the notifiers (code reviewed: `notify.ts`, `restaurant-notify.ts`, `support-notify.ts`, `taxi/worker.ts` settle the marker and continue; tested in 7C-A guest tests).
- **Checkout needs an eligible taxi company.** The seed creates `Sinov taksi (TEST)` **without an operator**. With no operator, `POST /orders` returns `409 TAKSI_XIZMATI_MAVJUD_EMAS` (verified). For the black-box order test the operator id `0` was linked **temporarily** and unlinked afterwards; no dispatcher was running, so nothing could be sent.

## 6. Checks performed (all on the deployed system unless noted)

| # | Check | Result |
|---|---|---|
| 1 | `docker compose config`, image build (`runtime`, `migrate`), build with scripts for Prisma engines | PASS (second build ran cached) |
| 2 | Prisma 6.18.0 CLI + client; Linux query engine `debian-openssl-3.0.x` present | PASS |
| 3 | Runtime image: user `node`, no `.env*`/`*.pem`/credentials in `/app`, `docker history` has no `BOT_TOKEN`/`POSTGRES_PASSWORD`/`INTERNAL_API_KEY`/DB URL, image env names = `PATH NODE_VERSION YARN_VERSION NODE_ENV HOST PORT` | PASS |
| 4 | `prisma migrate deploy` on empty PG 18.6: **19/19 applied**, 35 tables; second run = "No pending migrations" | PASS |
| 5 | Compiled backend start (`node dist/src/server.js`), `/health/live` 200, `/health/ready` 200 `{"database":"up","customerBot":"disabled","taxiBot":"disabled"}` — only coarse states | PASS |
| 6 | **DB outage:** `docker stop db` → `/health/ready` **503** (`database: down`), `/health/live` **200**; `docker start db` → `/health/ready` 200 again within ~2 s, **backend RestartCount 0** (no restart needed) | PASS |
| 7 | **SIGTERM:** `docker stop` and `docker kill -s SIGTERM`: log `SIGTERM: shutting down`, **exit code 0 in ≈1 s**, not OOM-killed | PASS |
| 8 | **Persistence:** `compose down` (no `-v`) + `up`: orders/customers/guest sessions/migrations identical; volume kept | PASS |
| 9 | **Reboot:** containers returned on their own, healthy, HTTPS up, ufw active | PASS |
| 10 | **Update:** `release.sh deploy` of package `a20cc1b066d3` = hash verify → build → pre-migrate dump → migrate (no-op) → up → health → symlink | PASS |
| 11 | **Rollback / roll-forward:** `release.sh rollback ce4335c10d07` and back — both healthy, no rebuild | PASS |
| 12 | Public HTTPS: Let's Encrypt cert for the exact host, `Via: Caddy`, `X-Content-Type-Options`, `Referrer-Policy`, no `Server` header; HTTP→HTTPS 308 | PASS |
| 13 | Public ports from the internet: **22, 80, 443 open; 4000, 5432, 2019, 3000 closed**. Host `ss`: only 22/80/443 (+ local resolver) | PASS |
| 14 | Anonymous private endpoints (`/miniapp/*`, `/restaurant/*`, `/internal/*`, internal mock-incoming), unknown `dsg_` credential, forged Telegram `initData` + spoofed `X-Platform`, wrong internal API key | all **401** (PASS) — `scripts/smoke-staging.mjs` |
| 15 | Edge gate: non-allowlisted source (the server itself via its public IP) → 403 on `/health/ready`, `/api/*`, `POST /guest/session`, also with forged `X-Forwarded-For` / `X-Real-IP` / `Forwarded`; `/health/live` → 200 | PASS |
| 16 | `TRUST_PROXY=1`: a request from the allowlisted IP carrying forged `X-Forwarded-For: 1.2.3.4` / `X-Real-IP: 5.6.7.8` is logged by the backend with the **real** peer IP (Caddy overwrote the headers). Rate limits therefore key on the true client address. | PASS |
| 17 | Black-box MOCK checkout over HTTPS (`smoke-staging.mjs --order`): guest session → profile → catalog → quote → order 201 → read own order → **second guest gets 404 for it** → MOCK payment 200 | PASS |
| 18 | Second backend instance (bots off) next to the first: healthy, no errors | PASS (documented caveat) |
| 19 | Backup/restore (§7) | PASS |
| — | Resource use at idle: backend ≈120 MiB, db ≈67 MiB, caddy ≈54 MiB; host 638 MB used of 7.9 GB; disk 6 % | measured |

Not run: live Telegram polling and the 409 duplicate-poller test, the Linux Chromium UI suite, Android E2E, any REAL payment or taxi request, Windows suites already passing in earlier stages.

Observation (not fixed): the production image also contains `typescript` (pulled in as a peer of Prisma); harmless but slightly larger. The `node:24-bookworm-slim` base is not digest-pinned (currently Node v24.22.1); `caddy:2-alpine` = v2.11.7 digest `sha256:24ec7b05…62bd`, `postgres:18-bookworm` digest `sha256:bbf83594…20fc` at deploy time.

## 7. Backup and restore evidence

- **Script:** `bin/backup-db.sh` — `pg_dump -Fc --no-owner` of `ds_delivery_test` into `/opt/ds-staging/backups/db` (dir 700, files 600), SHA-256 file, keeps the newest 14. `/etc/cron.d/ds-staging-backup` runs it nightly at 02:30 UTC. A dump is also taken automatically before every migration (`pre-migrate-<id>`).
- **Restore proof:** `bin/restore-check.sh` starts a **disposable** `postgres:18` container (own tmpfs, no network, no volume, removed afterwards), restores the dump into a database named `ds_delivery_test` *inside it*, and compares per-table row counts with the live DB (read-only). Result: checksum OK, **35 tables, row counts identical**, 19 migrations present in the restored copy. The running staging DB was never written to.
- **Off-server copy:** `DS-backups\_private-db-staging\` (ACL: current Windows user only; outside the source ZIPs and Git) holds `ds_delivery_test-20261022T073132Z-first-staging.dump` (+ `.sha256`, verified after copy). The directory is **not** in any source ZIP.
- **NOT DONE:** automatic off-server backup. The copy above is manual (`scp ds-staging:/opt/ds-staging/backups/db/<file> …`). Until an automated off-host target exists, a lost VPS loses everything since the last manual copy. The dump contains phone numbers and addresses of test users — treat it as sensitive.

## 8. Update and rollback procedure

On the workstation (Git Bash): `deploy/staging/bin/package-release.sh` → prints `PACKAGE_ID=<id>` and writes `…/deploy-packages/ds-staging-<id>.tar.gz` (+ `.sha256`).

```
scp ds-staging-<id>.tar.gz ds-staging:/opt/ds-staging/inbox/
ssh ds-staging 'cd /opt/ds-staging/inbox && sha256sum ds-staging-<id>.tar.gz'          # compare with the .sha256 file
ssh ds-staging '/opt/ds-staging/current/deploy/staging/bin/release.sh deploy /opt/ds-staging/inbox/ds-staging-<id>.tar.gz <id>'
```
`deploy` = verify manifest and every file hash → extract to `releases/<id>` → `compose build` (images tagged `<id>`) → pre-migrate dump (if a previous release exists) → `prisma migrate deploy` → `up -d backend caddy` → wait for healthy → move `current`/`previous` symlinks. The first build took roughly 10 minutes on this VPS; a build with an unchanged dependency layer is much faster. Run it detached (`nohup … &`) if your SSH client times out.

Rollback: `release.sh rollback <previous-id>` restarts the already built image (no rebuild). Schema is not rolled back (migrations are additive); for a **data** rollback restore a `pre-migrate-*` dump into a new database as in 7C-A §7. Config change: `set-secret.sh NAME [--value V]` then `release.sh restart [backend|caddy]` (`caddy` is for `STAGING_ALLOW_IPS`). Status/logs: `release.sh status`, `release.sh logs [service]`.

Never: `docker compose down -v`, `prisma migrate reset/dev`, deleting `ds-staging_pgdata`.

## 9. Test data

`prisma/seed.ts` was audited before use: it only upserts restaurant `demo-restoran`, category `Taomlar`, product `Demo burger` (21 000 so'm), MOCK card `***9099` (`isTest`) and taxi company `Sinov taksi (TEST)` **without** an operator; no chat id, no network call. It was run once from the production image (`node dist/prisma/seed.js`). Black-box tests created a few guest customers and one MOCK order (paid with MOCK). Nothing from the local database was copied; the local DB was not touched. To link **your own** Telegram id as the test taxi operator (and restaurant staff id), after `TAXI_OPERATOR_ALLOWLIST` contains that id, run the existing fixture tool from the `migrate` image (it refuses any database whose name lacks "test"):
```
cd /opt/ds-staging && REL=$(basename $(readlink -f current))
DS_RELEASE=$REL docker compose -p ds-staging -f releases/$REL/deploy/staging/docker-compose.staging.yml --env-file config/staging.env \
  run --rm --no-deps migrate node --import tsx src/tools/setup-local-test.ts demo-restoran <your-telegram-id> <your-telegram-id>
```
The tooling path was verified with a non-existent slug (clean "Restoran topilmadi" failure, no change). Never link anyone else's id.

## 10. Remaining blockers / not done

1. **Staging bot token(s)** (new BotFather bot; taxi bot optional) — bots, notifiers, support, taxi worker and the 409 test are not run. **BLOCKED on the owner.**
2. **Public tester access** (invite codes or per-IP allowlisting) — only the allowlisted IPs can use the API today.
3. **Automatic off-server backups** and restore drill scheduling — manual copy only.
4. **Mobile E2E on a real phone** — not performed. An APK built against `https://staging.sultonxoja.uz` does not exist yet (existing APK untouched, Vercel/BotFather untouched).
5. No uptime monitor / alerting yet; no log shipping (Docker logs rotate at 10 MB × 5).
6. REAL payments, Gmail, restaurant onboarding, push notifications: out of scope and still off.
7. In-memory rate limiter and "exactly one backend instance" rule remain (same as 7C-A).
8. Base images are tag-pinned, not digest-pinned (digests recorded above).

## 11. Next steps for the phone test

See the final report in the chat; short version:
1. Create a **new** staging bot in BotFather and install its token with `set-secret.sh BOT_TOKEN` (hidden prompt), keep the local bot stopped or on its own token.
2. Open `https://api.ipify.org` on the phone (same Wi-Fi as the PC = already allowlisted; on mobile data send/add that IP) and add it to `STAGING_ALLOW_IPS`.
3. Link your own Telegram id as the test taxi operator and set `TAXI_OPERATOR_ALLOWLIST` to it (checkout needs an eligible company).
4. Build a debug APK with `DS_API_BASE_URL=https://staging.sultonxoja.uz` (`apps/customer-miniapp`, `npm run android:sync`, `gradlew assembleDebug`) and walk the list in `docs/CUSTOMER_ANDROID_MVP.md` §11.

## 12. Files added or changed in 7C-B2

New: `deploy/staging/{docker-compose.staging.yml,Caddyfile,staging.env.example}`, `deploy/staging/bin/{bootstrap-server,init-config,set-secret,release,backup-db,restore-check,package-release}.sh`, `scripts/smoke-staging.mjs`, `docs/STAGE_7C_B2.md`. Changed: `src/lib/config-check.ts`, `src/lib/config-check.test.ts` (staging gate), `.gitignore`, `.dockerignore` (`deploy/**/*.env`), `docs/STAGE_7C_B1.md` (Linux results appended).

## 13. Update — customer bot enabled on the VPS (2026-10-22, later the same day)

Owner decision: the existing customer bot is a **test** bot; it was moved to the VPS instead of creating a new one. This supersedes the "BLOCKED: staging bot token" items in §0, §5 and §10 for the customer bot (the taxi bot is still not configured).

| Step | Result |
|---|---|
| Local polling process | None was running (no `node`/`tsx`/`cloudflared` process, nothing listening on 4000), so there was nothing to stop. No local process was touched. |
| Token transfer | Only `BOT_TOKEN` was read from the local `.env` and piped over SSH stdin into `set-secret.sh` on the server (validated format, never printed, not in argv/logs/package/Git). The rest of `.env` was not copied. The placeholder is gone; `staging.env` is mode 600. |
| Bot identity / webhook | `getMe` ok (`@ziadin_food_order_bot`), **no webhook set**, 0 pending updates (checked from the server without printing the token). |
| Polling | `BOT_ENABLED=true`, backend restarted: "Telegram client bot started in polling mode", taxi dispatch worker + support notifier started, `/health/ready` → `customerBot: "polling"`. Watched ≥ 2 minutes: **no 409/conflict, no error lines, RestartCount 0**. Exactly one polling instance exists (one backend container; no local one). |
| Not done on purpose | A deliberate second poller to provoke 409: Telegram ends the *older* long poll, which would take the live bot down. The 409 handler stays covered by the fake-Telegram test only. |
| Telegram linking | `POST /me/telegram-link` returns a deep link to `https://t.me/ziadin_food_order_bot?start=lnk_…`. The backend takes the username from the bot's own `getMe` (no `BOT_USERNAME` needed), so the APK needs **no change**. |
| MINIAPP_URL | still unset → the bot's menu button is not modified. |
| Taxi | `TAXI_BOT_TOKEN` is **not set** and the customer token was not reused for it. `TAXI_OPERATOR_ALLOWLIST` is now the owner's own Telegram id (taken from the local `.env`) and the test company `Sinov taksi (TEST)` is linked to that id, because checkout returns 409 without an eligible company. Consequence: when a test order reaches the dispatch time, the dispatcher can send **one clearly marked MOCK message to the owner's own account** through the customer bot (legacy single-bot mode). Nobody else can receive anything. Move the taxi token to the VPS (owner's permission needed) to get the separate taxi bot. Existing rows: order #1 dispatch `NEEDS_HELP` (created while the operator was unlinked), order #2 `SCHEDULED`. |
| Still unchanged | MOCK, `GMAIL_ENABLED=false`, edge IP allowlist (two egress IPs), `NODE_ENV=staging`. Order smoke re-run with the bot on: PASS. |

### Staging debug APK
`DS-backups\apk\ds-customer-staging-debug-20261022-1325.apk` (4.0 MB, debug-signed, SHA-256 `001a7c961c04803d6686e0f3cda4465331e6f1651b4359000e59c567bb0551b9`), built with `DS_API_BASE_URL=https://staging.sultonxoja.uz` (`npm run android:sync` + `gradlew assembleDebug`; the bundle contains the staging URL and no `10.0.2.2`). The earlier emulator APK in `android/app/build/outputs` was overwritten by this build; no tracked file changed. Installed nowhere yet; the phone E2E has **not** been run.

Phone prerequisites: the phone must reach the API from an allowlisted IP (home Wi-Fi = already allowed; mobile data → add its IP with `set-secret.sh STAGING_ALLOW_IPS --value "<ip> <ip> …"` + `release.sh restart caddy`), and you must press `/start` in `@ziadin_food_order_bot` once to receive bot messages.

## 14. Update — phone test findings (2026-10-22, afternoon)

First phone run of the staging APK found two failures; both were a single client bug, plus an unrelated configuration gap for the Telegram Mini App.

| Finding | Cause | Fix |
|---|---|---|
| MOCK payment button did nothing; "Telegramga bog'lash" could not open Telegram | Backend log: `POST /me/telegram-link` and `POST /orders/:id/mock-payment` → **415**. The Android native HTTP layer (CapacitorHttp) labels a **bodiless** POST as `application/x-www-form-urlencoded`; Fastify has no parser for it. Reproduced against staging with curl (415 for that content type, 200 without one). Routes that always sent a JSON body (guest session, orders, cancel) worked. Affects 6 routes: `telegram-link` (+`/confirm`, `/cancel`), `mock-payment`, `addresses/:id/default`, `DELETE addresses/:id`. | `apps/customer-miniapp/src/lib/api.ts`: every non-GET request now sends an explicit JSON `{}` when it has no body. Regression test `tests/api-body.test.ts`; frontend suite 46/46, `tsc` clean. Verified on staging that all six routes accept `{}` (404 only for fake ids). **No backend change.** New debug APK: `DS-backups\apk\ds-customer-staging-debug-20261022-1404-fix415.apk`, SHA-256 `82E58813BEC48872CF93CB5A4CB9C15BFB80E44A5F083741019A9E36F3EC2166`. |
| Mini App inside the Telegram bot does not work | The bot's menu button pointed to `ds-delivery-miniapp.vercel.app`, whose `vercel.json` rewrites `/api/v1/miniapp/*` to the dead Quick Tunnel. Even with a corrected rewrite, requests would come from Vercel's changing IPs and be refused (403) by the staging IP allowlist. | The image now builds and serves the Mini App itself at **`https://staging.sultonxoja.uz/app/`** (new `miniapp` stage in `Dockerfile`; `.dockerignore`/`package-release.sh` ship `apps/customer-miniapp` without `android/`). With the owner's approval `MINIAPP_URL` was set and the bot's menu button now points there (`setChatMenuButton` reported `SET`). Opens only from allowlisted IPs. Vercel and `vercel.json` were not touched. |

Deployed package: **`740cb099dc84`** (213 files, SHA-256 `73dca9bce048b4578d7c9e50e738be596f0a8df305aa7ad051f36abd87119744`); previous `a20cc1b066d3` is the rollback target. Pre-migrate dump taken; no pending migrations. `/app/` serves HTML with CSP and cached hashed assets (checked through HTTPS). Mini App behaviour inside real Telegram is **not yet tested**.

### Restaurant Android app (answer)
`apps/restaurant-android` is a Stage-1 native skeleton (login + menu) with an in-app server-URL dialog (default `http://10.0.2.2:4000/`). It can talk to staging by entering `https://staging.sultonxoja.uz/` there, but only if: the phone is on an allowlisted IP, and the restaurant has an API password. `demo-restoran` has **none** yet. Set it with the hidden-prompt tool (interactive, so run it yourself):
```
ssh -t ds-staging 'cd /opt/ds-staging && REL=$(basename $(readlink -f current)) && DS_RELEASE=$REL docker compose -p ds-staging -f releases/$REL/deploy/staging/docker-compose.staging.yml --env-file config/staging.env run --rm --no-deps migrate node --import tsx src/tools/set-restaurant-password.ts demo-restoran'
```
Not tested on a device. Whether the restaurant APK you installed is newer than this Stage-1 source is unknown.

## 15. Restaurant admin APK against staging

Correction to §14: the repo's `apps/restaurant-android` is only the old Stage-1 skeleton (no real login). The full restaurant app (64 Kotlin files: login, orders, accept/ready/refund, catalog, operations, finance — all matching the current `/api/v1/restaurant/*` routes) lives in **`C:\Users\Acer\Documents\DS-gemini\apps\restaurant-android`**. A debug build of that tree was made from a **scratch copy** (that project was not modified); the only change is the debug `DEFAULT_BASE_URL`: `http://10.0.2.2:4000/` → `https://staging.sultonxoja.uz/`. Gradle 8.7 wrapper of the customer project was used because the app has no wrapper script; JDK 21 (Android Studio JBR); build took ≈ 6 min.

- APK: `DS-backups\apk\ds-restaurant-staging-debug-20261022-1418.apk` (17.4 MB, debug-signed, package `com.dsdelivery.restaurant.debug`), SHA-256 `dee202d47bdfe68b3c554416c669abc542ce3bf88a52e78ab5a5831ac6e1a135`. The staging URL is present in the compiled classes. Release builds need `-PdsApiBaseUrl=https://…` and a signing key (not done).
- Login contract checked statically against `src/modules/restaurant-auth/routes.ts` (`slug`+`password` → `accessToken`, `tokenType`, `expiresAt`, `restaurant`). Not run on a device.
- Needs before it can log in: a password for `demo-restoran` (command in §14) and an allowlisted phone IP. Bodiless POSTs (accept/ready/…) go through OkHttp with no Content-Type, which the server accepts (the 415 only affected CapacitorHttp).

## 16. Section A closing — taxi bot on the VPS, server-side Mini App auth check (2026-10-22)

Owner approved ("A bo'limini yop"): the **separate taxi bot** was moved to the VPS the same way as the customer bot (only `TAXI_BOT_TOKEN` read from the local `.env`, piped over SSH stdin, never printed; checked to differ from `BOT_TOKEN`). Both bots now poll from the VPS (`/health/ready` → `customerBot: polling`, `taxiBot: polling`); no 409, no webhook on either bot, 0 pending updates. Customer bot `@ziadin_food_order_bot`, taxi bot `@S18platformbot`. The dispatcher now sends operator messages through the taxi bot and customer notices through the customer bot (no legacy single-bot mode).

Server-side proof of the Mini App auth path with the **real** bot token (one-off container, nothing printed): correctly signed initData → `/config`, `/me`, `/restaurants` = 200; initData signed with a wrong token = 401; 2-day-old initData = 401. This checks the signature verification only — it does **not** replace opening the Mini App inside real Telegram. A stray Telegram-type test customer (fake id 7000000001) was created by this check.

Test fixture change: `demo-restoran.defaultPrepMinutes` 25 → 8, so a taxi request is due ≈ 1 minute after payment (due = start + prep − `TAXI_LEAD_MINUTES`(7)) instead of 18 minutes. Restaurant password exists (`RestaurantCredential` row present); no restaurant session had been created yet. Old test dispatches for orders #1 and #2 are `NEEDS_HELP` (from earlier smoke tests); ignore them or answer "Taksi yo'q".

Still requiring a person with a phone: customer APK checkout/MOCK payment/Telegram linking, Mini App inside Telegram, restaurant APK login and order handling, operator taps in the taxi bot (checklist in the chat).

## 17. Restaurant APK v2 (2026-10-22)

The restaurant app never reached the server (no `/api/v1/restaurant/*` request and no 403 in the gateway log). Cause candidate found in `ApiConfig.kt`: a base URL saved by an earlier install (SharedPreferences key `api_base_url`, same package `com.dsdelivery.restaurant.debug`) takes precedence over the built-in default, so installing the staging build over an older one keeps the old address. The v2 build (scratch copy again) uses a new key `api_base_url_staging`, so the default `https://staging.sultonxoja.uz/` always applies on first launch (it can still be changed in the app's server dialog). APK: `DS-backups\apk\ds-restaurant-staging-debug-20261022-1513-v2.apk`, SHA-256 `A4AEAD87294323E3F67DF0ECFC2A5B75DF828E6E2142B23A35BB01C3060146E2`. The older `…-1418.apk` has the same staging default but the prefs-override problem. Not yet confirmed on a device.

## 18. Section A closed — phone E2E confirmed (2026-10-22, evening)

Owner reported "hammasi ishladi"; verified independently in the staging database and logs:

| Evidence | Result |
|---|---|
| Orders | #4 and #5 `COMPLETED` (taxi `DELIVERED`), MOCK payments, orders #3–#5 belong to Telegram-linked customers |
| Telegram linking | one `TelegramLinkAttempt` `COMPLETED`; one guest customer merged into the Telegram customer (`mergedIntoId`) |
| Notifications | `NotificationLog`: `order-customer` 2/2 sent, `taxi-outcome` 2/2 sent (to the linked customer — closes the "unlinked guest only" gap) |
| Restaurant APK | login worked (1 session), orders polled with 200 |
| Taxi | request → accept → "Taksi yuborildi" → delivered through the separate taxi bot |
| Health | no warning/error lines in 3 h of backend log, `RestartCount` 0, `/health/ready` = polling/polling |

Still **not** covered by this run: REAL payments/Gmail, a real restaurant/operator other than the owner's own accounts, refund and cancellation paths on a paid order from the phone, price-change consent, backend restart in the middle of an order, mobile data (non-allowlisted IP), push notifications (not implemented), long soak. The admin role stays in Telegram for the pilot (owner decision); no admin APK.

Also changed: `docker-compose.example.yml` (production example) now pins PostgreSQL 18 with the data volume mounted at `/var/lib/postgresql`, matching staging (closes the 16-vs-18 open item of 7C-B1).

## 19. Off-server backup automation and monitoring (2026-10-22, night)

Package `be82dc80480f` (previous `38a10a81f760`) is live; it only adds the files below (no application change, no migration).

### Backups (supersedes the "NOT DONE" line in §7 — partly)
| Layer | What | Status |
|---|---|---|
| On the VPS | `backup-db.sh` nightly 02:30 UTC (cron), plus before every migration; 14 kept; SHA-256 next to each dump | running (§7) |
| Off the VPS | **`deploy/staging/bin/pull-backups.ps1`** on the owner's PC, scheduled by `register-backup-task.ps1` as the per-user task **`DS-Staging-Backup-Pull`** (at every logon and daily 12:00, runs late if the PC was off). It lists the dumps on the VPS over the `ds-staging` ssh alias (strict host key, key auth), copies the ones not yet present, **verifies each SHA-256 (deletes on mismatch)**, keeps the newest 30, and logs to `DS-backups\_private-db-staging\pull.log` (folder ACL: current user only; outside Git and ZIPs). First manual run copied the 2 missing dumps (3 kept), exit 0. | working |
| Limits | The copy exists only if the PC is on and logged in at some point after 02:30 UTC; both copies live in the owner's hands (the VPS and the laptop). It is **not** a cloud/offsite-in-another-place backup and dumps are not encrypted at rest beyond the folder ACL / disk. For production add a real offsite target (object storage or a second host) and encryption. | open |
| Restore drill | `restore-check.sh` (disposable container) — run it after every schema change and at least monthly; it was last run in §7. | manual |

### Monitoring
| Layer | What | Status |
|---|---|---|
| Inside | **`deploy/staging/bin/watchdog.sh`**, cron every 2 min as `deploy` (`/etc/cron.d/ds-staging-watchdog`). Checks: containers running/healthy, `/health/ready` (database up; customer/taxi bot `polling` when configured), HTTPS `/health/live` through Caddy with real certificate validation, certificate ≥ 14 days to expiry, disk < 85 %, newest DB dump < 26 h. Telegram message to the owner (`WATCHDOG_CHAT_ID`, customer bot; token passed to curl via stdin, never argv) after **2 consecutive failing runs** (a release restart does not alert), a reminder every 6 h while broken, and a "recovered" message. | working |
| Tested | Healthy run; dry-run with Caddy stopped and with the database stopped (both detected, then OK after restore); full path with real cron-style runs: 2 failing runs → 🚨 message sent, restart → ✅ recovered message; `--test-alert` message delivered. | PASS |
| Not covered | A **dead or unreachable VPS** cannot report itself. Add an external HTTP monitor (e.g. UptimeRobot free plan, 5-min interval) on `https://staging.sultonxoja.uz/health/live` (public by design, returns `{"ok":true}`) with e-mail/Telegram alert. Needs an account of the owner: **not done**. Also no log shipping and no CPU/memory alerting. | open |

Logs: `/opt/ds-staging/watchdog/watchdog.log`. Disable: `sudo rm /etc/cron.d/ds-staging-watchdog`. Remove the PC task: `Unregister-ScheduledTask -TaskName DS-Staging-Backup-Pull -Confirm:$false`.
