# Stage 4B-2 — Safe acceptance, price consent and customer cancellation

> **Superseded (Stage 7D):** the price-change / customer-consent workflow described here was removed by an owner decision; see `docs/STAGE_7D.md`. Kept as history.

Continues Stage 4B-1. PaymentEngineV3, the Stage 4A matching rules, support and taxi logic are untouched. Still true: **no payment attempt exists for an order until the restaurant has accepted (and, if the price changed, the customer has consented)**.

## 1. Non-bot REAL HTTP orders — decision: refuse creation
`placeOrder` now throws **HTTP 422** for `paymentMode: REAL` with `createdViaBot: false`, before anything is written. Reason: the only authorized acceptance path is the restaurant's Telegram staff account (`restaurant.staffTelegramUserId`, bot-created orders only). Adding an HTTP accept endpoint would need a second restaurant credential/identity scheme, and the internal `x-internal-api-key` is an operator key that must never be handed to restaurants or customers. So unsupported creation is rejected instead of silently entering a workflow that cannot accept it. MOCK HTTP orders are unchanged (legacy immediate test payment unless `RESTAURANT_ACCEPTANCE_MOCK=true`).

## 2. Re-check before acceptance
`acceptOrder` and `proposePriceRevision` re-read, inside the transaction, restaurant `isActive`/`isPaused` (→ `RESTAURANT_CLOSED`, audited as `ACCEPT_REFUSED`) and every product (exists, same restaurant, available, price). No inventory is reserved or counted; availability is the menu flag at that moment only.

## 3. Changed prices: explicit customer consent
Where the bot supports it (it does: inline buttons), a price change is no longer a dead end:
1. Accept refused with `PRICE_CHANGED` and *only* price problems → staff gets **“Yangi narxni mijozga taklif qilish”** (keeps the chosen prep time). Unavailable/missing products can never be revised; the restaurant must reject.
2. `proposePriceRevision`: order `WAITING_RESTAURANT → WAITING_CUSTOMER_CONSENT` (compare-and-set), one `OrderPriceRevision` row (old/new lines and totals, prep minutes, expiry `PRICE_CONSENT_SECONDS`, default 300 s, 30–3600). **No payment exists.**
3. The notifier sends the customer old and new total with `✅ Yangi narxga roziman` / `❌ Bekor qilish`.
4. `respondToRevision` finds the revision **by Telegram id in the same query** (foreign/unknown ids look identical). Consent runs in one transaction under the payment lock: revision `PROPOSED→ACCEPTED` (not expired), menu re-validated against the *proposed* lines and restaurant open (else the consent is voided, order cancelled `MENU_CHANGED`, nothing charged), order `→ PAYMENT_PENDING` with the new total, old lines **superseded (kept)**, new lines inserted, `PRICE_CONSENT` event, then the single payment at exactly `newTotal × 100`.
5. Decline, customer cancel, or timeout (`expireConsents`, idempotent sweep in the restaurant notifier) → `CUSTOMER_CANCELLED` with reason `PRICE_DECLINED` / `CUSTOMER_REQUEST` / `CONSENT_TIMEOUT`, revision `DECLINED`/`VOID`/`EXPIRED`. Repeated or parallel taps are harmless (CAS).

Both price rises **and decreases** need consent (simplest rule; see open decisions).

## 4. Immutable snapshots
`OrderItem` columns remain unchangeable (trigger from 4B-1). A consented revision never edits a line: old lines get `supersededAt` (the trigger permits only that one-way mark) and new lines are inserted. Readers (`orderDetails`, `staffOrderDetails`, acceptance) show lines where `supersededAt IS NULL`; history stays in `OrderItem` and in `OrderPriceRevision.previousLines/lines`.

## 5. Customer cancellation while waiting
`❌ Buyurtmani bekor qilish` appears on the order while `WAITING_RESTAURANT` or `WAITING_CUSTOMER_CONSENT` (`order:cancel:<id>`; the old `checkout:cancel:<flowKey>` is untouched). `cancelWaitingOrder` checks ownership by Telegram id, then compare-and-sets the status. Accept/propose/cancel/timeout are all `UPDATE … WHERE status = <expected>`, so a race has exactly one winner: if acceptance commits first the cancel gets `TOO_LATE`, if cancel commits first acceptance gets `STALE` and creates no payment. After acceptance there is no customer cancellation (money may be in flight) — that needs a refund/review process, not built.

## 6–7. Payment invariants and Stage 4A
- One attempt per order: `Payment.orderId` UNIQUE + payment created only inside the accept/consent transaction behind a status CAS.
- DB trigger `Payment_requires_accepted_order` (replaced in this migration) now also covers `WAITING_CUSTOMER_CONSENT` and `CUSTOMER_CANCELLED`.
- Late, duplicate, partial, excess and ambiguous money is unchanged: still `REVIEW_REQUIRED` (4A). A revised order is matched at the revised amount only; a mail for the old amount is a review item.

## 8. Restaurant response timeout
Still `RESTAURANT_RESPONSE_SECONDS`, **default 600 s (unchanged)**. The roadmap's initial recommendation is **180 s** for the restaurant response, with an admin warning and closing at 5 minutes without answer. Nothing was changed silently: to follow the roadmap set `RESTAURANT_RESPONSE_SECONDS=180`. The admin warning is not implemented (no admin channel exists for orders). Likewise the roadmap's 10-minute payment window vs the engine's existing 5-minute `paymentWindowMs` is **not** changed here.

## Database (`prisma/migrations/20261020000100_price_consent_cancel`, not executed)
Enum `WAITING_CUSTOMER_CONSENT`, `CUSTOMER_CANCELLED`; `Order.cancelledAt/By/Reason`; `OrderItem.supersededAt`; table `OrderPriceRevision` (status CHECK, partial unique index: one `PROPOSED` per order); `CREATE OR REPLACE` of the two trigger functions from 4B-1. Additive; apply after `20261019000100`.

## Tests (none run by me)
```sh
npm run db:generate
npm run db:migrate
npm run typecheck
npm run test:acceptance        # pure: 4B-1 + consent timeout + revision builder
npm run test:acceptance:db     # 4B-1 regression
npm run test:acceptance2:db    # 4B-2: REAL HTTP refusal, cancel, accept-vs-cancel races, paused/inactive, unavailable,
                               # price without consent, consent (parallel/foreign/duplicate), decline/expiry/void, menu drift,
                               # expired acceptance, duplicate payment prevention, immutable history
npm run test:payment:safety && npm run test:db && npm run test:restaurant
```

## Unresolved business decisions
1. **Timeout:** keep 600 s or adopt the roadmap's 180 s (+ 5-minute hard close, admin warning)?
2. **Price decreases:** require consent (current, simplest) or auto-accept a lower price?
3. **Customer cancel after acceptance** (payment pending/in flight): who refunds, how is a possibly sent transfer handled?
4. **Staff notification** when a customer cancels/declines: not sent; the staff card stays until refreshed or expired.
5. **HTTP/partner ordering:** if REAL non-bot ordering is wanted, a restaurant-scoped credential model is required first.
6. **Payment window** 5 min (engine) vs 10 min (roadmap).

## Limitations
- Not compiled or run; expect typecheck nits after `db:generate`. No manual Telegram run.
- Consent notices are at-least-once and DB-driven (7 s notifier); a process stop delays but never loses the state.
- Staff view of `WAITING_CUSTOMER_CONSENT` is not listed in `/staff` and has no restaurant-side withdraw button; a pending proposal ends only by consent, decline, cancel or timeout.
- Stage 4A residual risks (no bank API, manual verification, no review-resolution workflow) are unchanged.
