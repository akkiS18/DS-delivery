# Stage 6B — Commission ledger and restaurant finance API

Nothing here was compiled, run or migrated; **not production-ready**. The platform collects no money, executes no bank transfers and treats Gmail/Telegram/refund facts as signals or attestations only.

## 1. Delivery proof: it does not exist yet
Reviewed `Order`, `Payment`, `RefundRequest`, `Restaurant`, `TaxiDispatch` and every writer of `Order.status`.
- `OrderStatus` has `COMPLETED` and `DELIVERY_ASSUMED`, but **no code ever sets either** (grep over `src/`; the taxi flow ends at `TAXI_REQUESTED`/`DRIVER_ASSIGNED`, and `READY` messages say "this is not delivered"). There is no `DELIVERED` status, no `deliveredAt`/`completedAt`, no courier/customer handover event.
- Payment match/confirmation, `READY`, a taxi dispatch or assignment are **not** delivery (AGENTS.md).
- Therefore **no authoritative delivery event is implemented, and I did not invent one.** `DELIVERY_CONFIRMATION_IMPLEMENTED = false` (`commission/rules.ts`), reported by the API as `deliveryConfirmation: "NOT_IMPLEMENTED"`.
- Consequence today: the ledger is empty and stays empty; no commission is "earned". Outstanding liability is 0.

**Dependency / contract for the future delivery stage:** in ONE transaction, lock the order, move it to `COMPLETED`, write the `OrderEvent` (`toStatus = COMPLETED`, with the real actor), and call `accrueCommissionTx(tx, orderId, actor)` from `src/modules/commission/ledger.ts`. That event is what the ledger stores as `proofEventId`. Whoever defines "delivered" (customer confirmation, courier handover…) must be an actor that is not the restaurant alone — a policy decision, see §8.

## 2. Commission accounting rules
- Flat **5000 UZS per delivered order**, configurable with `COMMISSION_FLAT_SOM` (integer 1..1,000,000; invalid value ⇒ accrual **fails closed** with `COMMISSION_CONFIG_INVALID`, nothing is charged). The amount applied is **copied into the entry** (`amountSom`) with `orderTotalSom` and `ruleCode = FLAT_SOM`; later config changes never alter old rows.
- Earned only if **all** hold (checked in `commissionEligibility`, re-checked in the DB insert trigger): order `COMPLETED`; a `COMPLETED` `OrderEvent` exists; order and payment are not test; payment is `CONFIRMED_MANUAL` (restaurant-verified, never mail-matched alone); payment belongs to the order; no `RefundRequest` other than `REJECTED`.
- Never earned on: payment matched/confirmed only, `PREPARING`/`READY`, taxi states, `DELIVERY_ASSUMED`, cancelled/rejected/expired orders, test data.
- Money is integer: som as `Int`; payments/refunds stay tiyin (`BigInt`, 1 som = 100 tiyin).
- **Idempotent / no duplicates:** `accrueCommissionTx` locks the order row (`FOR UPDATE`), returns the existing entry if any; `CommissionEntry.orderId` is `UNIQUE` (backstop; `P2002` is mapped to `ALREADY_ACCRUED`).
- **Append-only:** triggers reject `UPDATE`/`DELETE` on `CommissionEntry` and `CommissionEvent` (`LEDGER_APPEND_ONLY`). Only a transaction that sets `ds.ledger_cleanup='on'` may delete — used by the test suites for their own rows; anyone with that DB access could drop the trigger anyway. FKs to order/restaurant/payment are `RESTRICT`.
- **Audit:** every accrual writes a `CommissionEvent` (`ACCRUED`: amount, total, rule, proof event, actor).
- **Restaurant owes the platform** the sum of entries. **Nothing is collected automatically**; settlements are not recorded yet, so `outstandingLiability` = all accrued commission and `settlementTracking = "NOT_IMPLEMENTED"`.
- **Refunds:** a refund (not `REJECTED`) blocks accrual. A refund that appears after accrual does **not** reverse the commission; the API flags `needsPolicyReview: true`. No reversal entry type exists until a policy is approved.

## 3. Finance API
Base: `/api/v1/restaurant/finance/…`, **GET only**, header `Authorization: Bearer <accessToken>` from Stage 5A login. Responses are `Cache-Control: no-store`. The restaurant is taken **only** from the session; query strings are strict, so any unknown parameter (e.g. `restaurantId`) ⇒ `400`. Test orders (`paymentIsTest`) and test payments are excluded everywhere.

Errors: `401 {error}` missing/invalid/expired/revoked session; `400 {error:"Validation failed", details}` bad query; `400 {error:"DATE_FILTER_INVALID" | "DATE_RANGE_TOO_LARGE"}`.

Common query: `from`, `to` — `YYYY-MM-DD` (Asia/Tashkent day; `to` is inclusive of that day) or an ISO datetime **with** offset (`to` exclusive). Range is half-open `[from, to)`, max 366 days, default last 30 days. List endpoints also take `limit` (1–100, default 50) and `cursor` (the previous page's `nextCursor`; results are newest-first by number; `nextCursor` is `null` at the end).
Money: `…Som` = integer som; `…Tiyin` = integer string (BigInt-safe). Money is never a float.

### GET /summary  (`from`,`to`)
```json
{
  "currency": "UZS",
  "period": { "from": "2026-09-18T…Z", "to": "2026-10-18T…Z", "dateOnlyTimezone": "+05:00" },
  "deliveryConfirmation": "NOT_IMPLEMENTED",
  "orders": { "completed": {"count":0,"totalSom":0}, "cancelled": {"count":2,"totalSom":42000}, "inProgress": {"count":3,"totalSom":63000} },
  "payments": {
    "verifiedReceived":  {"count":4,"som":84000},
    "pendingUnverified": {"count":1,"som":21000},
    "awaitingPayment":   {"count":1,"som":21000}
  },
  "refunds": {
    "period": { "requested":{"count":1,"amountTiyin":"2100000","amountSom":21000}, "approvedAwaitingSend":{…}, "sentUnconfirmed":{…},
                "confirmedByCustomer":{…}, "confirmedByAdmin":{…}, "disputed":{…}, "rejected":{…} },
    "openNow": { "total":{…}, "requested":1, "approvedAwaitingSend":0, "sentUnconfirmed":1, "disputed":0 },
    "bankVerified": false
  },
  "commission": {
    "ruleCode": "FLAT_SOM", "currentFlatSom": 5000,
    "accruedInPeriod": {"count":0,"som":0},
    "outstandingLiability": {"count":0,"som":0},
    "settlementTracking": "NOT_IMPLEMENTED"
  },
  "unresolved": { "refundsOpen":2, "refundsDisputed":0, "completedOrdersWithoutCommission":0, "commissionedOrdersWithRefund":0 }
}
```
- `orders` = orders **created** in the period by bucket (`completed` = `COMPLETED`; `cancelled` = CANCELLED, CUSTOMER_CANCELLED, RESTAURANT_REJECTED, RESTAURANT_EXPIRED, PAYMENT_EXPIRED, FAILED; `inProgress` = everything else, including `DELIVERY_ASSUMED`).
- `payments`: only `verifiedReceived` (restaurant staff verified) is money received. `pendingUnverified` (mail-matched) and `awaitingPayment` are **never** received money. Refunds are shown, **never netted** against received money.
- `refunds.period` by `requestedAt`; `openNow`, `commission.outstandingLiability` and `unresolved` are all-time.
- `currentFlatSom` is `null` if the env value is invalid. `completedOrdersWithoutCommission` > 0 means an eligible order was not accrued (investigate).

### GET /orders  (`from`,`to`,`limit`,`cursor`, `status` = `completed|cancelled|in_progress`)
```json
{ "currency":"UZS", "nextCursor": 118,
  "items": [{
    "number": 123, "status": "PAYMENT_CONFIRMED", "bucket": "inProgress", "totalSom": 21000, "createdAt": "…Z",
    "payment": { "state": "VERIFIED_BY_RESTAURANT", "receivedSom": 21000 },
    "commission": { "state": "PENDING_DELIVERY_CONFIRMATION", "amountSom": 0 },
    "refund": null
  }] }
```
`payment.state`: `NONE | VERIFIED_BY_RESTAURANT | MATCHED_UNVERIFIED | AWAITING_PAYMENT | EXPIRED_OR_CANCELLED` (`receivedSom` is non-zero only for `VERIFIED_BY_RESTAURANT`).
`commission.state`: `ACCRUED` (adds `number`, `amountSom`, `accruedAt`) | `PENDING_DELIVERY_CONFIRMATION` | `NOT_APPLICABLE` (cancelled-type) | `NEEDS_REVIEW` (completed but no entry). `refund` = latest `{number,status,stage,unresolved}` or `null`. `bucket` values here are `completed|cancelled|inProgress`.

### GET /commissions  (`from`,`to` on accrual time, `limit`, `cursor`)
```json
{ "currency":"UZS", "nextCursor": null,
  "items": [{ "number":7, "orderNumber":123, "orderTotalSom":21000, "amountSom":5000, "ruleCode":"FLAT_SOM",
              "accruedAt":"…Z", "refund": null, "needsPolicyReview": false }],
  "totalInPeriod": {"count":1,"som":5000}, "outstandingLiability": {"count":1,"som":5000}, "settlementTracking":"NOT_IMPLEMENTED" }
```

### GET /refunds  (`from`,`to` on request time, `status` = REQUESTED|APPROVED|REJECTED|SENT|CONFIRMED|DISPUTED, `limit`, `cursor`)
```json
{ "currency":"UZS", "nextCursor": null,
  "items": [{
    "number": 4, "orderNumber": 123, "orderStatus": "CANCELLED", "kind": "CUSTOMER_CANCEL", "status": "SENT",
    "stage": "SENT_UNCONFIRMED", "unresolved": true, "bankVerified": false,
    "reasonCode": "CHANGED_MIND", "requestedByType": "CUSTOMER", "requestedAt": "…Z", "decidedAt": "…Z", "rejectReason": null,
    "paidAmountTiyin": "2100000", "paidAmountSom": 21000, "refundAmountTiyin": "2100000", "refundAmountSom": 21000,
    "sentAt": "…Z", "bankReference": "TRX-1234", "confirmedByType": null, "confirmedAt": null, "disputedAt": null,
    "taxiActiveAtDecision": false, "commissionAccruedSom": null
  }],
  "totals": { "requested":{"count":0,"amountTiyin":"0","amountSom":0}, "approvedAwaitingSend":{…}, "sentUnconfirmed":{…},
              "confirmedByCustomer":{…}, "confirmedByAdmin":{…}, "disputed":{…}, "rejected":{…}, "unresolved":{…} } }
```
`stage`: `REQUESTED | APPROVED_AWAITING_SEND | SENT_UNCONFIRMED | CONFIRMED_BY_CUSTOMER | CONFIRMED_BY_ADMIN | DISPUTED | REJECTED`. Android must show `SENT_UNCONFIRMED` as "restaurant says sent", `CONFIRMED_*` as "customer/admin confirmed" and never as "bank-verified" (`bankVerified` is always `false`). `refundAmountSom` is floor(tiyin/100); use the tiyin string for exactness. `totals` cover the whole filtered range, not just the page. Admin confirmation notes and customer ids are not exposed.

## 4. Database (`prisma/migrations/20261024000100_commission_ledger`, not executed)
Additive: tables `CommissionEntry` (unique `orderId`, CHECKs `kind='ACCRUAL'`, amounts > 0), `CommissionEvent`; functions/triggers `commission_entry_guard` (BEFORE INSERT: order COMPLETED, same restaurant and total, not test, payment is this order's `CONFIRMED_MANUAL` non-test, proof event is a `COMPLETED` event of this order, no non-rejected refund) and `ledger_append_only`. No existing row or table is modified; if the migration fails nothing else changes. Prisma relations added (`Order.commission`, `Restaurant.commissionEntries`, `Payment.commissionEntries`). Apply after the pending Stage 3–6A migrations.

## 5. Tests (not run by me)
```sh
npm run db:generate
npm run db:migrate
npm run typecheck
npm run test:finance        # pure: eligibility matrix, config fail-closed, refund stages/summary, date ranges
npm run test:finance:db     # earning rules, duplicate+concurrent accrual, DB guards/append-only, historical amounts,
                            # tenant isolation, 401/expired sessions, pending refunds, unverified/test money exclusion
npm run test:refunds:db && npm run test:payment:safety && npm run test:auth:db   # regression
```
The DB test inserts only its own uniquely-named restaurants/orders and removes them (ledger rows via the cleanup switch).

## 6. Not changed
Android source, Stage 4A/4B payment safeguards, the Stage 6A refund workflow, taxi code; no database was reset/seeded/migrated; no bank transfer or collection exists.

## 7. Limitations
- No accrual trigger is wired anywhere (there is no delivery event to hook); accrual runs only when the future stage calls `accrueCommissionTx`/`accrueCommission`.
- No settlement/payment-of-commission recording, invoices, reversal entries or admin finance UI.
- Orders created in the period are bucketed by creation time, not completion time.
- Reports are computed live with grouped queries; fine at current scale, unbenchmarked.
- Not compiled or executed; expect typecheck nits after `db:generate`.

## 8. Unresolved policy decisions
1. **What proves delivery and who attests it** (customer confirmation? courier? timeout-based `DELIVERY_ASSUMED`?). Until decided no commission is earned.
2. Is commission due when a customer refund is confirmed after delivery? Reversal/credit rules, partial refunds and dispute outcomes.
3. How and when the restaurant pays the platform (cadence, method, grace, late handling) and how settlements are recorded.
4. Commission on orders with a partially refunded amount or taxi cost; per-restaurant rates or taxes (VAT) — currently one flat configurable amount.
5. Whether `DELIVERY_ASSUMED` (if ever used) may earn commission.
6. Time zone for reporting day boundaries (Asia/Tashkent assumed).
