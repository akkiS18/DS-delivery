---
name: ds-backend-safety
description: Safety checklist for DS Delivery backend changes touching payments (PaymentEngineV3, Gmail/UZCARD matching, Card/Payment/IncomingTransaction), order status transitions, taxi dispatch, support tickets, Prisma schema/migrations, or concurrency. Use before editing src/modules/{payment,orders,restaurant,taxi,support}, src/bot handlers that change state, or prisma/. Skip for UI, docs-only, Android, or unrelated tasks.
---

# DS backend safety

Complements AGENTS.md (do not repeat it). Read the module you change and its callers first.

## Invariants that must survive any change
1. **Keep existing logic.** Extend with additive guards; do not rename statuses, reorder transitions or rewrite `PaymentEngineV3`. If two requirements conflict, keep the data and report the conflict.
2. **Authorize and scope every read/write.** Check the actor in the service layer (not only the bot): staff via `restaurant.staffTelegramUserId`, taxi operator via company, support admins via env IDs, customers via `customer.telegramUserId` in the same query. Unknown and foreign ids must look identical ("not found").
3. **Idempotent money paths.** Dedupe on a stable key (`IncomingTransaction.sourceId`, Telegram `callback_query.id`, `checkoutKey`, `(sender, message_id)`). A retry or double delivery must return the first result and change nothing.
4. **Transaction + guard, never read-then-write.** Use `updateMany({ where: { id, status: <expected> } })` and check `count`, or `SELECT … FOR UPDATE`. Payment scheduling/matching runs under `PaymentEngineV3.locked` (advisory lock). Keep external calls (Telegram, Gmail) outside DB transactions.
5. **Gmail is a signal, never proof.** Mail may only produce `MATCHED_UNVERIFIED`. `CONFIRMED_MANUAL` / `PAYMENT_CONFIRMED` come only from `takeStaffAction(VERIFY_PAYMENT)` by the restaurant's staff actor. Ambiguous, partial, excess, late, duplicate or expired-window money → `REVIEW_REQUIRED`, never guessed. Never enable real payments or add auto-confirmation.
6. **Audit, don't overwrite.** Record actor, from→to status and reason (`OrderEvent`, `PaymentEvent`, `SupportTicketEvent`, `IncomingTransaction` rows). Never delete or reuse payment attempts or incoming events; expire/flag instead.
7. **One allocation per resource.** One AWAITING payment per (card, amount) (partial unique index + cooldown); one incoming transaction ↔ one payment (unique both ways). Add a DB constraint for any new "at most one" rule, not just app code.
8. **One active taxi dispatch per order.** Rely on `TaxiDispatch_only_one_active_per_order` and `(orderId, attemptNo)`. Dispatch only when the order's payment is `CONFIRMED_MANUAL`; taxi acceptance is not delivery — never claim delivery from dispatch alone. Claim work with a status CAS/lease before sending.
9. **Migrations: additive, no data loss.** Write a new migration folder; never edit applied ones, reset, seed or `--force`. Prefer new nullable columns/tables; use `NOT VALID` checks for legacy rows; no DROP/RENAME/type change without an expand→backfill→contract plan. State what fails if legacy data violates a new unique index. Write the SQL but do not run it unless asked. Keep file encoding UTF-8 and existing line endings (`prisma/schema.prisma` is CRLF).
10. **Targeted tests for the invariant**, not the happy path: concurrency (`Promise.all` of the same action), duplicate delivery, unauthorized actor, wrong state, and the DB constraint itself. DB tests must use unique names/ids and delete only their own rows, never reset or seed.
11. **Check callers.** Grep every use of a changed function, status string and Prisma field (`src/bot/*`, `src/tools/*`, workers, tests, smoke scripts). Keep exported signatures, status names and env vars backward compatible; make new options optional.
12. **Report honestly.** Say which checks were NOT run (install, typecheck, tests, migrations are off-limits unless asked); list the commands for the user. Never write "tested", "verified" or "production-ready" for code that was not executed.

## Before finishing
- List changed files, new migration(s), risks, and remaining gaps (docs/ROADMAP.html is guidance, not a completion claim).
- Confirm no secrets, `.env`, dumps or build output were added.
