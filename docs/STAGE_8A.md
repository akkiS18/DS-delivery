# Stage 8A — real card payments via Gmail: what exists, what was missing, what comes next

Owner input (2026-10-22): real money works as in the earlier terminal system (`KARTA` folder): 3–4 cards, the bank's e-mail notification is read from Gmail. That was proven in terminal tests; this stage checks that the **backend** does the same and prepares it for a server. **Real payments stay off everywhere** until the owner starts the rehearsal in §6.

## 1. Which KARTA version is the reference

| Folder | What it is | Status |
|---|---|---|
| `ds1`, `ds2` | JSON-state prototypes (`state.json`) | superseded |
| **`ds3`** | **V3 terminal engine** (TypeScript, Prisma, PostgreSQL, advisory lock, partial unique index, Gmail reader) | **reference** |
| `dsb` | Telegram bot + checkout prototype built on top | already merged into the backend |

Comparison with `src/modules/payment` (diff, not memory): `gmail.ts`, `uzcard.ts` are identical to ds3 apart from the import suffix; `matching.ts` and `engine.ts` are ds3 **plus** later hardening: cards belong to a restaurant, append-only `PaymentEvent`, duplicate-notification fingerprint, amount-mismatch and late-money classes, compare-and-set matching, atomic order+payment checkout. Nothing from ds3 is missing in the backend.

## 2. How a real payment works (as implemented)

1. Customer checks out in REAL mode. The engine takes the restaurant's **real** cards (`isTest=false`) and assigns the card with the fewest open payments; **one open payment per (card, exact amount)**. If every card is busy for that amount the order waits (`QUEUED`, up to 10 min) and is assigned when a card frees up. The app shows the 16-digit number only from `BOT_REAL_CARD_NUMBERS_JSON` (never invented).
2. The customer has 5 minutes (`PAYMENT_WINDOW_SECONDS`) to transfer the **exact** amount.
3. Gmail polling (every 12 s, last 24 h, de-duplicated by Gmail id) parses the UZCARD mail (card last4, amount, operation minute) and matches it to the open payment → `MATCHED_UNVERIFIED`. The mail must come from `GMAIL_FROM`, pass DMARC/DKIM, arrive after the assignment, fall inside the window (minute precision) and not within 15 min of an earlier payment of the same card+amount.
4. **Gmail is a signal, not proof.** The restaurant checks its bank and presses "To'lovni tasdiqlash" → `CONFIRMED_MANUAL` → cooking starts → taxi dispatch. Nothing automatic writes `CONFIRMED_MANUAL`. This rule is kept for the pilot (a forged or mis-parsed mail would otherwise start cooking and a taxi on money that never arrived); changing it is a separate, explicit owner decision.
5. Everything doubtful is stored and goes to `REVIEW_REQUIRED` with a reason: unknown card, wrong sender/authentication, no open payment, wrong amount (below/above), late for an expired payment, already matched, possible duplicate notification, delayed mail (> 30 min), outside the window, same card+amount too recently.

Capacity: simultaneous open payments with the **same amount** ≤ number of cards (3–4). Different amounts do not compete.

## 3. Gaps found while checking the backend against a server deployment

| # | Gap | Evidence | Status |
|---|---|---|---|
| G1 | Token/credential paths were fixed to the working directory; the token is rewritten on every refresh, but the container root filesystem is read-only | `gmail.ts` constants; `Dockerfile` | **Fixed (8A-1)**: `GMAIL_CREDENTIALS_FILE` / `GMAIL_TOKEN_FILE`, atomic 0600 write, `/app/data/gmail` created for a volume |
| G2 | Without a token the reader opened the browser-consent flow and waited 3 min — impossible on a server | `createAccessToken` | **Fixed**: no TTY → immediate clear error |
| G3 | A Gmail failure was only a log line; the API stayed "ready", so paid orders would silently stop matching | `server.ts` catch, no health signal | **Fixed**: `checks.gmail` in `/health/ready`, watchdog alert, admin Telegram message on DOWN/RECOVERED, exponential backoff (cap 5 min) |
| G4 | Money that matched nothing (late, wrong amount, unknown card) was visible only in a terminal-style list | no bot/app code reads `REVIEW_REQUIRED` | **Partly fixed**: fresh (< 30 min) `REVIEW_REQUIRED` mail → admin message with amount, last4, reason. **Open:** a screen/command to list and resolve them (today the restaurant checks the bank and the refund flow returns the money) |
| G5 | Google OAuth app in *Testing* status: refresh tokens expire after **7 days** | README of ds3 | **Open — owner action** in Google Cloud (publish the app, or accept re-authorising weekly) |
| G6 | The OAuth consent needs a browser: it must be done on the owner's PC and the token uploaded | — | **Open**: procedure in §5; never commit/print the files |
| G7 | REAL mode is refused on a database whose name contains `test` and in production needs `CONFIRM_REAL_PAYMENTS=yes`; staging uses a test database | `config-check.ts` | **By design** → a separate production stack is required before any real money |
| G8 | Cards are added through the internal API (`POST /cards`, `x-internal-api-key`) and the 16-digit numbers through an env JSON; no operator tool | `orders/routes.ts`, `requisites.ts` | **Open** (small CLI planned in 8A-2) |
| G9 | One poisonous mail (ingest throws every time) would block later mail in the same poll; unchanged ds3 behaviour | `gmail.ts` loop | **Open**, low probability: the parser rejects malformed mail before the engine |
| G10 | The REAL path of the *backend* has never run with real money; only ds3 (terminal) did. Backend REAL logic is covered by DB tests on test cards/`isTest=false` rows without money | docs/STAGE_4A, `payment.safety.db.test.ts` | **Open** → rehearsal §6 |
| G11 | Personal card receiving commercial payments: bank rules/limits/tax are not checked by code | README of ds3 | **Owner/legal** |

## 4. What 8A-1 changed (code)

`src/modules/payment/gmail-health.ts` (pure state machine: `ok / degraded / down`, error classification, backoff) · `gmail.ts` (paths, atomic token write, no-TTY refusal, health/backoff/alert hooks, fresh-review alert) · `src/bot/gmail-alerts.ts` (admin texts: amounts, last4, reason codes only) · `src/lib/health.ts` (`checks.gmail`; an outage does **not** make the API unready) · `server.ts` (wiring) · `deploy/staging/bin/watchdog.sh` (alerts on `gmail: down`) · `Dockerfile` (`/app/data/gmail`) · `.env.example`. Behaviour with `GMAIL_ENABLED=false` is unchanged (`gmail: "disabled"`).

Tests: `src/modules/payment/gmail-health.test.ts` (14 incl. health route): error classes, backoff cap, DOWN/RECOVERED announced once, auth/config down at once, silent stall becomes down, fresh-mail window, alert texts contain no secrets, sender survives a failing Telegram send.

## 5. Procedure to give a server its Gmail token (when approved)

1. On the owner's PC: Google Cloud → publish the OAuth consent screen (G5) → `credentials.json` (Desktop app) → run the app locally once with `GMAIL_ENABLED=true` at a terminal; the browser consent writes `gmail-token.json`.
2. Copy both files to the server **over SSH** into the `gmail` volume (`/app/data/gmail`, mode 600, owner uid 1000). Never into Git, the image, chat or logs; delete the PC copies from any shared/synced folder.
3. Set `GMAIL_CREDENTIALS_FILE=/app/data/gmail/credentials.json`, `GMAIL_TOKEN_FILE=/app/data/gmail/gmail-token.json`, `GMAIL_ENABLED=true`. Check `/health/ready` → `gmail: ok`.
4. The token is a secret as strong as the mailbox: it must be in the private backups (volume) and rotated if the server is ever suspected.

## 6. Proposed next steps (each small, each approved by the owner)

- **8A-2 — production stack skeleton** (no real money yet): separate compose project, database without "test", own bot tokens, own domain, own secrets, backup/watchdog copies, `CONFIRM_REAL_PAYMENTS` unset. Card/number admin CLI (G8).
- **8A-3 — real-money rehearsal** on the production stack with the **owner's own cards and a restaurant account the owner controls**: 1) 3 cards, exact amount paid → `MATCHED_UNVERIFIED` → restaurant confirms → cooking; 2) wrong amount (below/above) → review alert; 3) same amount twice at once → second queued/different card; 4) pay after the 5-minute window → review; 5) kill Gmail token → DOWN alert within ~3 min; 6) restart mid-payment; 7) refund of a real paid order with the receipt photo. Small amounts only; report each result with the mail/payment ids (no card numbers).
- **8A-4 — closed pilot**: one real restaurant + one taxi operator, owner as the admin, daily bank-vs-orders reconciliation.

## 7. Needed from the owner

- Production domain (and its DNS) and whether production shares the VPS or gets its own server.
- Two new bots (customer + taxi) for production; the current test bots stay on staging.
- Google OAuth: publish the app (G5) and keep the Gmail account that receives the bank mails.
- The 3–4 real cards' last4 and which restaurant owns them; the 16-digit numbers go only into the server config via the hidden prompt.
- A second admin's Telegram id (alerts then reach two people).
- Confirmation that the restaurant (not the platform) is the legal payee and that the bank allows the volume.

## 8. Not run

Real Gmail polling with the new health code (staging has Gmail off, no token on the server); the Docker image rebuild with the new directory; the watchdog change on the server; the full DB suites (only the unit tests above and `tsc` were run).

## 9. Owner decisions after the first review (2026-10-22)

1. The first real-money order test is wanted **on staging**. Conflict: the staging database is `ds_delivery_test` and `config-check.ts` refuses `BOT_PAYMENT_MODE=REAL` on any database whose name contains "test" (by design). Recommended resolution: run the real-money rehearsal (8A-3) on the **production stack while it is still locked to the owner's IP**, so no real order ever touches the test database; staging stays MOCK.
2. Production lives on the **same VPS** as staging: separate compose project, database, volumes, secrets and bots; one Caddy can serve both hostnames. Capacity (RAM/disk) must be checked before it starts.
3. **Card numbers are entered in the restaurant admin app**, not in a server env JSON. Design notes (Stage 8B): a new table/columns for the payee number; the 16 digits are returned only to the owning restaurant (masked) and to customers at payment time, never logged; adding or changing a card is a money-redirection risk (a stolen restaurant session could point customers at another card), so a new card starts `PENDING`, the owner is alerted in Telegram and one tap approves it before it can be assigned. Needs a migration, API, app screen and a new restaurant APK (collected into the next batch, no per-fix APK).
4. Google OAuth: guide given in the conversation (publish the app, then re-consent once). The token in `KARTA\ds3` dates from 2026-10-13 (Testing mode) and has therefore already expired.
