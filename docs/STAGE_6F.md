# Stage 6F — simpler business workflow (before the Mini App)

## New checkout lifecycle
```
customer checks out (bot today, Mini App later)
  -> server validates: restaurant active & not paused, products of THIS restaurant & available, prices read from the DB,
     (client states what it showed: expectedTotalSom / expectedUnitPrices -> mismatch = 409 NARX_OZGARGAN, nothing created),
     REAL: restaurant has a pickup address and the taxi company has an operator
  -> order PAYMENT_PENDING + exactly one payment attempt (AWAITING card / QUEUED), prices frozen in OrderItem, estimatedPrepMinutes = default
  -> customer pays; the engine matches the money: MATCHED_UNVERIFIED (Gmail = signal only)
       MOCK : system actor verifies (isolated: refused for any non-test payment) and cooking starts      (bot button + 7 s sweep)
       REAL : restaurant checks ITS bank and presses "To'lovni tasdiqlash" in the app -> cooking starts by itself
  -> PREPARING (prepMinutes = defaultPrepMinutes, taxi dispatch scheduled automatically)  -> restaurant presses READY (never automatic)
  -> taxi operator bot: accept -> sent -> delivered (two-step) -> COMPLETED + 5000 UZS commission (non-test, verified, once)
```
No routine restaurant acceptance. The old accept-first flow (`WAITING_RESTAURANT`) remains only for rollback and for orders created before
6F: `RESTAURANT_MANUAL_ACCEPTANCE=true` (`RESTAURANT_ACCEPTANCE_MOCK` is retired).

## Removed / disabled old flows
- Post-order price proposals: `proposePriceRevision` refuses (`PRICE_PROPOSALS_REMOVED`, unless `LEGACY_PRICE_PROPOSALS=true` for tests),
  `POST /orders/:id/propose-price` → 410, the app has no button/dialog. Orders already waiting for a customer's answer can still be answered
  or expire. A legacy waiting order with a stale price can only be rejected.
- Product price edits require the restaurant to be paused (`409 PRICE_EDIT_REQUIRES_PAUSE`, shared row lock on the restaurant). Other edits,
  new products and availability are unaffected. Existing orders keep their frozen lines and payment amount.
- Restaurant "accept" is not part of the normal flow; the app shows it only for legacy waiting orders.

## Restaurant app
- Order detail: estimated ready time (Asia/Tashkent) and a live countdown computed from the SERVER clock (`serverNow` + the phone's monotonic
  time since the response), overdue minutes in red; never auto-READY.
- READY: sticky full-width bottom bar with progress state, one confirmation, disabled while submitting; the API treats repeats/concurrent taps
  as success (one event, original `readyAt` kept) while a stale screen (`expectedStatus`) still gets 409.
- "New order" polling now watches `filter=toCook` (paid/awaiting-bank-check/cooking), not unpaid orders. `incoming` = waiting + unverified +
  confirmed-not-started.

## Cancellation
Customer: reason code only; unpaid → `CANCELLED`, no refund row; paid → refund request, order frozen, nothing marked sent. The restaurant's
refund "sent" still needs its own bank reference (DB CHECK `RefundRequest_sent_needs_reference`): that is the proof that keeps the tracking
truthful. No customer-facing flow asks for bank data (asserted in tests and in the Mini App contract).

## Mini App
Contract only: `docs/MINIAPP_API_CONTRACT.md`, `src/modules/orders/contract.ts` (strict schemas, `quoteCheckout`, `toPlaceOrderInput`).

## Tests
`test:checkout6f:db` (new, 12) plus updated orders/catalog/acceptance/telegram/taxi suites; see the report.
