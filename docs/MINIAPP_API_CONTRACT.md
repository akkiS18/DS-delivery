# Telegram Mini App — backend API contract (implemented in Stage 7A)

Base path `/api/v1/miniapp`. Source: `src/modules/miniapp/routes.ts` (thin HTTP layer) over the same `placeOrder` / `validateCheckout` /
refund / payment code the bot uses. There is **no parallel checkout logic**.

## Authentication (every route)
`Authorization: tma <initData>` — the raw `Telegram.WebApp.initData` string.
- Server recomputes the HMAC (`secret = HMAC_SHA256("WebAppData", BOT_TOKEN)`, over the sorted `key=value` lines without `hash`) and compares in constant time.
- `auth_date` must be no older than `MINIAPP_AUTH_MAX_AGE_SECONDS` (default 86400) and not in the future.
- The customer is the **signed** `user.id`. No body, query or header names a customer. `initDataUnsafe` is never used.
- Any failure is a uniform `401 {"error":"UNAUTHORIZED"}` (no oracle for which check failed).
- Rate limits (in-memory, single process): per IP 240/min, per user 120/min, order creation `MINIAPP_ORDER_RATE_PER_MINUTE` (10), cancel 10, profile writes 30, mock-pay 20, plus a failed-auth bucket per IP. `429` carries `Retry-After`.
- Bodies are strict: unknown fields are `400 {"error":"Validation failed","details":[…]}`.

## Endpoints
| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/config` | `{ paymentMode, mockPaymentAvailable, currency }` |
| GET | `/me` | profile: `{ phone, displayName, addresses[], defaultAddressId, lastUsedAddressId }` |
| PUT | `/me/phone` | `{ phone }` (normalised to `+998XXXXXXXXX`) |
| GET/POST | `/me/addresses` | list / create `{ label, addressText, lat?, lng?, makeDefault? }` (max 10) |
| PUT/DELETE | `/me/addresses/:id` | edit / delete (own addresses only; foreign id = 404) |
| POST | `/me/addresses/:id/default` | set the single default (partial unique index) |
| GET | `/restaurants?q=` | active restaurants with `isOpen`, `closedReason` (`PAUSED`\|`HOURS`), `opensNext`, `prepMinutes` |
| GET | `/restaurants/:id/menu` | categories + products (current prices, availability) |
| POST | `/quote` | price/availability/hours preview; creates nothing |
| POST | `/orders` | create the order (idempotent by `checkoutKey`) |
| GET | `/orders`, `/orders/:id` | own orders only |
| POST | `/orders/:id/cancel` | unpaid: cancel; paid: refund request |
| POST | `/orders/:id/mock-payment` | MOCK mode only, never in production |

Working hours are evaluated in the **restaurant's IANA timezone** (`Restaurant.timezone`, default `Asia/Tashkent`); empty hours = always open.

### POST /quote
```json
{ "restaurantId": "…", "items": [{ "productId": "…", "quantity": 2 }] }
```
`{ ok:true, lines:[{productId,name,unitSom,quantity,subtotalSom}], totalSom, estimatedPrepMinutes }` or `{ ok:false, issues, lines, totalSom }`;
issue kinds `RESTAURANT_UNAVAILABLE`, `RESTAURANT_CLOSED{opensNext}`, `PRODUCT_UNAVAILABLE`, `PRICE_CHANGED`, `TOTAL_CHANGED`, `TOTAL_TOO_LARGE`.

### POST /orders — `checkoutRequestSchema`
```json
{
  "checkoutKey": "uuid",
  "restaurantId": "…",
  "items": [{ "productId": "…", "quantity": 2 }],
  "expectedTotalSom": 90000,
  "expectedUnitPrices": { "<productId>": 45000 },
  "addressId": "…",                       // XOR
  "address": { "label": "Uy", "addressText": "…", "lat": 41.3, "lng": 69.2, "save": true },
  "phone": "+998901234567"                // optional when already stored
}
```
- **Exactly one** of `addressId` / `address`. **There is no taxi field**: the customer never chooses a company; assignment is automatic.
- `checkoutKey` is idempotent: a retry returns the first order (`200`, `replayed:true`); a key owned by another customer is `409 CHECKOUT_KEY_BEGONA`.
- Prices are frozen from the database at creation. A stale `expectedTotalSom`/`expectedUnitPrices` is refused.
- `201 { order: OrderView, replayed:false }`. The order is **created unpaid** (`PAYMENT_PENDING`); cooking starts only after payment verification.
- A refused checkout stores nothing (no phone, no address). The address/phone are remembered only after the order exists.

| HTTP | error | meaning |
| --- | --- | --- |
| 409 | `NARX_OZGARGAN` | `details:{issues,currentLines,currentTotalSom}`; show the new total and let the customer confirm again; nothing was created |
| 409 | `MAHSULOT_MAVJUD_EMAS` | `details.issues[PRODUCT_UNAVAILABLE]` |
| 409 | `RESTORAN_BUYURTMA_QABUL_QILMAYDI` | restaurant paused/inactive |
| 409 | `RESTORAN_YOPIQ` | outside working hours; `details.issues[RESTAURANT_CLOSED{opensNext}]` |
| 409 | `RESTORAN_OLIB_KETISH_MANZILI_YOQ` | REAL only: restaurant pickup address missing |
| 409 | `TAKSI_XIZMATI_MAVJUD_EMAS` | no reachable taxi company (nothing created, nothing charged) |
| 400 | `PHONE_REQUIRED`, `BUYURTMA_SUMMASI_JUDA_KATTA`, `Validation failed` | |
| 401 | `UNAUTHORIZED` | |
| 429 | `RATE_LIMITED` | `Retry-After` |

### OrderView (GET /orders/:id, order responses)
`serverNow` (ISO, the only clock the client trusts), `id`, `number`, `status`, `stage` (customer-facing: `PAYMENT_PENDING`, `PAYMENT_CHECKING`,
`PREPARING`, `READY`, `TAXI_REQUESTED`, `TAXI_ACCEPTED`, `TAXI_SENT`, `DELIVERED`, `CANCELLATION_REQUESTED`, `CANCELLED`, `EXPIRED`, `NEEDS_HELP`),
`restaurantName`, `items[]`, `foodTotalSom`, `delivery:{feeSom:null,note:'TAXI_TARIFF'}` (**no delivery price is ever invented**), `address`, `phone`,
`isTest`, `payment:{status,amountSom,mode,queued,instructions}`, `prep:{minutes,startedAt,estimatedReadyAt,readyAt,remainingSeconds,overdueMinutes,isOverdue}`,
`readyAt`, `taxi:{stage,companyName}|null`, `deliveredAt`, `cancel:{allowed,kind:'UNPAID'|'REFUND_REQUEST'|null}`, `refund:{status}|null`.

`payment.instructions` (while awaiting payment): `{ cardLast4, isTest, cardNumber, recipientUnavailable, expiresAt }`.
In **REAL** mode `cardNumber` comes **only from operator configuration**; when it is not configured, `cardNumber:null` and `recipientUnavailable:true` and the app tells the customer **not to pay**.
In MOCK mode the number is a test card and `mockPaymentAvailable` enables the test button.

`PREPARING` never becomes `READY` by itself: after `estimatedReadyAt` the client shows `Kechikish: N daqiqa` (growing) until the restaurant presses READY.
"Taxi accepted" is not "taxi sent", and only the operator-confirmed `DELIVERED` means delivered.

### POST /orders/:id/cancel
`{ "reasonCode": "CHANGED_MIND" | "TOO_SLOW" | "WRONG_ORDER" | "OTHER" }` (optional, strict; **no bank/card fields**).
- Unpaid → `CANCELLED`, the open payment attempt is cancelled, no refund exists.
- Paid → a refund **request** (`CANCELLATION_REQUESTED`); the app says "requested", never "refunded". The restaurant decides and records its own bank reference.
- Otherwise `409 NOT_CANCELLABLE`. Another customer's order is `404 NOT_FOUND` (indistinguishable from a missing one).
