# Stage 8B/8C — production-readiness code (written 2026-10-23, not deployed)

Owner decisions (2026-10-22/23): write all code first and test everything in ONE batch; production on the same VPS; payee cards entered in the restaurant app; the money-arrival test happens on the production stack while it is still IP-locked (the backend refuses REAL payments on a database named `*test*`, and staging is `ds_delivery_test`). Reference: `docs/PROD_READINESS.md` (gap list), `docs/STAGE_8A.md` (how real payments work), `docs/RUNBOOK_PRODUCTION.md` (how it goes live).

Real payments and Gmail remain **off everywhere**; nothing in this stage enables them.

## 1. What was built

| Item | What | Where |
|---|---|---|
| C4 | At most 2 open unpaid REAL orders per customer (`MAX_OPEN_UNPAID_ORDERS`, 0 = off; MOCK unlimited unless set): a scripted client can no longer hold every (card, amount) slot. `429 KOP_TOLANMAGAN_BUYURTMA` | `orders/service.ts`, Mini App error text |
| C1 | **Payee cards managed in the restaurant app.** `Card.number` (16 digits, Luhn-checked, last four = the Gmail match key), `approvalStatus` PENDING/APPROVED/REJECTED. A new card starts PENDING **and inactive** (DB CHECK: unapproved ⇒ inactive), so the engine cannot assign it. Restaurant API: list (masked), add (needs the account password again; limits: 6 cards, 2 pending; 5 attempts/15 min), disable/enable (enable only after approval). Admin Telegram: the pending card is sent to the support admins **with the full number** to verify by phone; approval is a two-step button, decisions are compare-and-set (two admins ⇒ one decision); `/cards` overview. Checkout and the Telegram flow read `Card.number` (legacy `BOT_REAL_CARD_NUMBERS_JSON` is only a fallback and is now optional). REAL checkout is refused when the restaurant has no enabled card. Append-only `CardEvent` audit. Android restaurant app: "To‘lov kartalari" section in Operatsiyalar. | migration `20261031000100_card_management`; `restaurant-cards/*`, `bot/card-admin.ts`, `payment/requisites.ts`, app `PayeeCardsSection.kt` |
| C2 | **`/money`** for admins: unmatched incoming money (all 19 engine reason codes explained in plain Uzbek), four decisions (not ours / refunded / order resolved / other) closed with a 10–300 character note, compare-and-set, plus payments the restaurant has not confirmed for 10+ minutes. Gmail alert texts now explain the reason and point to `/money`. | migration `20261031000200_review_handling`; `payment/review*.ts`, `bot/money-admin.ts` |
| C3 | Restaurant staff get a Telegram "open the app" alert for a paid order (one per order, durable de-duplication, 2-hour window) and one reminder after 8 min without confirmation. Interim until push exists. | `bot/restaurant-alert.ts` |
| C5 | Pilot operations without an admin APK: **`/commission`** (weekly statement per restaurant: due / held by an open ticket / running week; two-step "paid" with a note; append-only settlement records, ledger untouched), **`/restaurants`** (suspend/resume: blocks login and signs every session out; audited), **`/admin`** command list, `npm run restaurant:create`. | migrations `20261031000300_commission_settlement`, `20261031000400_admin_audit`; `commission/settlement.ts`, `restaurant/admin.ts`, bot modules |
| C7 | Refund receipt retention: photos of CONFIRMED refunds are deleted after `RECEIPT_RETENTION_DAYS` (default 365); hash/type/size are kept (the same image still cannot prove a second refund). Encrypted offsite backup script (age + rclone). | migration `20261031000500_receipt_retention`; `refunds/retention.ts`, `deploy/bin/backup-offsite.sh` |
| C8 | Release builds: signing only from the environment (never debug-signed), `-PdsVersionCode/-PdsVersionName`, keystore creation and release-build PowerShell scripts. | both `build.gradle*`, `scripts/*.ps1` |
| C9 | Runtime image no longer contains the Prisma CLI tree (4 `npm audit` highs: `prisma`→`@prisma/config`→`effect`, `deepmerge-ts`); secrets scan of tracked files clean. | `Dockerfile` |
| C10 | `/legal/privacy` and `/legal/terms` served by the backend (503 until `LEGAL_OPERATOR_NAME`/`CONTACT` are set), linked from the customer Profile. | `modules/legal/*`, `Profile.tsx` |
| C6 | Production stack on the same VPS: shared **edge** Caddy (own project), `ds-prod` compose (own DB `ds_prod`, volumes incl. the Gmail token), parametrized scripts (`DS_ENV`), production env template, one-time staging cutover script, production bootstrap, Gmail file installer, typed release confirmation. The edge never exposes `/api/v1/internal`, `/health`, `/health/ready`. | `deploy/{lib,bin,edge,production}`, `docs/RUNBOOK_PRODUCTION.md` |
| config | REAL mode now also requires `BOT_ENABLED=true` and `SUPPORT_ADMIN_1_TELEGRAM_ID`; warnings for missing legal settings. | `lib/config-check.ts` |
| cleanup | Removed stale restaurant-app text ("not saved on the server" for settings that are saved; "propose a price via Telegram"). | app |

Bug found and fixed on the way: a CHECK constraint written as `A AND B OR C` lets a **NULL** comparison through (the constraint passes when it evaluates to NULL). The first drafts of `RefundRequest_receipt_complete` (and its 7D predecessor) and `IncomingTransaction_handling_complete` would have accepted half-filled rows; both are now explicit `IS NOT NULL` checks, with tests that try the half-filled rows.

## 2. Tests (local, `ds_delivery_test`, Windows, Node 24, PostgreSQL 18)

`tsc` clean (backend, customer Mini App). Unit: `npm test` 30, `test:deploy` 17, `test:restaurant` 6, `test:taxi` 11, `test:acceptance` 3, `test:refunds` 10. DB: checkout6f 13, miniapp 14, acceptance 10, acceptance2 8, payment.safety 10, refunds 14, orders 11, qa 18, telegram 9, finance 10, auth 13, catalog 15, operations 6, taxi 13, taxi.recovery 7, support 8, guest.android 9 — and the **new** suites: `test:cards:db` 10, `test:money:db` 5, `test:alert:db` 4, `test:settlement:db` 5, `test:radmin:db` 1, `test:retention:db` 5, legal pages (in `npm test`), config-check 10 (updated), health 5, Gmail health 14. Mini App `vitest` 46. Restaurant app: `compileDebugKotlin` passes; both apps' `assembleRelease --dry-run` configure with and without signing variables. Shell scripts: `bash -n` on all; the new Caddyfile validated with `caddy validate` and all three compose files parsed with `docker compose config` on the VPS (throw-away containers, nothing changed).

Existing suites that stage many unpaid orders for one customer (`acceptance`, `acceptance2`, `orders`, `checkout6f`, `cards`, `alert`) set `MAX_OPEN_UNPAID_ORDERS=0`; the cap has its own test in `checkout6f`.

## 3. NOT run (needs the batch / the server)
- Anything on a phone: the new card screen, the Telegram buttons (`/cards`, `/money`, `/commission`, `/restaurants`, `/admin`), the "open the app" alerts, the legal links. Rows added to `docs/PENDING_MANUAL_TESTS.md` §H.
- Docker image build with the new `Dockerfile` step (load check inside the build), the new migrations on the VPS, the staging→edge cutover, the production stack, `backup-offsite.sh` (needs `age`/`rclone` on the host), `install-gmail-files.sh`, watchdog changes (`docs/PENDING_MANUAL_TESTS.md` §I).
- Real Gmail polling with the new health code; real money (runbook §5).
- Release APK signing (keystore not created yet; owner action, `scripts/create-release-keystore.ps1`).

## 4. Known limits / decisions to confirm
- The administrator decides card approval by phone; there is no automatic proof that a card belongs to the restaurant.
- `/commission` records that a payment was **seen in the bank**; it does not reconcile amounts automatically.
- No push notifications: the Telegram alert needs the restaurant's staff account linked (`link-staff`). FCM remains a later stage (needs a Firebase project).
- Data location: the VPS provider and its country must be checked against Uzbekistan's personal-data rules before the public launch (roadmap §7 lists this as an open legal check); the privacy text describes what is stored, it is not legal advice.
- Product photos: no upload exists (not planned for the pilot).
- Restaurants' own view of a purged receipt shows no photo (only for CONFIRMED refunds older than the retention period).
- The edge IP gate is the launch control: `PROD_ALLOW_IPS` ≠ `0.0.0.0/0 ::/0` means closed.
