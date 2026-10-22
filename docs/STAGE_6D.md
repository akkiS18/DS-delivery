# Stage 6D — dedicated taxi operator bot + controlled delivery completion

## Architecture
```
Customer  -> customer bot (BOT_TOKEN)         \
Restaurant-> Android APK (HTTP, Bearer)        >  one backend, one PostgreSQL, one dispatch state machine
Taxi op.  -> DS Taxi Operator Bot (TAXI_BOT_TOKEN) /
```
No taxi API, phone, VoIP or taxi app. `npm run dev` starts both bots (long polling, separate tokens) and the workers.
Operator-facing messages leave through the taxi bot; customer/restaurant notices through the customer bot
(`startTaxiDispatcher(customerBot, taxiBot)`). Without `TAXI_BOT_TOKEN` the legacy mode remains (operators served by the
customer bot) so nothing breaks. Both bots use the same start-up helper: launch only settles when polling stops, a later
409 (duplicate polling / webhook) or 401 is fatal with a clear log line, shutdown stops both.

## Dispatch state machine (`TaxiDispatch.status`)
```
SCHEDULED --worker, when due--> SENDING --> REQUESTED --[Qabul qilish]--> ACCEPTED --[Taksi yuborildi]--> ASSIGNED --[Yetkazildi + confirm]--> DELIVERED
                                   |            |  \--[Rad etish]--> DECLINED (consented fallback -> new SCHEDULED for another company)
                                   |            \--timeout--> CANCELLATION_PENDING --operator: sent / none--> ASSIGNED / DECLINED
                                   \--send failed / stale lease--> NEEDS_HELP --operator: sent / none--> ASSIGNED / DECLINED
ACCEPTED --no "sent" within TAXI_ACCEPT_TO_SENT_SECONDS (900)--> NEEDS_HELP
```
- A notification is not an acceptance, an acceptance is not a dispatched taxi, a dispatched taxi is not a delivery.
  `Taksi yuborildi` is refused straight from REQUESTED (only after acceptance, or to clarify an unanswered request).
- `TaxiDispatch_only_one_active_per_order` (partial unique index) now covers ACCEPTED and DELIVERED too: two companies
  can never own one order, and a delivered order can never be dispatched again.
- Scheduling is unchanged: created in the same transaction as `START_PREPARING`, due = start + prep − `TAXI_LEAD_MINUTES`
  (never before cooking starts). The customer's chosen company is used; if none, the first eligible (active, operator
  linked) company is picked automatically; none eligible -> `TAXI_NO_ELIGIBLE_COMPANY` OrderEvent.
- Booking message: order number, restaurant pickup address/phone, customer delivery address/phone, food status and prep
  estimate, food value (not a taxi fee). Never card numbers or payment data.

## Delivery completion (`completeDelivery`, the Stage 7A contract)
One transaction under the order row lock: the linked operator of the **assigned company** confirms; dispatch ASSIGNED ->
DELIVERED; order READY -> COMPLETED (CAS); immutable `OrderEvent` `DELIVERY_CONFIRMED` (actor, company, dispatch, attempt,
timestamp); `accrueCommissionTx` in the same transaction. Refused (state unchanged): not ASSIGNED
(`TAKSI_HALI_YUBORILMAGAN`), food not READY, order cancelled / cancellation requested, any non-rejected refund, payment not
`CONFIRMED_MANUAL`, wrong company. A repeat is a no-op. Commission: flat 5000 UZS (`COMMISSION_FLAT_SOM`), once
(unique index + ledger), only for COMPLETED, verified, non-test, refund-free orders; MOCK/test orders complete with
`NOT_ELIGIBLE`. `DELIVERY_CONFIRMATION_IMPLEMENTED` is now `true`.

## Taxi bot
Commands: `/start [CODE]`, `/link CODE` (or paste the bare code), `/taxi`, `/myid`, `/help`.
Callbacks: `taxi:view|acc|none|sent|dlv|dlvok:<dispatchId>`. `dlv` shows a confirmation; only `dlvok` completes.
Private chats only. Every callback is authorized by the Telegram id against the dispatch's own company.

Linking: administrator runs `npm run taxi:invite -- "<company name>"` -> one-time code (10 chars, 24 h, SHA-256 stored,
older unused codes of that company revoked). The operator sends it to the taxi bot; redemption is a compare-and-swap,
a Telegram id can belong to one company, 5 failures / 15 min lock the account. Unknown/expired/used codes look the same.
`npm run taxi:link` (direct id) still works for local setups.

## Database
`20261026000100_taxi_statuses` (enum values ACCEPTED, DELIVERED) and `20261026000200_taxi_operator_bot`
(TaxiDispatch acceptedAt/By, dispatchedAt/By, deliveredAt/By; table TaxiOperatorInvite; widened active-dispatch index).
Additive; no data rewritten.

## Restaurant app
`GET /orders/:id` and the list now carry `taxi: {status, stage, companyName, acceptedAt, dispatchedAt, deliveredAt}` with
`stage` = SCHEDULED | REQUESTED | ACCEPTED | DISPATCHED | DELIVERED | NEEDS_HELP | CANCELLED. The detail screen shows a
progress card; the restaurant never requests a taxi. Completed orders appear under "Tarix".

## Tests
`npm run test:taxi` (workflow, pure) and `npm run test:taxi:db` (11 DB tests: linking, isolation, auto-dispatch, allowlist,
accept/dispatch/deliver, commission, reject/fallback, timeouts, failed delivery + restart, DB index, bot split). Telegram
is a local fake HTTP server; nothing is sent anywhere.
