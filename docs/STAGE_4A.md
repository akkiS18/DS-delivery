# Stage 4A — UZCARD payment matching safety

PaymentService V3 (queue, card assignment, cooldowns, advisory lock, partial unique index, status names and transitions) is unchanged. Changes are additive guards, an audit table and tests. Support, taxi, Android and payment-provider code are untouched.

## Principle
A Gmail UZCARD notification is a **matching signal**. The only automatic result it can produce is `Payment.MATCHED_UNVERIFIED` / `Order.PAYMENT_MATCHED_UNVERIFIED`. `CONFIRMED_MANUAL` / `PAYMENT_CONFIRMED` is written only by `takeStaffAction(VERIFY_PAYMENT)` for the restaurant's own staff Telegram user (`restaurant.staffTelegramUserId`), who checks the real bank statement. No code path in `engine.ts` or `gmail.ts` writes those statuses.

## Safeguards (where, what happens)
| Case | Behaviour |
|---|---|
| Same Gmail message twice | `IncomingTransaction.sourceId` unique + advisory lock → `DUPLICATE`, nothing re-processed (parallel and later). |
| Same bank event under a different Gmail id (forward/resend) | New `fingerprint` = sha256(card, amount, minute). A second event with the same fingerprint is stored and goes to `REVIEW_REQUIRED` / `POSSIBLE_DUPLICATE_NOTIFICATION`; it can never match again. (Two genuinely separate payments of equal amount to one card in the same minute are indistinguishable and are also reviewed — safe side.) GMAIL only. |
| Delayed notification | Mail received more than `maxNotificationDelayMs` (default 30 min, optional `Options` field) after the operation → `DELAYED_NOTIFICATION`. Existing window / "earlier payment could own it" checks remain. |
| Expired attempts | Expired attempt is never revived. Money in the old window → `LATE_FOR_EXPIRED_PAYMENT` with the attempt number; attempt stays `EXPIRED`, order stays `PAYMENT_EXPIRED`, candidate gets an `INCOMING_FLAGGED` event. |
| Equal amounts, different orders | Unchanged V3 rule: per (restaurant, amount) one AWAITING attempt per card; the rest queue. Added: ingest now checks card/payment `restaurantId` and `isTest` agree (`CARD_PAYMENT_SCOPE_MISMATCH`). |
| Ambiguous card+amount | If more than one AWAITING attempt ever shows up (the DB index makes it impossible) → `MULTIPLE_ACTIVE_PAYMENTS`, no `findFirst` guess. Existing `PRIOR_SAME_CARD_AND_AMOUNT` kept. |
| Reused amount | Second mail for an attempt already `MATCHED_UNVERIFIED`/`CONFIRMED_MANUAL` → `ALREADY_MATCHED_PAYMENT` (also covers customer paying twice). Cooldowns unchanged. |
| Partial / excess | Only exact amounts match. On the same card inside an open window: `AMOUNT_BELOW_EXPECTED` / `AMOUNT_ABOVE_EXPECTED` (or `AMOUNT_MISMATCH_MULTIPLE_CANDIDATES`); amounts and candidates stored in `reviewDetails`. No aggregation of partial payments. |
| One transaction → one payment | Match uses compare-and-set (`UPDATE … WHERE status='AWAITING'`, `PAYMENT_STATE_CHANGED` otherwise). `Payment.matchedTransactionId` was already unique; new unique `IncomingTransaction.matchedPaymentId` closes the other direction. |
| History / audit | No payment row is deleted or overwritten by new logic. New append-only `PaymentEvent`: `CREATED`, `ASSIGNED`, `EXPIRED`, `QUEUE_EXPIRED`, `MATCHED_UNVERIFIED` (with `signalOnly`), `INCOMING_FLAGGED` (with reason), `CONFIRMED_MANUAL` (actor type/id). Every incoming event (matched or not) stays in `IncomingTransaction`. |
| Confirmation | Staff-only (unchanged). Additionally refused (`TOLOV_SUMMASI_MOS_EMAS` / `TOLOV_MOS_EMAS`) unless payment amount = order total and, for real (non-test) payments, the linked incoming transaction is `MATCHED_UNVERIFIED`, from a trusted sender, links back to this payment, with the same amount. Transaction rolls back on refusal. |

Review is **detection only**: reviewed events and flagged attempts need a human; there is no resolve/refund UI in this stage.

## Database changes (`prisma/migrations/20261018000100_payment_matching_safety`, **not executed**)
- `IncomingTransaction`: columns `fingerprint`, `reviewDetails`; unique index on `matchedPaymentId`; index on `fingerprint`.
- New table `PaymentEvent` (FK `ON DELETE CASCADE` so the existing stress/test cleanups keep working).
- `CHECK Payment_real_match_needs_transaction` (non-test payment in `MATCHED_UNVERIFIED`/`CONFIRMED_MANUAL` needs `matchedTransactionId`) and `CHECK IncomingTransaction_match_needs_payment`, both `NOT VALID`: enforced for new writes, existing rows untouched.
- **Failure mode**: the unique index creation fails (rolling back the migration, data unchanged) if two incoming rows already point at the same payment. Check first: `SELECT "matchedPaymentId", count(*) FROM "IncomingTransaction" WHERE "matchedPaymentId" IS NOT NULL GROUP BY 1 HAVING count(*) > 1;`
- Existing rows get no history backfill (events start from deployment).
- Housekeeping: `schema.prisma` had one stray non-UTF-8 byte (an em dash I wrote in Stage 3C); replaced with `-`. No schema meaning changed.

## Conflict reported, not guessed
`src/tools/smoke-restaurant.ts` forces `MATCHED_UNVERIFIED` on a **mock** payment without an incoming transaction. To keep it working, the new CHECK and the confirmation-consistency rule exempt `isTest` payments (a test card can never receive real Gmail money: `GMAIL_FOR_MOCK_CARD`). Real payments get no such exemption.

## Test commands (none run by me)
```sh
npm run db:generate
npm run db:migrate                  # applies 20261018000100_payment_matching_safety (also pending: the two Stage 3 migrations)
npm run typecheck
node --import tsx --test src/modules/payment/matching.test.ts src/modules/payment/uzcard.test.ts   # pure
npm run test:db                     # existing V3 regression (must still pass)
npm run test:payment:safety         # new: signal-only, duplicates/races, equal amounts, partial/excess, late/expired, delay, reuse, DB invariants, staff-only confirmation
```
DB tests create a uniquely named restaurant with random real-type cards (no money, no Telegram) and delete only their own rows. `engine.maintenance()` in the late-payment test runs the normal global expiry sweep, as production does.

## Remaining payment risks
- **No bank API**: UZCARD mail is minute-precision, has no payer id and is only DKIM/DMARC-heuristic checked (`Authentication-Results`); a spoofed or misparsed mail can still produce `MATCHED_UNVERIFIED`. Only the staff check against the real statement protects the money.
- **Staff diligence**: the confirm button cannot prove the staff member actually compared the bank statement; it is audited, not verified.
- **No review resolution workflow**: `REVIEW_REQUIRED` events, late/partial/excess money and flagged expired orders have no UI, refund or "attach to order" action; they are only listed (`listReviews`, DB). Customers whose attempt expired are told to contact an administrator.
- **Fingerprint dedupe is conservative**: legitimate same-minute equal payments become reviews.
- Delay threshold, 5-minute window and 15-minute ambiguity window are heuristics, not guarantees; a payer who pays within the window but whose mail is delayed past 30 min is reviewed, not matched.
- The `NOT VALID` checks do not cover legacy rows until validated; legacy payments have no event history.
- Gmail mail text can be edited by the mailbox owner; the Gmail token is a single point of trust. Real payments remain disabled-by-default only as far as existing configuration (`mode()`/cards) already controls; this stage adds no switch.
- Not compiled or executed here; expect typecheck nits after `db:generate`. Not production-ready.
