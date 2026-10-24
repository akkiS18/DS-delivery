# Production runbook (same VPS as staging)

Written 2026-10-23 (Stage 8C). Nothing here has been executed on the server yet. Steps marked **OWNER** need the owner; steps marked **GO** change what real customers or real money can reach and wait for the owner's explicit go. Secrets are only ever typed at a hidden prompt on the server (`set-secret.sh`) or copied by the owner over SSH; they never go through chat, Git or logs.

## 0. What runs where

| | Staging (test) | Production |
|---|---|---|
| Directory / compose project | `/opt/ds-staging`, `ds-staging` | `/opt/ds-prod`, `ds-prod` |
| Database | `ds_delivery_test` | `ds_prod` (the backend refuses REAL payments on a name with "test") |
| Bots | `@ziadin_food_order_bot`, `@S18platformbot` (test) | two NEW bots (customer + taxi) |
| Payments | MOCK only | REAL (Gmail-matched, restaurant confirms) |
| Proxy | shared `ds-edge` Caddy (80/443) → `staging-backend` | same proxy → `prod-backend` |
| Access | `STAGING_ALLOW_IPS` | `PROD_ALLOW_IPS` (starts `127.0.0.1` = nobody) |
| Scripts | `deploy/staging/bin/*` (wrappers) or `deploy/bin/*` with `DS_ENV=staging` | `DS_ENV=production deploy/bin/*` |

Capacity checked 2026-10-22: 4 vCPU, 8 GB RAM (0.75 GB used), 89 GB free disk. Production adds roughly one more backend (≤ 1 GB) and one database (≤ 2 GB limit).

## 1. Owner prerequisites (OWNER)
1. DNS `A` record for the production domain → `169.58.84.10` (wait until `nslookup` shows it).
2. Two new bots in BotFather (customer, taxi). Tokens are typed later into hidden prompts.
3. Telegram ids: your own (`SUPPORT_ADMIN_1`, watchdog chat) and, when available, a second administrator.
4. Google OAuth published and the new `gmail-token.json` + `credentials.json` on the PC (done 2026-10-22; token dated 23:25).
5. `LEGAL_OPERATOR_NAME` / `LEGAL_OPERATOR_CONTACT` text (who is responsible for the service) — the policy pages refuse to publish without them.
6. An `age` key pair for backups: on the PC, `age-keygen -o ds-backup-key.txt` (keep the private file in two safe places; only the public `age1…` line goes to the server).
7. Optional but recommended: an S3-compatible bucket (Backblaze B2, Contabo Object Storage…) for the encrypted offsite copy.

## 2. Move staging to the shared edge proxy (one-time, ~10 s of staging downtime) — do it when no test is running
```
# workstation
deploy/staging/bin/package-release.sh            # prints PACKAGE_ID; upload ds-staging-<id>.tar.gz to /opt/ds-staging/inbox (scp)
# VPS (ssh ds-staging)
mkdir -p /tmp/edge && tar -xzf /opt/ds-staging/inbox/ds-staging-<id>.tar.gz -C /tmp/edge deploy/edge deploy/lib
bash /tmp/edge/deploy/edge/cutover-staging.sh staging.sultonxoja.uz <production-domain>
```
The script attaches the running backend to the `ds-edge` network, validates the new Caddyfile, swaps the proxies, checks `https://staging…/health/live`, and restores the old Caddy automatically if anything fails. Afterwards deploy the same package the normal way (`deploy/staging/bin/release.sh deploy …`): its compose has no Caddy of its own. Keep the uptime monitor running; expect one short blip.

## 3. Production bring-up, locked to the owner's IPs (no customer can reach it)
```
ssh ds-staging
deploy/bin/bootstrap-production.sh                                  # directories + network (idempotent)
DS_ENV=production deploy/bin/init-config.sh <production-domain>     # random secrets, bots OFF, Gmail OFF, no CONFIRM_REAL_PAYMENTS
deploy/edge/edge.sh set PROD_ALLOW_IPS "<your IP> <your other IP>" && deploy/edge/edge.sh up
# first release (the typed confirmation is the package id):
DS_ENV=production DS_CONFIRM_PRODUCTION=<id> deploy/bin/release.sh deploy /opt/ds-staging/inbox/ds-staging-<id>.tar.gz <id>
```
With `CONFIRM_REAL_PAYMENTS` unset the backend refuses to start REAL payments in production, so the first start fails the config check **on purpose**; that proves the guard. Next, set the identity values (each is a hidden prompt, run on the server):
```
S='DS_ENV=production /opt/ds-prod/current/deploy/bin/set-secret.sh'
ssh -t ds-staging "$S BOT_TOKEN"            # production customer bot
ssh -t ds-staging "$S TAXI_BOT_TOKEN"       # production taxi bot (must differ)
ssh -t ds-staging "$S SUPPORT_ADMIN_1_TELEGRAM_ID"    # your id (non-secret; --value is fine)
ssh -t ds-staging "$S WATCHDOG_CHAT_ID"
ssh -t ds-staging "$S LEGAL_OPERATOR_NAME"; ssh -t ds-staging "$S LEGAL_OPERATOR_CONTACT"
ssh -t ds-staging "$S BOT_ENABLED --value true"
```
Gmail files (**OWNER**, from the PC): `scp credentials.json gmail-token.json ds-staging:/opt/ds-prod/inbox/` then on the server `DS_ENV=production deploy/bin/install-gmail-files.sh` (copies into the `ds-prod_gmail` volume as uid 1000, mode 600, then shreds the inbox copies).

**GO (real-money switch, still IP-locked):** `set-secret.sh GMAIL_ENABLED --value true`, `set-secret.sh CONFIRM_REAL_PAYMENTS --value yes`, then `release.sh restart backend`. Check, from the server: `docker exec ds-prod-backend-1 node -e "fetch('http://127.0.0.1:4000/health/ready').then(r=>r.json()).then(j=>console.log(JSON.stringify(j)))"` → `database: up`, both bots `polling`, `gmail: ok`.

**Stage 9, the payments door:** even with the steps above the production backend takes no REAL order until an administrator opens the door in the customer bot: `/payments` → "Real to‘lovni yoqish" → "Ha, yoqaman" (refused while Gmail is not `ok` or no approved active card exists; closing is always allowed and never touches orders already created). The row `real_payments_open` in `PlatformSetting` is absent = closed; every change is in `AdminAuditEvent`. Real money therefore needs three things: the server config (`CONFIRM_REAL_PAYMENTS=yes` etc., set by the server owner), the door opened by an administrator, and a card approved by an administrator.

Operations that must exist before any rehearsal:
```
# cron (deploy user), staggered:  */2 * * * * DS_ENV=production .../watchdog.sh     15 3 * * * DS_ENV=production .../backup-db.sh && DS_ENV=production .../backup-offsite.sh
# workstation: deploy/staging/bin/register-backup-task.ps1 -Environment production      (daily PC copy of the dump + receipts)
# UptimeRobot: a second monitor on https://<production-domain>/health/live
# one-time on the host: sudo apt-get install -y age rclone ; set BACKUP_AGE_RECIPIENT / OFFSITE_RCLONE_REMOTE with set-secret.sh ; create /opt/ds-prod/config/rclone.conf (mode 600)
```
Then run `DS_ENV=production deploy/bin/backup-db.sh`, `restore-check.sh` (expects `PASS`), `backup-offsite.sh`, and decrypt one `.age` file on the PC to prove the key works.

## 4. First restaurant and people (on the server, inside the container; hidden password prompts)
```
C='docker exec -it ds-prod-backend-1 node'
$C dist/src/tools/create-restaurant.js <slug> "<Name>" "<pickup address>" +998XXXXXXXXX
$C dist/src/tools/set-restaurant-password.js <slug>             # hidden prompt, twice
$C dist/src/tools/link-staff.js <slug> <staff telegram id>      # staff gets the "open the app" Telegram alerts
$C dist/src/tools/add-taxi.js / link-taxi.js ...                # see docs for the taxi operator tools; TAXI_OPERATOR_ALLOWLIST must contain the operator's id
```
**Stage 9, no SSH needed for the usual setup:** administrators can do steps above in the customer bot: `/newrestaurant Nomi | Manzil | +998…` (starts PAUSED, prints the login code and a one-time password), `/resetpassword <kod>`, `/linkstaff <kod> <telegram id>`. The CLI tools below remain for the server owner.

The restaurant installs the release APK, signs in, adds its card under **Operatsiyalar → To‘lov kartalari** (number + account password). You get a Telegram message with the full number: call the owner of the restaurant, then confirm with the two-step button. Until then customers cannot order from that restaurant.

## 4a. Taxi operators work in the DS Taxi app (replaces the Telegram taxi bot)
- Backend: `TAXI_TELEGRAM_ENABLED=false` (`set-secret.sh TAXI_TELEGRAM_ENABLED --value false`, restart). Then the taxi bot is not started, `/taxi` answers "Taksi operatorlari endi DS Taxi ilovasida", and the dispatcher sends nothing to operators over Telegram. The customer bot keeps `/taxiadmin` (stuck-dispatch recovery) and the admins' Telegram alerts. Unset/`true` = the old Telegram panel keeps working next to the app (rollback).
- New company + login: administrator, customer bot: `/newtaxi Kompaniya nomi` -> login + one-time password (hand it to the operator). Existing company (e.g. the rehearsal one): `/taxiapp <login yoki kompaniya nomi>` creates the login the first time and sets a NEW password after that (signs every phone out). Both are audited (`AdminAuditEvent`), never with the password. A company is bookable when it has an app login (or, while the Telegram panel is on, a linked operator).
- Phone: install `ds-taxi-release-<version>.apk`, sign in, then Sozlamalar -> Tayyorlik: notifications, alarm volume, battery "cheklovsiz" (Doze/OEM killers are the #1 reason a background app misses a request). The app polls every ~3 s while a foreground service keeps it alive; that poll is also its heartbeat — if no phone polled for 90 s when a request is sent, the administrators are alerted at once ("ilovasi ulanmagan"); unanswered requests still escalate through CANCELLATION_PENDING -> `/taxiadmin` exactly as before.
- Not push (FCM) yet: a phone that is off, offline, or force-stopped by the user/OEM hears nothing; keep the operator phone charging on Wi-Fi/data and tell the operator never to "force stop" the app.

## 5. Real-money rehearsal (owner's own cards, small amounts, restaurant account the owner controls)
Use 1–3 of the owner's real cards as the restaurant's cards and pay from a different card or bank app. Record order #, time, result; never write card numbers in the report.

| # | Do | Expect |
|---|---|---|
| R1 | Order 1 item, pay the exact amount within 5 min | Gmail match → within ~15 s the order is confirmed by itself (`system:gmail-auto`) and cooking starts; the customer sees "to‘lovingiz qabul qilindi"; staff get one "yangi to‘langan buyurtma" Telegram alert; nobody presses anything. The restaurant's own confirm button must NOT be needed |
| R2 | Two orders with the same total at once | Different cards (or the second queued); each match goes to the right order |
| R3 | Pay a different amount (less, then more) | `/money` alert with the reason; no order moves and nothing confirms itself; close it with a note |
| R4 | Pay after the 5-minute window | Alert `LATE_FOR_EXPIRED_PAYMENT`; refund by the restaurant with a receipt photo |
| R5 | Order, do not pay; open a 3rd order | Third refused ("To‘lanmagan buyurtmangiz bor") |
| R6 | Disable the only card in the app | New checkout refused; re-enable restores it |
| R7 | Revoke Google access (or stop the mail) | `gmail: down` → Telegram alert within ~3 min and watchdog alert; restore → "tiklandi" |
| R8 | Restart the backend between payment and mail | The match still happens (mail is re-read; de-duplicated by Gmail id), then the automatic confirmation follows |
| R11 | Set `GMAIL_AUTO_CONFIRM=false`, restart, repeat R1 | Order stops at "to‘lov keldi"; the restaurant must confirm in the app (fallback proven); remove the variable and restart to go back to automatic |
| R9 | Cancel a paid order, restaurant refunds with a photo, customer sees it | Statuses and receipt as in STAGE_7D |
| R10 | Complete one delivery; later `/commission` | One 5 000 UZS entry due after the week closes; mark settled with a note |

## 6. Launch gate (**GO**), emergency stop, rollback
- Open: `deploy/edge/edge.sh set PROD_ALLOW_IPS "0.0.0.0/0 ::/0" && deploy/edge/edge.sh up`. Do it only after R1–R10 passed, the legal pages answer 200, the owner agreed, and the partners (restaurant, taxi operator, bank terms) are confirmed.
- Emergency stop (any time): `edge.sh set PROD_ALLOW_IPS "127.0.0.1" && edge.sh up` closes the front door in seconds; `/restaurants` suspends a restaurant; `set-secret.sh BOT_ENABLED --value false` + restart stops bots and workers. Existing orders keep their state.
- Rollback: `DS_ENV=production DS_CONFIRM_PRODUCTION=<previous id> deploy/bin/release.sh rollback <previous id>` (migrations are additive; restore a `pre-migrate-*` dump only for a data rollback).
- Never run `docker compose down -v` on any project.

## 7. Release procedure after launch
Package on the workstation → upload → `release.sh deploy` (it takes a `pre-migrate` dump first, runs `prisma migrate deploy`, starts the new backend, waits for health) → verify `/health/ready` and one smoke order → keep the previous id for rollback. A release that includes a new APK follows the APK checklist (`scripts/build-release-apks.ps1`, keep `versionCode` increasing).
