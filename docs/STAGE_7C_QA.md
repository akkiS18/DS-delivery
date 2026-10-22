# Stage 7C-QA — Full system automated testing

Run date 2026-10-20, Windows 11, Node 24.15, PostgreSQL database `ds_delivery_test` only (each DB test asserts `current_database()` first).
Nothing was deployed, committed, reset or truncated. The running dev server (port 4000) was **not stopped** and no second Telegram poller was started. No bot token, real payment, real taxi request or real Telegram message was used: bot token in tests is a fixture string used only to sign `initData`.

Legend: **PASS** executed and passed · **FAIL** executed and failed · **NOT RUN** could not or was not run · **NOT VERIFIED** outside what automation can show.

## 1. Existing test coverage audit

Before this stage: 89 unit tests, 17 DB suites (≈ 190 cases) and 40 Mini App vitest cases.

| Area | Already covered by | Gap found |
|---|---|---|
| Payment safety (Gmail = signal, duplicate mail, partial/excess/late, one match per attempt, DB invariants, commission rules, refunds) | payment.safety, acceptance*, finance, refunds | none material |
| Taxi dispatch (fallback, silence, allowlist, admin attestation, uncertain send, one active dispatch, 409 polling) | taxi.stage6d, taxi.recovery, telegram.integration | repeated/parallel operator callbacks end-to-end |
| Authorization | restaurant-auth/catalog/operations/orders, miniapp, support | spoofed proxy headers; malformed bodies |
| Checkout | checkout.stage6f, miniapp (6 taps, one customer) | **many customers at once (20/50)**, restart replay, product/price/pause flips during a burst, brand-new-user first-contact race |
| Mini App UI | jsdom layout/viewport unit tests (cannot measure layout) | no real-browser test at all |
| Process level | smoke-prod, config/health/shutdown unit tests | unreachable DB at start, secret leakage in logs |

## 2. New test cases

| File | Cases |
|---|---|
| `src/tests/qa.system.db.test.ts` (`npm run test:qa:db`) | 18 |
| `src/tests/miniapp.ui.cdp.test.ts` (`npm run test:qa:ui`) | 4 widths × 9 steps + parents + 1 control |
| `src/tests/reliability.proc.test.ts` (`npm run test:qa:process`) | 3 |

`qa.system.db`: 20 and 50 concurrent customers; 30 customers on the same amount; 12 simultaneous taps of one new customer; restart replay with a fresh app instance; product turning unavailable / price changing / restaurant pausing mid-burst; 8 concurrent readers of one order; pay-vs-cancel race; five parallel "delivered" callbacks (one completion, no MOCK commission); cancelled order cannot be delivered, stranger operator refused; unpaid/not-ready/not-sent cannot complete; two parallel operator accepts and late "sent"; spoofed `X-Forwarded-For` / `X-Real-IP`; 11 malformed-body shapes incl. 413; internal API key variants; cross-customer isolation under load; two direct regression tests for defect D1.

`miniapp.ui.cdp` (headless Chromium over the DevTools protocol, no Playwright dependency; real backend in-process; `Telegram.WebApp` stub with initData signed by a fixture token; Telegram's SDK blocked) at **320, 375, 390, 430 px**: home loads and no horizontal overflow; search filters and focus keeps tab bar; last menu item not under the tab bar; cart add; cart survives reload; Telegram Back button shown/returns home/hidden on tabs; checkout inputs clear of the tab bar and submit reachable; active order above history with correct labels (list and detail); visible error state with Retry that recovers; "open from Telegram" notice without initData. Plus a **negative control** proving the overlap check fails when the reserved space is removed.

`reliability.proc`: compiled server with an unreachable database exits 1 promptly, never listens, never prints the DB password; unsafe production config refused before any connection with variable names only; REAL payments refused (test DB, no Gmail, no card map).

## 3. Tests passed

| Check | Result |
|---|---|
| Backend `tsc --noEmit` | PASS |
| Production build `npm run build` | PASS |
| Backend unit tests | PASS 89/89 |
| Production smoke (`scripts/smoke-prod.mjs`, compiled, port 4010) | PASS 8/8 (SIGTERM step NOT RUN on Windows) |
| 17 existing DB suites | PASS (all, counts unchanged) |
| `qa.system.db` | PASS 18/18 (3 consecutive runs) |
| `miniapp.ui.cdp` + `reliability.proc` | PASS 44/44, 0 skipped (2 runs) |
| Mini App `vitest` / `tsc` / `vite build` | PASS 40/40, PASS, PASS |

## 4. Tests failed

None in the final state. During development: 6 failures, of which 5 were mistakes in the new tests (field/model names, per-IP budget shared by `inject`, shared browser `localStorage`, `scrollIntoView` parking elements under a fixed bar) and **1 was a real defect (D1)**.

## 5. Tests skipped / NOT RUN

| Item | Status | Reason |
|---|---|---|
| Docker (`compose config`, image build, container start/stop) | **NOT RUN** | `docker` is not installed on this machine |
| SIGTERM graceful exit of the compiled process | **NOT RUN** | Windows cannot deliver SIGTERM to a child; ordering/timeouts covered by `shutdown.test.ts` (PASS) |
| Duplicate Telegram polling against a live token | **NOT RUN** | forbidden here; the 409-after-onLaunch path is covered with a fake Telegram (`telegram.integration`, PASS) |
| Restaurant *closing hours* crossing during a burst | **NOT RUN** | hours logic has unit coverage; a paused-restaurant burst was run instead |
| Server crash mid-transaction (kill -9 during checkout) | **NOT RUN** | replay after restart is tested; true mid-transaction kill needs a dedicated harness |
| Playwright | **NOT RUN** | not a dependency (no install allowed); an equivalent CDP driver was used |
| `npm run build:prod` (`prisma generate`) | **NOT RUN** | blocked on Windows by the running dev server holding the engine DLL (EPERM); `build` itself PASS |

## 6. Defects discovered

**D1 (fixed). New Telegram user's simultaneous first requests are answered `409 Record already exists`.**
`ensureCustomer()` used `prisma.customer.upsert`, which is not atomic. When the Mini App fires several calls on a customer's first open (or the user double-taps checkout), the losers hit the unique `telegramUserId`, and the global handler turned P2002 into a 409 — although the winner created the order. Reproduced first as a failing test (12 taps → 8 × 409).

Not defects (verified): same-`checkoutKey` unique violations inside `placeOrder` are already replayed by the service; MOCK/REAL separation, cancelled-never-delivered, single completion and zero MOCK commission all held.

## 7. Defects fixed

D1: `src/modules/miniapp/profile.ts` — `ensureCustomer` catches P2002 and reads the existing row (smallest safe fix; no business rule changed). Regression tests: direct (15 parallel calls — **fails without the fix, verified**) and end-to-end (12 taps — race-dependent, may pass by chance without the fix). Related suites re-run: miniapp, checkout.stage6f, all others PASS.

## 8. Performance measurements (measured on this laptop, in-process, `app.inject`, one local PostgreSQL; not a production benchmark)

| Scenario | Result |
|---|---|
| 20 distinct customers checkout at once | all 201; ≈ 0.77–1.3 s wall time (3 runs) |
| 50 distinct customers checkout at once | all 201; ≈ 1.0 s wall time (4 runs, 0.97–1.08 s) |
| 30 customers, identical amount | all 201, no duplicate (card, amount) attempt |

Throughput appears serialized by the payment advisory lock (50 orders ≈ 20 ms each). Network, TLS, Telegram and real hardware are not included. Do not extrapolate to production.

## 9. Security findings

- PASS: forged/expired/foreign-token initData identical 401 (existing), another customer's order/cancel → 404 for 20 users under load, spoofed `X-Forwarded-For`/`X-Real-IP` cannot reset the throttle with `TRUST_PROXY` off, malformed JSON/arrays/null/negative or fractional quantity → 400, oversize → 413, no stack traces, internal API 401 for missing/wrong/oversized key.
- PASS: unauthorised operator cannot respond or confirm delivery; cancelled orders cannot complete.
- Limitation: rate limiter is in-memory (single instance); per-IP limits are correct only with the right `TRUST_PROXY` hop count (behind Vercel rewrite + proxy verify it).
- Limitation: with `TRUST_PROXY` on, the first hop's `X-Forwarded-For` is trusted by design.
- NOT VERIFIED: restaurant/Android token storage on device, Telegram-side abuse controls.

## 10. Docker / build results

Docker **NOT RUN** (not installed). Dockerfile/compose were reviewed in Stage 7C-A only. TypeScript production build PASS; compiled-process tests PASS. `docker compose config` and an image build are the first things to do on the server.

## 11. Remaining production blockers

1. Docker image, compose stack and container shutdown never executed.
2. Real Telegram: Mini App in iOS/Android/Desktop clients, software keyboard, safe-area insets, native WebView, haptics — **NOT VERIFIED**.
3. Android restaurant app against the deployed API — NOT RUN today.
4. In-memory rate limiter → one instance only; no DB-level leader lock (Telegram 409 is the guard).
5. REAL payments: not enabled; payee requisites, restaurant verification workflow and bank rules need owner approval and a supervised trial.
6. Permanent HTTPS API host not chosen; `vercel.json` still points at the temporary tunnel (untouched).
7. Backups/restore of PostgreSQL not rehearsed.
8. A crash exactly mid-transaction was not simulated.

Automated tests passing is **not** a statement that the system is production-ready.

## 12. Prioritised manual E2E checklist

1. (P0) Real Telegram, test bot: open Mini App on a phone; browse, search with the keyboard open, confirm tab bar/inputs usable; place a MOCK order; double-tap "To‘lovga o‘tish".
2. (P0) Kill the app mid-checkout and reopen: order appears once.
3. (P0) Android restaurant app: log in, see the order, accept/verify, price edit while paused, READY once.
4. (P0) Taxi bot with a **test** operator: accept → sent → delivered once; "no driver" fallback; silence → admin alert.
5. (P1) Cancel unpaid and paid orders; refund wording; late payment after cancellation.
6. (P1) Two phones, one account: states agree.
7. (P1) Docker on the server: `compose config`, build, migrate, `docker stop` exits within the grace period, second container exits on 409.
8. (P1) Restart the backend while orders are PREPARING / taxi REQUESTED: nothing duplicated, customer notified once.
9. (P2) Slow/lost network on the phone: error state and retry.
10. (P2) Backup + restore drill.

## Files created or changed

New: `src/tests/qa.system.db.test.ts`, `src/tests/miniapp.ui.cdp.test.ts`, `src/tests/reliability.proc.test.ts`, `docs/STAGE_7C_QA.md`. Changed: `src/modules/miniapp/profile.ts` (D1 fix), `package.json` (3 test scripts). `apps/customer-miniapp/dist` was rebuilt locally (build output, not committed, Vercel untouched).
Backups: `C:\Users\Acer\Documents\DS-backups\DS-7CQA-before-20261020-130235.zip` and the after-archive named in the final message.
