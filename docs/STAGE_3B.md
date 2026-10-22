# Stage 3B — two-admin Telegram support tickets

Base: `fix/taxi-stage3a`. Taxi, payment and restaurant logic is untouched.

## Implemented features
- **Customer** (`/support`): pick one of your last 10 orders, write 5–1000 characters. `/mytickets` lists your own tickets. `/cancel` aborts a draft.
- **Ownership**: the order is looked up with `id` AND `customer.telegramUserId = <sender>`; a foreign and a non-existent order give the same "not found". The order button is re-validated on press, so forged callback data is useless.
- **One unresolved ticket per order** (partial unique index): double-submits create one ticket.
- **Two admins** (env IDs), equal rights. Both receive every new ticket with `🙋 Men oldim`. `/tickets` lists active tickets.
- **Atomic claim**: `UPDATE ... WHERE id = ? AND status = 'OPEN'`. The row lock serializes concurrent claims; the loser updates 0 rows and is told who owns the ticket. Both admins' messages are edited to show the owner.
- **Workflow**: `OPEN → IN_PROGRESS → RESOLVED`. Only the claiming admin can resolve (`✅ Hal qilindi` is shown only on their message and re-checked in SQL).
- **Customer notice** when resolved, sent by a small DB-backed worker (retried each cycle until delivered).
- **Duplicate callbacks**: each Telegram `callback_query.id` is stored in `SupportCallbackLog` in the same transaction as the action (`ON CONFLICT DO NOTHING`); a repeat is ignored silently.
- **Authorization on every operation**: service functions call the admin check first (before touching the DB); the bot also answers non-admins with an alert. Customer reads are always scoped by Telegram ID.
- **Audit log** (`SupportTicketEvent`): CREATED, CLAIMED, CLAIM_REJECTED, RESOLVED, RESOLVE_REJECTED with actor, from/to status.

## Environment variables
| Variable | Notes |
|---|---|
| `SUPPORT_ADMIN_1_TELEGRAM_ID` | numeric Telegram user id |
| `SUPPORT_ADMIN_2_TELEGRAM_ID` | numeric; may be omitted (single admin) |
| `SUPPORT_WORKER_INTERVAL_SECONDS` | optional, default 5 (1–300) |

Each admin must send `/start` to the bot once, or Telegram refuses to deliver to them. With no admin configured `/support` replies "unavailable" and creates nothing. Existing `BOT_ENABLED`/`BOT_TOKEN` are required.

## Database changes
Migration `prisma/migrations/20261017000100_support_tickets` (additive; not executed by me):
- enum `SupportTicketStatus`; tables `SupportTicket`, `SupportTicketNotification`, `SupportTicketEvent`, `SupportCallbackLog`.
- Partial unique index `SupportTicket_one_active_per_order`.
- CHECK `SupportTicket_owner_matches_status`: OPEN ⇔ no assigned admin.
- Back-relations added to `Order` and `Customer` in `schema.prisma` (no column changes to them).

## Local test commands
Use your existing `.env`/DB; nothing seeds or resets data. The DB test creates uniquely-named records and deletes them afterwards.
```sh
npm run db:generate
npm run db:migrate          # applies the new migration
npm run typecheck
npm run test:support        # pure: admin parsing/authorization
npm run test:support:db     # concurrent claims, unauthorized, duplicate callbacks, ownership, workflow
npm run dev                 # manual: /support as customer, tap buttons as both admins
```
Manual check: customer `/support` → order → text; both admins get the ticket; admin 1 taps "Men oldim" — admin 2's message changes to "Ishlayapti: <name>" and has no resolve button; admin 1 resolves; customer gets the notice.

## Known limitations
- Not run/compiled by me (no install/build/test allowed) — expect to fix possible typecheck nits.
- Customer draft state (`/support` waiting for text) is in memory: lost on restart, expires after 10 min.
- Run a single polling worker. Notifications are at-least-once; admin sends use a unique row to avoid repeats, but two workers could still double-send.
- Customer notice marker is set before sending and reset on failure; a crash in between loses that one notice.
- Admin notifications cannot reach an admin who never started the bot; the worker retries every cycle without backoff/dead-letter.
- No reassign/unclaim, reopen, admin reply to the customer, or customer cancellation; a ticket claimed by an unavailable admin stays blocked (needs manual DB fix).
- `SupportCallbackLog` grows indefinitely (no pruning job).
- Admin IDs come from `process.env` (loaded at start); change them and restart. Malformed IDs make admin operations throw rather than silently disabling checks.
