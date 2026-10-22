# Stage 6E — Restaurant APK independence, duplicate-notification fix, simpler workflow

Three interfaces: **customer Telegram bot**, **restaurant Android APK**, **taxi operator Telegram bot**.

## 1. Duplicate notifications (order #645)
Facts for #645 in `ds_delivery_test`: one `TAXI_DRIVER_SENT` OrderEvent and one `DELIVERY_CONFIRMED` OrderEvent, one dispatch row,
one `COMPLETED` transition - the state changed exactly once. The Telegram account that placed the order was also the
`staffTelegramUserId` of the restaurant. `notifyOutcomes` (taxi worker) sent each outcome text to the customer chat AND to the staff
chat, and both are the same chat id, so every event arrived twice (`customerNotifiedAt` and `staffNotifiedAt` were set 0.3 s apart).
It was never a duplicate transition, worker race or retry.

Fix (durable, not cosmetic): table `NotificationLog` with a unique `dedupeKey = kind:event:...:chatId` (the destination CHAT, not the
role). `sendOnce` = insert key -> claim a 60 s lease by compare-and-swap -> send -> mark `sentAt`; outcomes SENT / ALREADY_SENT /
IN_FLIGHT / FAILED / GAVE_UP (8 attempts). Used by the taxi outcome notices and admin alerts, the restaurant-notifier customer
notices (status, price consent) and the legacy staff notice. Holds across concurrent workers, retries and restarts (even if the
in-row `*NotifiedAt` markers are reset). Residual risk (Telegram cannot give exactly-once): a crash between a successful send and the
`sentAt` write repeats a message once after the lease expires. Staff are no longer notified through Telegram at all (below).

## 2. Restaurant Telegram panel is OFF
`RESTAURANT_TELEGRAM_ENABLED` (default **off**; only the literal `true` enables the legacy panel for rollback).
Off: no staff order notices, no `/staff`, no `/refunds`, every old `staff:*` and restaurant `refund:*` button answers a clear
"managed in the app" message and changes nothing, staff refund notices skipped. Always on: customer bot, `/myid`, taxi bot, support.
Staff accounts, links, sessions and audit rows are untouched. The code stays behind the flag.

## 3. Everything the restaurant did in Telegram now exists in the app (`/api/v1/restaurant`, session identity only)
| Function | Endpoint | Shared service |
| --- | --- | --- |
| accept / reject | `POST /orders/:id/accept`, `/reject` | `acceptOrder`, `rejectOrder` |
| verify real bank credit | `POST /orders/:id/verify-payment {confirmReceived:true}` | `takeStaffAction(VERIFY_PAYMENT)` |
| price change proposal | `POST /orders/:id/propose-price` | `proposePriceRevision` (customer consents in the customer bot) |
| start / ready | `POST /orders/:id/preparing`, `/ready` | `takeStaffAction` |
| cancel a paid order | `POST /orders/:id/cancel {reason}` | `requestCancellation(RESTAURANT_STAFF)` |
| decide customer's refund request | `POST /orders/:id/refund/approve`, `/refund/reject` | `decideRefund` |
| record refund sent | `POST /orders/:id/refund/sent {bankReference}` | `markRefundSent` |
Order detail adds `paymentEvidence`, `priceChange`, `priceProposal`, `refund`, `attention[]`, `defaultPrepMinutes`.
Audit: `paymentVerifiedBy`, `acceptedBy`, `proposedBy`, refund actors are `restaurant-api:<restaurantId>`; OrderEvent `details.channel` =
`APP` | `TELEGRAM` | `SYSTEM`.

Payment rules (unchanged in substance): Gmail only ever produces `MATCHED_UNVERIFIED`; verification needs the restaurant's explicit
`confirmReceived:true`; the stored signal must still match amount/sender/link; a real payment is never confirmed by automation
(the system actor is refused for any non-test payment). The app labels the signal "not bank proof".

## 4. One preparation time, automatic MOCK flow, exceptions
- Prep minutes are optional everywhere and range 5..120; default = `Restaurant.defaultPrepMinutes`. Asked once at acceptance (pre-filled,
  optional +/- override); cooking reuses it - no second dialog.
- MOCK/test: after the safe MOCK payment (customer button, or the 7 s sweep for restart safety) the order is verified by the system actor
  and cooking starts by itself. Taxi dispatch is then scheduled automatically as before.
- REAL: only AFTER the restaurant's explicit verification does cooking start automatically.
- READY is never automatic. Exceptions the app shows as "E'tibor talab qiladi": payment awaiting verification, price changed / menu
  problem, cancellation request, refund to send, automatic start failed (manual start button), taxi needs help.

## 5. Android notifications
No Firebase credentials exist, so there is no push. Implemented: foreground polling every 15 s (`OrdersViewModel`, only while the UI is
visible and the session valid), badge on the Orders tab (new + attention), an in-app message, and a local system notification when the
permission is granted. Each order id is announced once (remembered across restarts). Background delivery is NOT guaranteed.
Future FCM: create a Firebase project, add `google-services.json`, store a device token per restaurant session, send from the server on
`WAITING_RESTAURANT`/attention transitions. Not built, not claimed.

## 6. Migrations
`20261027000100_notification_log` (additive table). Earlier 6D migrations unchanged.

## 7. Tests
`test:taxi:db` (#645 regression, concurrent workers, failed delivery/lease), `test:orders:db` (verify, default prep, price consent,
refund API), `test:telegram:db` (panel off, MOCK auto-advance), plus the whole existing suite.
