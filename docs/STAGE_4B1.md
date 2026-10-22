# Stage 4B-1 — Restaurant acceptance before payment

Flow: customer places order → **WAITING_RESTAURANT** → restaurant checks menu/price and accepts (with a preparation estimate) → payment attempt is created and the customer gets the card → bank payment verified manually by the restaurant (Stage 4A, unchanged) → PREPARING → READY → taxi (unchanged).

PaymentEngineV3 is not rewritten. `engine.createCheckout` is reused as-is: acceptance passes it a callback that performs the order transition, so the payment is created in the same transaction, under the same advisory lock, with the same assignment logic.

## What was implemented
| # | Requirement | Implementation |
|---|---|---|
| 1 | New state | `OrderStatus`: `WAITING_RESTAURANT`, `RESTAURANT_REJECTED`, `RESTAURANT_EXPIRED` (existing names/transitions untouched). |
| 2 | No payment before acceptance | `placeOrder` creates REAL orders as `WAITING_RESTAURANT` with **no Payment row**. `acceptanceRequired('REAL')` is unconditional (no env switch). A DB trigger `Payment_requires_accepted_order` refuses any Payment INSERT for an order that is waiting/rejected/expired, even from other code or SQL. |
| 3 | Accept / reject | `src/modules/restaurant/acceptance.ts` (`acceptOrder`, `rejectOrder`); bot buttons on the staff card: prep time (10–60 min) = accept, `🚫 Rad etish` → reason (4 fixed codes). Authorization in the service: the actor must be `restaurant.staffTelegramUserId` of the order's restaurant and the order must be bot-created; anything else throws `RUXSAT_YOQ`. |
| 4 | Availability + current prices | At acceptance every line is checked against the live menu (`validateSnapshot`): product exists in this restaurant, `isAvailable`, price equals the order's snapshot. Any problem → `PROBLEMS`, nothing changes, `ACCEPT_REFUSED` is audited, staff sees the list and can reject. |
| 5 | Immutable snapshots | `OrderItem` rows (name, unit price, quantity, subtotal) are written once at placement and never updated: a DB trigger rejects UPDATE of those columns (only the existing `ON DELETE SET NULL` of `productId` is allowed). A price change therefore **cannot silently re-price** an order; acceptance is refused (design decision below). The `ACCEPT` event also stores the validated lines and total. |
| 6 | Audit | `OrderEvent`: `PLACED` (customer), `ACCEPT` / `REJECT` / `ACCEPT_REFUSED` (restaurant staff, actor id, reason/problems/prep), `RESTAURANT_TIMEOUT` (system). Columns on `Order`: `acceptedAt/By`, `rejectedAt/By`, `rejectReason`, `estimatedPrepMinutes`, `restaurantDeadlineAt`. |
| 7 | No duplicate processing | Accept: `UPDATE … WHERE status='WAITING_RESTAURANT' AND deadline > now` inside the payment-locked transaction; the loser gets `STALE` and creates nothing. Reject and the timeout sweep use the same compare-and-set. Repeated button presses are therefore harmless. |
| 8 | Timeout | `RESTAURANT_RESPONSE_SECONDS` (default 600, allowed 30–86400, invalid value throws). Deadline stored at placement. A late accept returns `TIMED_OUT` (and expires the order); `expireWaitingOrders` runs every 7 s inside the existing restaurant notifier, safe with several workers. Customer is told (reject/timeout) not to send money. |
| 9 | One payment attempt | `Payment.orderId` is UNIQUE (existing); creation happens only in the accept transaction guarded by the status CAS. |
| 10 | Stage 4A preserved | Untouched. Mail arriving before acceptance finds no AWAITING attempt → `REVIEW_REQUIRED`. After acceptance the match still ends at `MATCHED_UNVERIFIED`; only staff confirms. |

`paymentIsTest` is stored on the order at placement, so the payment is created later in the **same mode it was placed in**: a REAL order can never receive a mock card and a MOCK order never a real one, even if `BOT_PAYMENT_MODE` changes in between.

## Compatibility and conflicts (documented, not hidden)
- **MOCK checkout keeps the legacy behaviour by default** (immediate `PAYMENT_PENDING` + test card), so `smoke.ts`, `smoke-taxi.ts`, `smoke-restaurant.ts`, `payment.db.test.ts` and the HTTP `POST /orders` flow with default `paymentMode` work unchanged. Opt in with `RESTAURANT_ACCEPTANCE_MOCK=true` to exercise the new flow with test cards. This is a deliberate asymmetry: **mock orders are not forced through acceptance by default**, real orders always are.
- **REAL orders via the HTTP API** (`createdViaBot=false`) are created `WAITING_RESTAURANT`, but staff acceptance only works for bot-created orders (existing rule in `takeStaffAction`), so they will expire after the timeout. Response shape is unchanged (`payment: null`, `status: WAITING_RESTAURANT`); API clients must handle that.
- **Price change = refuse, not re-price.** Re-pricing would either mutate the snapshot or charge a customer an amount they never saw. The restaurant rejects with reason "Narx o‘zgargan" and the customer re-orders. If you want "accept at the new price with customer consent", that needs a new customer-approval state (not built).
- `prepMinutes` and `START_PREPARING` are unchanged (taxi scheduling still reads them). `estimatedPrepMinutes` is the estimate given at acceptance; staff still chooses the actual minutes when starting preparation. The customer message after acceptance is the existing "karta ajratildi" payment notice; it does not yet repeat the estimate.

## Database (`prisma/migrations/20261019000100_restaurant_acceptance`, **not executed**)
- Enum values `WAITING_RESTAURANT`, `RESTAURANT_REJECTED`, `RESTAURANT_EXPIRED` (`ADD VALUE IF NOT EXISTS`; PostgreSQL cannot remove enum values later).
- `Order`: `paymentIsTest` (NOT NULL DEFAULT false), `restaurantDeadlineAt`, `acceptedAt/By`, `estimatedPrepMinutes`, `rejectedAt/By`, `rejectReason`; index `(status, restaurantDeadlineAt)`.
- Triggers `Payment_requires_accepted_order` (BEFORE INSERT on `Payment`) and `OrderItem_immutable` (BEFORE UPDATE on `OrderItem`). They affect only new writes; existing rows are not modified. Any tool that rewrites order lines or inserts a payment for a waiting order will now fail by design.
- Apply order matters: the three Stage 3 migrations and `20261018000100` are also still pending.

## Test commands (none run by me)
```sh
npm run db:generate
npm run db:migrate
npm run typecheck
npm run test:acceptance        # pure: mode gating, timeout parsing, snapshot validation
npm run test:acceptance:db     # DB: no payment before accept, auth, parallel accept, accept-vs-reject race, audit, price/availability, immutability trigger, timeout sweep, payment trigger, MOCK compatibility, 4A signal-only after accept
npm run test:payment:safety    # Stage 4A regression
npm run test:db                # V3 regression
npm run test:restaurant
```
Changing `.env`: optional `RESTAURANT_RESPONSE_SECONDS`, `RESTAURANT_ACCEPTANCE_MOCK` (documented in `.env.example`). The DB test creates its own restaurants, product, taxi company and cards and removes only those.

## Limitations
- Not compiled or run; expect typecheck nits after `db:generate`. No manual Telegram run was done.
- Staff alert depends on the existing notifier rule (`staffLinkedAt` / `updatedAt`) and a live staff Telegram chat; if staff never see the card the order simply expires. There is no escalation, second approver or reminder before the deadline.
- Orders are not cancellable by the customer while waiting; the customer only sees "waiting" in `/orders`.
- Timeout sweep and notices are at-least-once, DB-state driven; a crash between a status change and its notice can delay the notice until the next 7 s cycle but never loses the state.
- Acceptance does not check restaurant `isPaused`/`isActive` (placement does); a restaurant that pauses after placing can still accept.
- If no card is free at acceptance the payment is `QUEUED` (existing V3 behaviour, 10-minute queue window), and the order is already accepted.
- Real-payment readiness is not claimed: bank verification remains a manual staff step (Stage 4A risks apply).
