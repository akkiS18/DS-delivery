# Pending manual tests (one batch, one install)

Living list. Everything here needs a person with a phone/Telegram. **One batch = the two APKs below, installed once.** No new APK is shipped while a batch is open unless something blocks it; fixes found are collected and shipped together afterwards. Newly built features add items at the bottom of the matching section.

Last updated: 2026-10-23 (after Stage 8C code). **A NEW pair of APKs is needed for §H** (cards screen, legal links, new error texts) — built once after the code is complete.

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

## H. New in Stage 8B/8C (needs the new APKs and the new backend on staging; staging stays MOCK)
Admin commands work only for the support admins (SUPPORT_ADMIN_1/2 in the staging config), and only in the bots the STAGING backend polls: customer bot `@ziadin_food_order_bot`, taxi bot `@S18platformbot`. The new `@ds_dostavka_bot` / `@ds_taxi_panel_bot` belong to production and do not answer until it exists. Each admin must press /start in the staging customer bot once. For the card and money tests the staging backend must run the new release; REAL payments themselves are NOT tested on staging (runbook §5 on the production stack).

| # | Steps | Expected |
|---|---|---|
| H1 | Restaurant APK → Operatsiyalar → **To‘lov kartalari** → Karta qo‘shish: type a made-up 16-digit number with a typo, then a valid one (e.g. any Luhn-valid test number) + the account password | Typo: red hint, button disabled. Valid: card appears as "Administrator tasdig‘i kutilmoqda", masked `**** **** **** NNNN`; full number never shown again |
| H2 | Wrong account password in the same dialog | "Parol noto‘g‘ri"; the app stays signed in |
| H3 | Telegram (customer bot, as admin): the pending card arrives with the FULL number and two buttons | Message within ~10 s; "Tasdiqlash" asks "Ha, aniq tasdiqlayman" first; "Rad etish" rejects at once |
| H4 | Approve → app list (pull to refresh / reopen) | "Faol", switch on; switch off → "O‘chirilgan"; on again → "Faol" |
| H5 | Reject a second card → submit the SAME number again | Rejected status shown; resubmission accepted (back to pending, a new Telegram message) |
| H6 | Add 3 pending cards quickly | Third refused ("Tasdiq kutayotgan kartalar bor…") |
| H7 | Try a number whose last 4 digits another restaurant uses | "oxirgi 4 raqami band" |
| H8 | `/admin` as you; `/admin` from a non-admin account | Command list for you; **no answer** for others |
| H9 | `/cards` | List of all cards with statuses; pending ones re-sent with buttons |
| H10 | `/money` with nothing unmatched | "Mos kelmagan yoki kutayotgan pul yo‘q" (real mail cases are runbook §5 R3/R4) |
| H11 | Customer APK/Mini App: place a MOCK order, leave it unpaid, place a second, then a third | Works on staging (MOCK is unlimited); on production REAL the 3rd is refused with "To‘lanmagan buyurtmangiz bor" |
| H12 | Customer APK → Profil → **Maxfiylik siyosati** / **Foydalanish shartlari** | Opens the browser; shows the text if `LEGAL_OPERATOR_NAME/CONTACT` are set on staging, otherwise "Hujjat hali tayyor emas" |
| H13 | Link the restaurant's staff Telegram (`link-staff` on the server with your id), place a MOCK order and pay | One "🧪 SINOV … buyurtma to‘landi" alert in Telegram per order, no repeats |
| H14 | `/restaurants` → suspend the demo restaurant (two taps) | The restaurant APK is signed out and cannot sign in; customers cannot order; resume restores it. **Resume it afterwards** |
| H15 | `/commission` | Statement (or "To‘lanmagan komissiya yo‘q"); a real settlement is rehearsed on production (R10) |
| H16 | Restaurant APK: pause / working hours / prep time screens | No more "serverga hali saqlanmaydi" notes; values are saved |
| H17 | (Stage 8D, production rehearsal R1) Real money: order, pay the exact amount | No admin or restaurant tap: the order confirms itself, cooking starts, the customer sees "to‘lovingiz qabul qilindi"; only wrong/late/odd money reaches `/money` |
| H18 | (Stage 8D) Staging stays MOCK, so MOCK orders confirm themselves as before; the "fallback" (`GMAIL_AUTO_CONFIRM=false`) is proven on production as R11 | MOCK flow unchanged |
| H20 | (Stage 9, staging customer bot as admin) `/admin` lists /newrestaurant, /resetpassword, /linkstaff, /payments. `/newrestaurant Test Oshxona | Chilonzor 1 | +998901234567` → login code + one-time password; sign in to the restaurant app with them; `/resetpassword <kod>` signs the app out; `/payments` on STAGING | Restaurant is created paused; password works once reset invalidates the old one; `/payments` says "Bu test serveri: kalit faqat production serverda ishlaydi." (the real door is exercised on production in R1) |
| H19 | (Restaurant app UI pass 2026-10-23, needs the NEW restaurant APK; not compiled/run when written) Walk every tab: Buyurtmalar, Menyu, Moliya, Sozlamalar; add a card (type 16 digits: the cursor must stay at the end and spaces appear by themselves); open an order; open Toifalar and the product form | No English/developer words (Stage, slug, VERSION_CONFLICT, Server sozlamasi, Demo); tab names equal screen titles; Sozlamalar order = Qabul, To‘lov kartalari, Tayyorlash vaqti, Ish vaqti, Hisob; no "please verify the payment" wording unless the manual fallback is active; texts short |

## I. Infrastructure steps (done by the assistant with the owner's go, in this order; see docs/RUNBOOK_PRODUCTION.md)
1. Package + deploy the new release to staging, check migrations (5 new) and `/health/ready`.
2. Staging → shared edge proxy cutover (one blip), uptime monitor stays green.
3. Production bring-up IP-locked; first start refuses REAL without `CONFIRM_REAL_PAYMENTS` (guard test), then the switches.
4. Backups: dump + receipts + Gmail archive, `restore-check.sh` PASS, encrypted offsite copy decrypted on the PC.
5. Release-signed APKs installed from files (not Play): customer, restaurant.
6. Real-money rehearsal R1–R10 (owner's cards).

## F. Still open without a phone (not yet run)
- Real Telegram duplicate-polling (409) test — deliberately not provoked (it would take the live bot down).
- Gmail / REAL payments, bank terms, a real restaurant/operator — out of scope until approved. Plan and rehearsal list: `docs/STAGE_8A.md` (Gmail health/alert code of 8A-1 has only unit tests; it needs a real mailbox on the production stack).
- Push notifications — not implemented. Admin APK — not planned (Telegram admin for the pilot).
- Long soak (days) and load beyond the 50-customer burst of Stage 7C-QA.

## G. Already verified (do not repeat)
Server side, on staging, over HTTPS: guest/Telegram auth paths, MOCK checkout, backend restart mid-order with checkout replay, database outage during checkout (no ghost order, recovery without restart), SIGTERM, reboot, rollback, backups + disposable restore drill (35 tables identical, 20 migrations) and receipt archive integrity, receipt upload/download chain (`smoke-staging-receipt.mjs`, `smoke-staging-resilience.mjs`), edge allowlist and forged headers, watchdog alert/recovery, Telegram linking, Mini App served by the backend, taxi chain to DELIVERED, restaurant APK login and polling (2026-10-22).
