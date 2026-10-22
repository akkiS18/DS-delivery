# Pending manual tests (one batch, one install)

Living list. Everything here needs a person with a phone/Telegram. **One batch = the two APKs below, installed once.** No new APK is shipped while a batch is open unless something blocks it; fixes found are collected and shipped together afterwards. Newly built features add items at the bottom of the matching section.

Last updated: 2026-10-22 (after Stage 7D).

## 0. Setup (once)
- APKs (`C:\Users\Acer\Documents\DS-backups\apk\`): customer `ds-customer-staging-debug-20261022-1954-receipt.apk`, restaurant `ds-restaurant-staging-debug-20261022-1954-receipt.apk`. Uninstall older versions first.
- Phone must come from an allowlisted IP (home Wi-Fi = already). For mobile data: open `https://api.ipify.org` on the phone and give me the IP.
- Press `/start` in `@ziadin_food_order_bot` and `@S18platformbot`.
- Restaurant APK login: `demo-restoran` + the password you set. Wrong password: at most 4 tries (5 locks the account for a while).
- Taxi operator = you (your own Telegram id); old test dispatches for orders #1/#2 may send you "needs help" messages: ignore.
- You are the support/taxi admin (`SUPPORT_ADMIN_1`, `TAXI_ALERT_TELEGRAM_ID` set to your id on 2026-10-22). A **second** equal admin needs a second person's Telegram id (not set).

## A. Customer APK (guest)
| # | Steps | Expected |
|---|---|---|
| A1 | First launch, open restaurant, search, open menu | No login asked; restaurant and products visible; search filters |
| A2 | Add/remove items, close and reopen the app | Cart is kept |
| A3 | Profile: add, edit, delete address; set default; set phone | Saved; keyboard does not hide buttons |
| A4 | Checkout with bad phone / empty address | Clear validation message, no order |
| A5 | Checkout → "Sinov to'lovi" | Status moves on by itself (paid → cooking); countdown shown |
| A6 | Cancel an **unpaid** order | Cancelled at once, no refund |
| A7 | Cancel a **paid** order (customer side) | "Refund request" status; waits for the restaurant |
| A8 | After the restaurant sent the refund with a photo (B5) | "Qaytarish chekini ko'rish" shows the photo; closing works |
| A9 | Profile → Telegramga bog'lash → confirm in bot and in the app | Linked; old orders stay; reinstall + link again restores orders |
| A10 | Back button (sheet → page → home → exit), screen rotation, keyboard, safe area | Sane navigation, nothing hidden |
| A11 | Airplane mode / kill the app mid-request | Error with "Qayta urinish"; recovers when online |
| A12 | Same flow on **mobile data** (needs IP) | Works |
| A13 | Restaurant paused/closed (B8) | Customer sees closed; cannot order |

## B. Restaurant APK
| # | Steps | Expected |
|---|---|---|
| B1 | Login (right/wrong password), kill app, reopen, logout | Wrong = clear error; session survives restart; logout works |
| B2 | A new customer order appears | Visible within the polling interval, correct items/total/address |
| B3 | MOCK order: cooking starts by itself; press "Tayyor" | Ready recorded once; double tap harmless |
| B4 | Cancel a paid order (reason) | Refund opens already approved |
| B5 | "Pul qaytarildi" → pick a **photo** of any receipt → send | Refund SENT; "Bank cheki rasmi yuklangan"; a second photo is refused; photo not rotated; large camera photos work |
| B6 | Customer cancellation request (A7): approve once, reject once | Statuses follow; reject restores the order |
| B7 | Catalog: create/edit/delete category and product, change price, toggle availability | Changes show in the customer app; old orders keep old prices; (no photo upload exists) |
| B8 | Operations: pause restaurant, working hours, default prep time | Customer app reacts (A13); prep time used for the next order |
| B9 | Finance screen | Opens; MOCK orders produce no commission |
| B10 | Server dialog, offline errors | Staging URL is the default; errors have retry |

## C. Taxi operator bot (`@S18platformbot`)
| # | Steps | Expected |
|---|---|---|
| C1 | Order paid → request arrives (~1 min with the 8-min prep time) | Message with pickup/delivery data, MOCK warning |
| C2 | Qabul qilish → "Taksi yuborildi" → "Yetkazildi" + confirm | Each step once; customer notices arrive (linked customer) |
| C3 | "Taksi yo'q" / decline | Order marked as needing help; customer told; no automatic second taxi without consent rules |
| C4 | Ignore a request | Timeout → needs-help flow; admin alert reaches you |
| C5 | Press an old button twice / from another account | Second press harmless; stranger refused |

## D. Telegram admin (support + taxi admin)
| # | Steps | Expected |
|---|---|---|
| D1 | `/support` from a customer: open a ticket, send messages | Ticket created; you (admin) are notified |
| D2 | As admin: reply, take, close | Customer receives replies; states audited |
| D3 | `/taxiadmin`: recover a stuck dispatch (needs-help order) | Only after an explicit attestation; one active dispatch per order |
| D4 | Refund dispute: customer presses "not received" in the bot, admin confirms with a ≥10-char note | CONFIRMED by ADMIN only with the note |
| D5 | Two equal admins | **Blocked** until a second Telegram id is provided |

## E. Telegram Mini App (menu button of `@ziadin_food_order_bot`)
| # | Steps | Expected |
|---|---|---|
| E1 | Open from the menu button and `/app` | Loads from `staging.sultonxoja.uz/app/`; restaurants visible |
| E2 | Full order incl. MOCK payment, cancel, refund receipt viewer | Same as A; Telegram Back button works; theme/dark mode fine |
| E3 | Order from the Mini App and from the APK with the **same Telegram account** | One customer profile, one history |

## F. Still open without a phone (not yet run)
- Real Telegram duplicate-polling (409) test — deliberately not provoked (it would take the live bot down).
- Gmail / REAL payments, bank terms, a real restaurant/operator — out of scope until approved. Plan and rehearsal list: `docs/STAGE_8A.md` (Gmail health/alert code of 8A-1 has only unit tests; it needs a real mailbox on the production stack).
- Push notifications — not implemented. Admin APK — not planned (Telegram admin for the pilot).
- Long soak (days) and load beyond the 50-customer burst of Stage 7C-QA.

## G. Already verified (do not repeat)
Server side, on staging, over HTTPS: guest/Telegram auth paths, MOCK checkout, backend restart mid-order with checkout replay, database outage during checkout (no ghost order, recovery without restart), SIGTERM, reboot, rollback, backups + disposable restore drill (35 tables identical, 20 migrations) and receipt archive integrity, receipt upload/download chain (`smoke-staging-receipt.mjs`, `smoke-staging-resilience.mjs`), edge allowlist and forged headers, watchdog alert/recovery, Telegram linking, Mini App served by the backend, taxi chain to DELIVERED, restaurant APK login and polling (2026-10-22).
