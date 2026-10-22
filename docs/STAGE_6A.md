# Stage 6A — Cancellation and manual refund workflow

Business frame (unchanged): customers pay the **restaurant's** card directly; DS Delivery holds no funds, executes **no** bank refunds and never marks money as refunded from a button or screenshot. It records requests, decisions and attestations and monitors their status. Nothing here was compiled, run or migrated; **not production-ready**.

## Cancellation paths (by order state)
| Order state | Who | Path |
|---|---|---|
| `WAITING_RESTAURANT`, `WAITING_CUSTOMER_CONSENT` | customer | Stage 4B `cancelWaitingOrder` (unchanged, no payment exists) |
| `PAYMENT_PENDING` (payment `QUEUED`/`AWAITING`) | customer | **Unpaid cancellation** — `cancelUnpaidOrder` |
| `PAYMENT_MATCHED_UNVERIFIED`, `PAYMENT_CONFIRMED`, `PREPARING` | customer | **Refund request** — `requestCancellation(CUSTOMER)`; restaurant decides |
| `PAYMENT_CONFIRMED`, `PREPARING`, `READY` | restaurant staff | **Restaurant cancellation** — `requestCancellation(RESTAURANT_STAFF)`; refund created already `APPROVED` |
| `READY`, taxi states, `COMPLETED`, `CANCELLED`, expired/rejected… | customer | refused (`NOT_ALLOWED`); use `/support` |
Pure rules: `src/modules/refunds/workflow.ts` (`cancellationPlan`, `paymentAllowsRefund`, `canRefundTransition`).

### Unpaid cancellation (no money recognised)
Runs under the **payment advisory lock** (`engine.runLocked`), so it is serialized with Gmail matching and scheduling. Either the match wins (order is then a paid order → `USE_REFUND_REQUEST`) or the open attempt is cancelled first: order `PAYMENT_PENDING → CANCELLED` (`cancelReason CUSTOMER_UNPAID`), payment `QUEUED/AWAITING → CANCELLED` (row kept, `PaymentEvent CANCELLED`), card/amount **cooldown** set (like an expiry). A transfer the customer already made is *not* matched later: Stage 4A now classifies it as `LATE_FOR_EXPIRED_PAYMENT` (`REVIEW_REQUIRED`) because `CANCELLED` joins `EXPIRED` in that check. The customer is told to contact support if they already paid.

### Paid-order refund request
`RefundRequest` (amount `paidAmountTiyin`, reason code + optional note ≤300, requester id/type, timestamps, `orderStatusBefore`, `paymentStatusAtRequest`) and append-only `RefundEvent`. Customer request → order `CANCELLATION_REQUESTED` (frozen: verify / start-cooking / ready all fail their status compare-and-set). Restaurant then:
- **Approve** (amount defaults to the full payment; service accepts a smaller positive amount, never more): refund `REQUESTED → APPROVED`, order `→ CANCELLED`, still-`SCHEDULED` taxi dispatches `→ CANCELLED` (new terminal enum value), all in one transaction. A dispatch already sent/accepted is **not** touched; `taxiActiveAtDecision = true` flags it for manual follow-up.
- **Reject** (fixed reason code): refund `REJECTED`, order restored to exactly `orderStatusBefore`. A later new request is allowed.

### Refund lifecycle (`RefundRequest.status`)
`REQUESTED → APPROVED | REJECTED`; `APPROVED → SENT` (restaurant, **typed bank reference required**); `SENT → CONFIRMED` (customer says received, or a DS admin with a typed note ≥ 10 chars) `| DISPUTED` (customer says not received); `DISPUTED → SENT` (restaurant, **new** reference) `| CONFIRMED`. `REJECTED`/`CONFIRMED` are terminal.
- **`SENT` is only the restaurant's claim.** The restaurant has no path to `CONFIRMED` (enforced in code, in the transition table test, and by DB CHECKs: `SENT/CONFIRMED` need a ≥4-char `bankReference`, `sentBy`, `sentAt`; `CONFIRMED` needs `confirmedBy/At` and `confirmedByType ∈ {CUSTOMER, ADMIN}`; an `ADMIN` confirmation needs a ≥10-char note).
- References like “ok”, “done”, digit-less or single-repeated-character strings are rejected. A button press alone changes nothing past `APPROVED`.
- **What CONFIRMED means:** two parties attested (restaurant: sent + reference; customer or admin: received). It is **not** bank verification — the platform has no bank access. The admin path exists for customers who never answer and is audited with the note.

## Duplicate & concurrency protection
- One open request per order and one open-or-completed request per payment: partial unique indexes (`RefundRequest_one_open_per_order`, `RefundRequest_one_per_payment`) plus a pre-check; 6 parallel identical requests → 1 created, 5 `ALREADY_REQUESTED`.
- Every state change is `UPDATE … WHERE status = <expected>` (loser gets `STALE`, and a `*_REJECTED` audit event). Order/refund changes lock the order row (`FOR UPDATE`); cancel-vs-start-cooking and approve-vs-reject have exactly one winner.
- Callbacks are idempotent through those compare-and-set updates (no separate callback log needed).
- **Taxi:** the dispatch worker claims `SCHEDULED → SENDING` by CAS; cancellation cancels `SCHEDULED` by CAS in the same transaction. If the worker wins, the dispatch is "active" and only flagged. While a customer request is pending (`CANCELLATION_REQUESTED`), the existing worker treats the order as invalid and moves a *due* dispatch to `NEEDS_HELP` (admin alert) instead of sending — safe (no taxi is sent for a frozen order) but noisy; if the request is then rejected, that dispatch needs manual handling via the existing taxi flow. Taxi code itself was not changed.

## Notifications (Telegram, DB-driven, at-least-once; `deliverRefundNotices` runs in the existing 7 s restaurant notifier)
- Staff: request with ✅/🚫 buttons (also `/refunds`); after approval a “💸 Qaytarildi — raqamni kiritish” button arms a typed reference.
- Customer: decision notice; “sent” notice with ✅ received / ❌ not received.
- Admins (support admin ids, read-only reuse of `isSupportAdmin`): FYI on every request, and on `DISPUTED` with a “confirm with note” button (typed note).
- Per-item in-memory backoff; markers (`staffNotifiedAt`, …) are set after a successful send, so a crash can duplicate a notice but not lose it.
- Customer UI: `❌ Bekor qilish` on the order (`PAYMENT_PENDING`…`PREPARING`) → unpaid confirm or reason menu; order view shows `CANCELLATION_REQUESTED`/`CANCELLED` and the refund number/status. Staff card gets `❌ Bekor qilish / qaytarish` for confirmed/preparing/ready orders.

## History
Payments, orders, items and incoming transactions are never deleted or rewritten: cancelled payments stay with status `CANCELLED`; `RefundRequest` FKs to order and payment are `ON DELETE RESTRICT`; money amounts are snapshotted on the request.

## Database (`prisma/migrations/20261023000100_cancellation_refunds`, not executed)
Enum `TaxiDispatchStatus` + `CANCELLED`; tables `RefundRequest` (CHECKs above, partial unique indexes) and `RefundEvent`. No existing row changes. Payment `status` is a free string, so `CANCELLED` needs no migration. Apply after the pending Stage 3–5B migrations.

## Tests (none run by me)
```sh
npm run db:generate
npm run db:migrate
npm run typecheck
npm run test:refunds        # pure: full transition matrix, cancellation plan, reference/note/amount validation
npm run test:refunds:db     # unpaid cancel + cooldown + late mail review, cancel-vs-match race, duplicate requests, frozen order,
                            # invalid transitions, auth, approve/reject races, taxi handling, sent/confirm/dispute/admin, DB CHECKs, history
npm run test:payment:safety && npm run test:acceptance2:db && npm run test:db && npm run test:restaurant   # regression
```
DB tests use their own restaurants/cards (isTest) and delete only their rows (refunds first).

## Unresolved policy decisions (not invented here)
1. **When is a refund owed?** Whether a customer is entitled to cancel/refund after cooking started or the taxi was sent, and any fee/partial amount. The platform only records; the restaurant approves/rejects. Partial approval exists in the service but not in the Telegram UI.
2. **Deadlines/SLAs:** how fast a restaurant must decide, send, and how long a customer has to confirm. None enforced; no escalation timers.
3. **Customer silence after `SENT`:** currently stays `SENT` forever unless an admin confirms with a note; no auto-confirm (deliberately).
4. **Restaurant that never answers a request:** no auto-reject/escalation; the order stays frozen (`CANCELLATION_REQUESTED`).
5. **Who pays for an already-dispatched taxi** and how its cancellation is coordinated.
6. **Disputes** beyond re-sending with a new reference or an admin attestation (e.g. chargebacks, restaurant insolvency) have no workflow.
7. Whether **restaurant-initiated cancellation of an unverified payment** should be possible (currently not: verify or let the customer request).

## Limitations
- No bank integration: all refund facts are human assertions; bank references are not validated against any statement.
- Android/APK has no refund endpoints yet (Telegram only); the service layer is reusable for them behind the Stage 5A session guard.
- Admin confirmation uses Telegram support-admin ids and a typed note; it is only as strong as that admin's checking.
- In-memory armed inputs (reference/note) are lost on restart (tap the button again).
- Not compiled or executed; expect typecheck nits after `db:generate`.
