# Stage 3C — two-way support conversation, reassign, reopen

Builds on Stage 3B (`feat/claude-stage3b`). Stage 3A/3B logic, payment, taxi, Restaurant APK and Gemini files are untouched; 3B code received only additive edits (see "Changes to 3B files").

## Implemented
| # | Requirement | How |
|---|---|---|
| 1 | Assigned admin replies via the bot | `💬 Javob yozish` button (shown only on the owner's card / on forwarded customer messages) arms the admin for 10 min; each text they type is stored and sent to the customer. Stays armed for further replies until `/cancel` or timeout. `addAdminReply` re-checks in SQL: admin, `IN_PROGRESS`, and `assignedAdminTelegramId = actor`. |
| 2 | Customer adds messages | `/mytickets` shows `✍️ #N ga yozish` for the customer's own unresolved tickets (`sup:cw:`), then one message is taken (one-shot). Free text is never treated as a follow-up unless the customer armed it, so checkout text is unaffected. Foreign/unknown ticket ids are indistinguishable (`NOT_FOUND`). Resolved tickets refuse messages. |
| 3 | Stored in PostgreSQL | New table `SupportTicketMessage`: ticket, `senderType` (CUSTOMER/ADMIN, CHECK), `senderTelegramId`, `senderName`, `telegramMessageId`, `text` (CHECK 1–1000), `createdAt`, delivery state. Every message also writes a `SupportTicketEvent` (`CUSTOMER_MESSAGE` / `ADMIN_REPLY`) in the same transaction. |
| 4 | Atomic reassign | `reassignTicket`: one transaction = callback-log insert + `SELECT … FOR UPDATE` on the ticket + compare-and-set `UPDATE … WHERE status='IN_PROGRESS' AND assignedAdminTelegramId = <locked owner>`. Audit `REASSIGNED {from,to}`; rejects are logged as `REASSIGN_REJECTED`. |
| 5 | Reopen | `reopenTicket`: `RESOLVED → OPEN`, owner/`resolvedAt`/`claimedAt`/`customerNotifiedAt` cleared (so the customer gets a fresh notice after the next resolve; the DB CHECK "OPEN ⇔ no owner" holds). Either admin can then claim it. Refused (`ALREADY_ACTIVE`) if the order already has another unresolved ticket — checked, and the partial unique index is the backstop. |
| 6 | Unauthorized / duplicate callbacks | Admin check first in every service function and again in the bot (alert for non-admins). Reassign/reopen record `callback_query.id` in `SupportCallbackLog` inside the action transaction; repeats return `DUPLICATE` and are silent. Messages dedupe on unique `(senderTelegramId, telegramMessageId)`, so a redelivered Telegram update is stored once. |
| 7 | Retry handling | See below. |
| 8 | Tests | See below. |

### Reassign policy (decision for review)
Admins are equals, but a ticket must not be stolen by accident: the **owner** can hand it to the other admin; a **non-owner** admin can only take it **for themselves** (`🔁 Menga o‘tkazish`) — this also unblocks tickets owned by an unavailable admin (the 3B limitation). `actor ≠ owner and actor ≠ target` is refused (`NOT_ALLOWED`; unreachable with exactly two admins, relevant if more are added). The new owner receives a short ping, and both admins' cards are edited. The previous owner immediately loses reply/resolve rights (checked in SQL against the current owner).

### Message routing
- Admin → customer: delivered to the customer's Telegram id, with `✍️ Javob yozish` while the ticket is unresolved.
- Customer → admin: delivered to the current owner if `IN_PROGRESS` (owner is resolved at *delivery* time, so a reassign between send and delivery goes to the new owner); to **both** admins if still `OPEN`.

## Notification retry handling
- **Messages** (DB-backed outbox, `deliverSupportMessages`, run by the existing 3B worker and after each action): a message is *leased* (`nextAttemptAt = now + 60 s`) with a conditional UPDATE before sending, so overlapping runs cannot both send it. Success → `deliveredAt`. Failure → `deliveryAttempts+1`, exponential backoff 5 s, 10 s, 20 s … capped at 1 h, `lastError` kept (message text only, no tokens). After 8 attempts, or immediately on Telegram 403/400 (bot blocked / chat not found) → `failedAt` (dead letter, never retried; query `WHERE "failedAt" IS NOT NULL`). A dead-lettered admin reply warns the writing admin.
- **3B sends** (new admin cards, "resolved" customer notice): previously retried every cycle forever; now an in-memory per-item backoff (same curve) skips them until due. Added without changing their logic.

## Changes to 3B files (additive)
- `service.ts`: `firstDelivery` and `requireAdmin` are now `export`ed (no behaviour change).
- `support-notify.ts`: new buttons in `renderAdminTicket`, backoff in the two loops, `deliverSupportMessages` appended to `deliverSupportNotifications`.
- `support.ts`: pending-state map became a tagged union (`new` / `followup` / `admin-reply`), `/mytickets` gains buttons, three new `bot.action` handlers.
- `schema.prisma`: `SupportTicketMessage` + back-relation. Migration `20261017000200_support_messages` (additive; **not executed**).

## Test commands (run locally; none were run by me)
```sh
npm run db:generate
npm run db:migrate            # applies 20261017000200_support_messages
npm run typecheck
npm run test:support          # pure: admin parsing, retry curve, text validation
npm run test:support:db       # 3B regression (claim/resolve/duplicates)
npm run test:support:conv     # 3C: messages, dedupe, reply auth, reassign/reopen races, delivery + backoff + dead letter (fake bot)
```
The DB tests create uniquely named rows and delete them afterwards (cascade). The delivery tests pass a ticket-id filter and a fake bot, so they never send real Telegram messages or touch real rows.

Manual check: customer `/support` → admin A claims → A taps `💬 Javob yozish`, types → customer receives it → customer `/mytickets` → `✍️` → types → A receives it → A taps `🔁 Boshqa adminga o‘tkazish` → B's card shows B as owner → B resolves → `♻️ Qayta ochish` returns it to OPEN.

## Remaining crash-recovery limitations
- **Send is at-least-once.** A crash after Telegram accepted a message but before `deliveredAt` is written re-sends it once the 60 s lease expires (duplicate, never loss). A hung `sendMessage` longer than the lease can also overlap with its retry.
- **Multi-admin fan-out** (customer message while `OPEN`): delivered once *any* admin got it; if the other admin's send failed it is not retried (their card still exists, and the owner sees the thread from then on).
- **The 3B resolved-notice** still sets its marker *before* sending; a crash between marker and send loses that one notice (unchanged, documented in 3B). Reopen clears the marker, which may re-send a notice for a ticket that had one already.
- **3B backoff state is in memory**: after restart items retry immediately once, then back off again. Admin cards for an admin who never pressed `/start` keep retrying (hourly at the cap) forever.
- **Pending input state** (armed reply/follow-up/new ticket) is in memory: lost on restart; the user just taps the button again. Text typed after a restart while unarmed is not stored; it falls through to the normal bot flow.
- **Edited admin cards are best effort** (`refreshAdminMessages`): if an edit fails, the card is stale until the next action; the DB, not the card, is authoritative and every action re-checks it.
- A customer is not notified on reopen/reassign; follow-ups on a resolved ticket require an admin to reopen it first (customers cannot reopen).
- `SupportCallbackLog` and delivered `SupportTicketMessage` rows are never pruned. Run one polling process.
- `ADMIN_*` name for a reassign target is read via `getChat` (works only if that admin has started the bot); otherwise it is stored as `Admin <id>` until they next claim/take over.
- Not compiled or executed in this environment — expect to fix possible typecheck nits after `db:generate`.
