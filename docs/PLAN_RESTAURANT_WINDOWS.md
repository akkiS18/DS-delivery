# Plan: DS Restaurant for Windows (.NET) — detailed

Status: PLAN ONLY (written 2026-11-06, detailed version). No code exists yet.
File: `docs/PLAN_RESTAURANT_WINDOWS.md` (repository root `C:\Users\Acer\Documents\DS`).
Audience: the developer (Gemini) who builds the app. Decisions of the owner are marked **[owner]**; things the builder may decide are marked **[builder]**.
Facts below were read from the phone app and the server code on 2026-11-06. Where a fact must be re-checked the file to open is named. If the code and this file disagree, **the code wins** — then tell the owner.

---------------------------------------------------------------------------------------------------

## 1. What and why
A desktop program for the restaurant's cash desk / kitchen PC. It works **together with the phone app**: same server, same restaurant account, same data.
Whatever is done on one device shows on the other; there is nothing to "sync" because the server is the only source of truth.

**[owner]** The finance section moves to the PC too, behind the same 4-digit code. The phone keeps finance as well.
**[owner]** UI language: Uzbek (Latin), same wording as the phone app. Professional, icon-based, readable from a metre away; no walls of small text.
**[owner]** The new-order ringtone is the owner's own recording (`new_order.mp3`, see section 14).

Non-goals for version 1: printing, multi-restaurant operator view, changing the finance code, any customer or taxi features.

## 2. Technology
- **[builder, default]** .NET 8 (LTS), C# 12, **WPF**. WinUI 3 only if you are sure about packaging; do not mix the two.
- MVVM with `CommunityToolkit.Mvvm`; DI with `Microsoft.Extensions.DependencyInjection`; HTTP with `HttpClient` + `System.Text.Json` (camelCase, case-insensitive, nullable-aware).
- Sound: `NAudio` (or `System.Windows.Media.MediaPlayer`). Tray: `H.NotifyIcon.Wpf` (or `Hardcodet.NotifyIcon.Wpf`).
- Token storage: Windows DPAPI (`ProtectedData`, scope CurrentUser) in `%LOCALAPPDATA%\DsRestaurant\session.bin`. Never plain text; never in logs.
- Logging: `Serilog` to `%LOCALAPPDATA%\DsRestaurant\logs`, rolling 5 MB × 3. Status codes and order ids only.
- Installer: per-user **Inno Setup** `Setup.exe` (no admin rights) or MSIX. Self-contained `win-x64` publish so the PC needs no .NET.
- Minimum OS: Windows 10 22H2. Test on Windows 11.
- Tests: xUnit + FluentAssertions; `RichardSzalay.MockHttp` for the API client.

## 3. Solution layout **[builder]**
```
DsRestaurant.sln
  src/DsRestaurant.Core/            no UI, no Windows APIs (unit-testable)
    Api/        RestaurantApi.cs (typed client), ApiErrors.cs, Dtos/*.cs
    Auth/       SessionStore (interface), AuthService
    Orders/     OrdersService, OrderPoller, NewOrderAttention (port), OrderActions
    Finance/    FinanceService, FinanceFormat, HistoryPeriod
    Common/     Result<T>, ServerClock, Money
  src/DsRestaurant.App/             WPF
    App.xaml(.cs)  SingleInstance.cs  Tray/  Audio/  Autostart/  Views/  ViewModels/  Resources/(new_order.mp3, icons, strings.uz.xaml)
  tests/DsRestaurant.Core.Tests/
  installer/  setup.iss
```
`Core` has an `IAlarmSink` (ring / stop), `ISessionStore`, `IClock` so the poller and the alarm rules are tested without WPF.

---------------------------------------------------------------------------------------------------

## 4. Server contract
Base URL is a setting. Use the address the phone app uses (see `ServerConfigDialog.kt` and the phone build config); staging is `https://staging.sultonxoja.uz`. The owner confirms the production address before a release build. HTTPS only; never disable certificate checks.
All restaurant endpoints: `{base}/api/v1/restaurant/…`. Send `Authorization: Bearer <accessToken>` on every call except login. Bodies are JSON. Dates are ISO-8601 UTC strings; show them in **Asia/Tashkent** (`TimeZoneInfo.FindSystemTimeZoneById("West Asia Standard Time")` on Windows is UTC+5, which equals Tashkent).
Reference DTOs: `apps/restaurant-android/app/src/main/java/com/dsdelivery/restaurant/data/api/dto/*.kt`; endpoints: `data/api/RestaurantApiService.kt`.

### 4.1 Auth
| Call | Body → Response |
|---|---|
| `POST auth/login` | `{slug, password}` → `{accessToken, tokenType, expiresAt, restaurant{…}}` |
| `GET auth/me` | → `{restaurant, session{expiresAt}}` (use at start-up to check the stored token) |
| `POST auth/logout` | → 204/200; always clear the local token afterwards, even if the call fails |

Errors: `401 INVALID_CREDENTIALS` (login) = wrong code/password. `403 RESTAURANT_INACTIVE` = restaurant suspended ("Restoran to‘xtatilgan. Administrator bilan bog‘laning."). `429` with `retryAfterSeconds` = too many tries.
Any **401 on another call** = the login expired or was revoked (the administrator can sign devices out): clear the token and show the login form. **Exception: the finance unlock call — see 4.4.**

### 4.2 Orders
`GET orders?filter={all|incoming|inProgress|toCook|ready|history|new|cooking|waiting|attention}&limit=20&cursor=` → `{orders[], nextCursor, counts{incoming,inProgress,ready,attention,new,cooking,waiting}}`.
The phone's work-queue tabs are: **Yangi** (`new`), **Tayyorlanmoqda** (`cooking`), **Tayyor** (`ready`), **Kutilmoqda** (`waiting`), **Tarix** (`history`). Use the same five tabs and show `counts` as badges.
`GET orders/{id}` → one `OrderDto`.

`OrderDto` (all fields beyond `id`, `status`, `totalSom`, `createdAt` may be missing on older servers: model them nullable):
`id, code, status, totalSom, serviceFeeSom, createdAt, estimatedPrepMinutes, items[{name,unitSom,quantity,subtotalSom}], payment{status,isTest,amountSom,cardLast4,method}, cash{amountSom,accepted}, taxi{status,stage,attemptNo,companyName,acceptedAt,dispatchedAt,deliveredAt}, taxiCompanyName, delivery{preference:TAXI|WALK_OK, mode:TAXI|SELF, selfDeliveredAt, location{lat,lng}}, customerName, customerPhone, addressText, isTest, rejectReason, restaurantDeadlineAt, allowedActions[], awaitingPaymentVerification, defaultPrepMinutes, paymentEvidence{…}, menuProblems[{kind,name}], refund{id,kind,status,reasonCode,requestedBy,paidAmountSom,approvedAmountSom,bankReference,hasReceipt,rejectReason}, attention[], serverNow, prep{minutes,startedAt,estimatedReadyAt,chosenMinutes}, paymentVerifiedAt, readyAt`.

`status` values and Uzbek titles (copy from `data/model/Order.kt`): WAITING_RESTAURANT "Yangi buyurtma", WAITING_CUSTOMER_CONSENT, CUSTOMER_CANCELLED, RESTAURANT_REJECTED "Rad etilgan", RESTAURANT_EXPIRED, PAYMENT_PENDING "To‘lov kutilmoqda", PAYMENT_EXPIRED, PAYMENT_MATCHED_UNVERIFIED "To‘lov keldi", PAYMENT_CONFIRMED "To‘langan", ACCEPTED, PREPARING "Tayyorlanmoqda", READY "Tayyor", TAXI_REQUESTED, DRIVER_ASSIGNED, DELIVERY_ASSUMED, COMPLETED "Yakunlangan", CANCELLATION_REQUESTED "Bekor qilish so‘rovi", CANCELLED, FAILED. Unknown value → show the raw text, never crash.
`payment.status`: QUEUED, AWAITING, MATCHED_UNVERIFIED, CONFIRMED_MANUAL, CASH_PENDING, CASH_ACCEPTED, EXPIRED, QUEUE_EXPIRED, CANCELLED. `payment.method`: CARD | CASH (cash = the taxi driver pays the restaurant the food total at pickup; show `cash.amountSom` prominently).

**The server decides which buttons exist: `allowedActions`.** Values: `ACCEPT, REJECT, VERIFY_PAYMENT, START_PREPARING, SET_PREP_TIME, MARK_READY, CANCEL_ORDER, REFUND_APPROVE, REFUND_REJECT, REFUND_SENT, SELF_DELIVERED` (+ `PROPOSE_PRICE`, removed — ignore it). Draw a button only for an action in the list. Never derive buttons from `status`.

Action calls (all `POST orders/{id}/…`, every body carries `expectedStatus` = the status the user saw, so a stale click fails with `409 STALE` instead of acting on something else):
| Path | Body |
|---|---|
| `accept` | `{prepMinutes?, expectedStatus}` |
| `reject` | `{reason, expectedStatus}` (reason is typed text, required) |
| `preparing` | `{prepMinutes?, expectedStatus}` |
| `prep-time` | `{minutes (5..60), expectedStatus}` — "ready in N minutes", chosen while cooking; this answers the "new" bell |
| `ready` | `{delivery: "SELF" \| null, expectedStatus}` — `SELF` only when `delivery.preference == "WALK_OK"` and the server lists the action |
| `delivered-self` | `{expectedStatus}` |
| `verify-payment` | `{confirmReceived: true, expectedStatus}` — the explicit statement that the money is on the restaurant's bank account. Show the `paymentEvidence` first; the mail/Telegram "signal" is **not** bank proof (`notBankProof`) |
| `cancel` | `{reason: "OUT_OF_STOCK"\|"CANNOT_FULFIL"\|"CLOSED"\|"OTHER", expectedStatus}` ("Mahsulot tugagan", "Bajara olmaymiz", "Restoran yopiq", "Boshqa sabab") |
| `refund/approve` | `{expectedStatus}` |
| `refund/reject` | `{rejectReason: "MONEY_NOT_RECEIVED"\|"ALREADY_PREPARED"\|"POLICY"\|"OTHER", expectedStatus}` |
| `refund/receipt?expectedStatus=` | raw JPEG body (`image/jpeg`), one bank-receipt photo. **If the restaurant is paid via the platform card the server answers 409 `REFUND_BY_PLATFORM`: the platform sends that refund itself — hide the button when `REFUND_SENT` is not in `allowedActions`.** |

Error codes the phone maps to Uzbek sentences (copy the table in `RestaurantRepositoryImpl.parseErrorMessage`, keys on the `error` field): `STALE`, `INVALID_STATE`, `TIMED_OUT`, `RESTAURANT_CLOSED`, `PAYMENT_EVIDENCE_INVALID`, `ORDER_PROBLEMS`, `REFUND_ALREADY_OPEN`, `NO_OPEN_REFUND`, `VERSION_CONFLICT`, `DUPLICATE_NAME`, `CATEGORY_NOT_EMPTY`, … ; 429 `TOO_MANY_ATTEMPTS`; network: no connection / timeout texts. After any 409 reload the order list. Show errors in plain Uzbek, never a stack trace or raw JSON.

**Server time:** every order has `serverNow`. Count down "tayyor bo‘lishiga N daqiqa" from `prep.estimatedReadyAt - serverNow` plus elapsed local time since the response arrived (`Stopwatch`), never from the PC clock (PC clocks are often wrong). Port the idea of `ServerClock` in `data/model/Order.kt`.

### 4.3 Operations, menu, cards, reservations, ratings (phase 2)
Endpoints (see `RestaurantApiService.kt` for exact shapes): `GET/PATCH operations/status` `{isPaused}`, `PUT operations/working-hours` `{days:[{dayOfWeek,isOpen,openTime,closeTime}]}`, `PATCH operations/prep-time` `{defaultPrepMinutes}`; `products` CRUD + `PATCH products/{id}/availability` + image `PUT/DELETE products/{id}/image`; `categories` CRUD + image; `cards` list/add/`/disable`/`/enable`; `reservations` list (`{settings,unseenCount,upcoming[],past[]}`), `POST reservations/{id}/seen|confirm-payment|cancel`, `PUT reservations/settings`; `GET ratings`.
Rules: the server may answer `409 VERSION_CONFLICT` (edited elsewhere) → reload and ask the user to repeat. Price edits are refused unless the restaurant is paused (`PRICE_EDIT_REQUIRES_PAUSE`) — show the sentence. Photos: resize to ≤ 1280 px, JPEG q80 before upload.

### 4.4 Finance (PIN-locked) — all new on 2026-11-05
| Call | Meaning |
|---|---|
| `GET finance/state` | `{hasPin, unlocked, unlockedUntil}` |
| `POST finance/unlock` `{"pin":"1234"}` | 200 `{unlocked:true, unlockedUntil}`. **403** `FINANCE_PIN_WRONG` `{attemptsLeft}`; **429** `FINANCE_PIN_BLOCKED` `{retryAfterSeconds}` (5 wrong codes in a row → 15 min); **409** `FINANCE_NO_PIN` (administrator has not issued a code yet); 400 bad body |
| `POST finance/lock` | 204 — closes the unlocked window |
| `GET finance/overview` | the main numbers (below). **423** `FINANCE_LOCKED` = code not entered or window expired |
| `GET finance/ledger?filter=all\|card\|cash&from=YYYY-MM-DD&to=YYYY-MM-DD&cursor=&limit=` | history, newest first. 423 as above; 400 `DATE_FILTER_INVALID` / `DATE_RANGE_TOO_LARGE` |

`overview` → `{collectsToPlatform, platformCard{…}, ownCard{…}, cash{…}, openRefunds{count,amountSom}}` where each source block has `orders, collectedSom, platformFeeSom, refundsSom, restaurantEarnedSom, feeSettledSom, feeRemainingSom, paidOutSom, remainingSom, inProgressOrders, inProgressSom` (a field that does not apply to a source is 0). Missing fields → 0.
`ledger` → `{totals{orders,collectedSom,platformFeeSom,refundsSom,restaurantEarnedSom,paidOutSom}, items[], nextCursor}`; item `kind: "INCOME"` → `{id, at, orderCode, source: "platform"|"own"|"cash", collectedSom, platformFeeSom, refundsSom, restaurantShareSom}`; item `kind: "PAYOUT"` → `{id, at, amountSom}`. `totals` cover the whole filtered range, not only the loaded page.

Rules the client must respect:
- **A wrong code is 403, not 401.** 401 means "login expired". The Android app once signed users out on a wrong code; do not repeat that: the unlock call must never trigger the "clear session on 401" handler.
- The unlocked window is **10 minutes, sliding**, tied to the login session; every successful finance call extends it. Lock (`POST finance/lock`) when the finance page is left and when the window is minimised/inactive for 2 minutes. On **423** show the code screen again and drop all numbers from memory.
- The code is issued by an administrator (DS Admin app → restaurant → "Moliya kodi", or bot `/financepin <restaurant-code>`), shown once, never stored in plain text. Changing it from the app is **not built — do not build it**. If `hasPin` is false show "Moliya kodi berilmagan. 4 xonali kodni administratordan oling."
- Keep the code only in memory while typing; clear it at once after the call. Never log it. Do not offer "remember the code".
- Show only backend numbers. The client may only format them and compute the progress-bar ratio.

---------------------------------------------------------------------------------------------------

## 5. The new-order alarm (the most important part)
A restaurant must never miss an order. This is how the phone does it (`data/alarm/OrderWatcher.kt`, `NewOrderAttention.kt`) and the PC must behave the same.

**Polling.** Every **5 seconds** call `GET orders?filter=new` (limit 20). One request at a time; 10 s timeout. After repeated failures back off to 30 s, return to 5 s after the first success. Every third round (~15 s) also call `GET reservations` and, for upcoming reservations that are not cancelled and (`seen == false` or `awaitingConfirm == true`), play a **softer notification** once per new reservation id (not the order ring).
**401 from either call** → stop ringing, stop polling, clear the token, show the login form (once ring a short warning tone so the user notices).

**"Needs the kitchen" = being in the server's `new` bucket.** The server decides: a payment to verify, a cash order not accepted yet, a "Shirin" manual-check order, or a paid order already cooking with no "ready in N minutes" chosen. Do **not** invent your own definition from `status`.

**Ringing rules** (port `NewOrderAttention` exactly, with its unit checks `unit-checks/TimeChecks.kt`):
- Feed the list of ids currently in the `new` bucket on every poll. Ring while at least one id is not silenced.
- "Sukut" (silence) mutes the orders waiting **now** for 30 s. An order that arrives meanwhile rings at once. When the 30 s end and an order is still waiting it rings again. An order that leaves the bucket is forgotten together with its silence.
- Ring cycle: play `new_order.mp3` once (cap one play at 15 s), pause 1.2 s, repeat, until nothing is ringing. **The phone then speaks "Yangi buyurtma"; the PC may do the same with the Windows speech synthesizer `System.Speech` (uz voice is usually missing → use the default voice or skip) — [builder] optional.**
- Answering on this PC **or on the phone** removes the id on the next poll; stop at once.
- Ring on the default output device at system volume; do not change the system volume. If no audio device / muted: show a red banner "Tovush o‘chiq — buyurtma eshitilmaydi" and keep the visual alert.

**Visual alert.** On a new id: bring the main window to the front (flash the taskbar button with `FlashWindowEx`) and show a card with code, items, total, **Qabul qilish / Rad etish** (only what `allowedActions` lists) and a big "Ovozni o‘chirish (30 s)" button. A tray balloon too if the window is hidden.

**Tray + autostart.**
- Closing the window (X) hides it to the tray; the process keeps polling. Tray menu: Ochish · Ovozni o‘chirish (30 s) · Chiqish. Exiting asks "Yangi buyurtmalar eshitilmaydi. Chiqilsinmi?".
- Setting "Windows bilan birga ishga tushsin" (HKCU `Software\Microsoft\Windows\CurrentVersion\Run`, value `DsRestaurant`, with `--minimized`): on by default after the first successful login; can be switched off.
- **Single instance** (named mutex + a pipe/message so the second start only brings the first window to the front).
- Keep the PC awake while ringing is possible: call `SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)` while logged in (the display may sleep).

**Both devices may ring for the same order.** Whoever answers first wins; the other gets `409 STALE` ("Buyurtma allaqachon o‘zgargan. Yangilandi.") — show it plainly and reload.

---------------------------------------------------------------------------------------------------

## 6. Screens (Uzbek texts; copy wording from the phone app where it exists)
Main window = left navigation rail with icons + labels: **Buyurtmalar**, **Bronlar** (phase 2), **Menyu** (phase 2), **Moliya**, **Sozlamalar**. Top bar: restaurant name, connection dot (green = last poll < 15 s ago, orange = retrying, red = offline), big mute/test button. Minimum window 1024×680, scales to full HD and 125–150 % DPI (use `UseLayoutRounding`, vector icons — Segoe Fluent Icons or `MahApps.Metro.IconPacks`).

1. **Login**: restaurant code (slug) + password + "Eslab qol". Wrong → "Restoran kodi yoki parol noto‘g‘ri." Suspended → "Restoran to‘xtatilgan…". No internet → "Serverga ulanib bo‘lmadi. Internetni tekshiring."
2. **Buyurtmalar**: five tabs (Yangi · Tayyorlanmoqda · Tayyor · Kutilmoqda · Tarix) with count badges; list of order cards (code, time ago, items summary, total, payment badge, delivery badge: taxi / "O‘zimiz yetkazamiz"); click opens the detail pane on the right (master–detail, no extra windows). Tarix pages with "Yana yuklash" (`nextCursor`).
3. **Order detail**: items table, customer name/phone/address, payment block (method, amount, card last 4; for `verify-payment` the evidence), taxi block (company, stage, times), refund block, prep timer, then the action buttons for `allowedActions`. Reject / cancel open a small reason picker. Prep-time picker: 5–60 min, quick buttons 10 · 15 · 20 · 30 · 45.
4. **Moliya**: see section 7.
5. **Sozlamalar**: server address (advanced, hidden behind "Server"), sound test + volume tip, autostart, "yopganda trayga yashirish", quiet/mute reminder, restaurant open/closed switch (phase 2), logout, version number, "Hisobotni yuborish" (copies the log folder path).

## 7. Finance screens (same design as the phone) **[owner]**
Gate: when entering Moliya call `finance/state`.
- `hasPin == false` → notice screen (see 4.4).
- not unlocked → **code pad**: lock icon, "Moliya kodi", "4 xonali kodni kiriting", four dots, 3×4 keypad (also accept the physical keyboard digits, Backspace, Enter-less: submits on the 4th digit). Busy spinner while checking. Wrong → "Kod noto‘g‘ri. Yana N marta urinish mumkin." Blocked → "Juda ko‘p xato kiritildi. N daqiqadan keyin urinib ko‘ring." Dots clear after each try.
- unlocked → **main page = CARD money only**:
  - Platform-card restaurant (`collectsToPlatform` or any platform-card money): block **"Platforma kartasi"**: big **"Sizga qoldi"** = `platformCard.remainingSom`, progress bar `paidOutSom / restaurantEarnedSom`, rows: "Siz ishlab topdingiz" (`restaurantEarnedSom`), "Platforma ishlab topdi" (`platformFeeSom`), "Sizga to‘lab berildi" (`paidOutSom`).
  - Own-card restaurant: block **"O‘z kartangiz"**: big **"Platformaga to‘lash kerak"** = `ownCard.feeRemainingSom`, progress `feeSettledSom / platformFeeSom`, rows: earned, platform earned (fee), "Platformaga to‘landi" (`feeSettledSom`).
  - Cash is **not** on the main page. One warning only: open refund requests ("Qaytarish so‘rovi: N ta" + amount).
  - Big button **"Jami"**, lock icon in the top bar (manual lock).
- **"Jami" page** (back arrow): period chips (Hammasi / Bugun / 7 kun / Shu oy; on a PC add a date-range picker with from/to), source chips (Hammasi / Karta / Naqd), totals card ("Siz ishlab topdingiz" big, then Buyurtmalar count, Platforma fee, and "To‘lab berildi" when > 0), then the list: income lines (order code, `dd.MM HH:mm`, source icon + label "Platforma kartasi" / "O‘z karta" / "Naqd", `+restaurantShare`, small "Platforma −fee") and payout lines ("Platforma to‘lab berdi", `+amount`), "Yana yuklash". Empty → "Bu davrda tushum yo‘q."
- Money counts from the moment the order is **delivered** (the server already does this); say nothing about it in the UI.
- Money text: `550 000 so‘m` (non-breaking space groups); 10 mln and above: `12,4 mln so‘m`; 1 mlrd and above `1,3 mlrd so‘m`; negative with a real minus `−`. Port `data/model/FinanceFormat.kt` and its checks `unit-checks/FinanceChecks.kt` 1:1.
- Day keys for the filters are **Asia/Tashkent** dates (`HistoryPeriod.range`, see `ui/screens/finance/FinanceUiState.kt`).
- Locking: leaving the page, minimising > 2 min, locking the PC (`SystemEvents.SessionSwitch`), or any 423 → wipe numbers from memory and show the code pad.

---------------------------------------------------------------------------------------------------

## 8. Networking details
- One `HttpClient` (reuse), `Timeout = 15 s` (polling uses a 10 s per-request CTS), `User-Agent: DsRestaurant/{version} (Windows)`.
- A `DelegatingHandler` adds the bearer token and maps responses to `ApiError(Status, Code, Message, RetryAfter)`; it clears the session on 401 **except** for `…/auth/login` and `…/finance/unlock`.
- Retries: none for POST actions (a double click must not double-send; disable the button while the call runs). GET polling retries by its own cadence.
- Parse unknown JSON fields leniently; unknown enum strings never throw.
- All DTOs have nullable/default members; a server older or newer than the app must not crash it.

## 9. Security and privacy
- DPAPI for the token; code only in memory while typing; HTTPS only; no certificate-validation overrides, even for staging.
- No analytics and no crash reporting with personal data. Customer phone numbers and addresses are never written to logs.
- Nothing from orders or finance is stored on disk (no cache of history). The only files: session token, settings (JSON), logs.
- Window title and tray tooltip never show money or customer data.
- Update check (phase 4): the app may ask a fixed HTTPS URL for a `version.json` and tell the user a new installer exists; it must never download and run code silently.

## 10. Test plan
**Unit (Core, no network):** `NewOrderAttention` (port every case in `TimeChecks.kt`: nothing waiting → silent; new rings; silenced → quiet; arrival during silence rings; silence over rings again; left bucket forgotten; comes back = new); `FinanceFormat` (all cases of `FinanceChecks.kt`); `HistoryPeriod.range` with Tashkent dates around midnight and month start; error mapping (401 vs 403 vs 409 vs 423 vs 429 incl. the unlock exception); DTO parsing with missing fields; poller back-off (fake clock).
**Integration (MockHttp):** login → poll → new id appears → ring → accept → id gone → stop; 401 during poll stops everything; finance unlock wrong/blocked/no-pin/ok; 423 mid-session wipes numbers.
**Manual on the staging server (checklist for the owner):**
1. Make a test order → rings within 5 s; accept on the phone → PC stops within one poll.
2. Hide to tray, wait 10 min, new order → window pops and rings.
3. Pull the network cable 1 min → red dot, no crash, recovers.
4. Windows sign-out / sign-in → autostart works, single instance holds.
5. Mute PC → red banner. Unplug speakers → banner.
6. Finance: no code → notice; wrong code ×5 → blocked text; correct → numbers equal the phone's; minimise 3 min → locks; lock PC → locks.
7. Administrator signs the device out → login form appears; no ghost ringing.
8. 150 % DPI, small laptop 1366×768.

## 11. Phases, tasks and acceptance
**Phase 0 — skeleton (½ day).** Solution, DI, API client with login/me/logout, DPAPI session store, logging, single instance, tray with Open/Exit.
*Done when:* login works against staging, restart keeps the session, wrong password shows the right text.

**Phase 1 — MVP: orders + alarm (core).** Poller, `NewOrderAttention` port, alarm player, visual alert, orders tabs + detail + all actions of 4.2, autostart, settings (sound test, autostart, tray behaviour), connection dot, installer.
*Done when:* the manual checklist items 1–5, 7, 8 pass and the unit tests above are green; nothing sensitive is in the logs; a 24-hour soak (app in the tray, ordering every ~30 min) has no crash and memory stays flat (< 150 MB).

**Phase 2 — Operations.** Open/closed + prep time + working hours; menu (availability toggle first, then edit/create/delete, categories, photos); cards; reservations (+ their soft alert); ratings.
*Done when:* every change made on the PC shows on the phone after its next refresh and vice versa; `VERSION_CONFLICT` and `PRICE_EDIT_REQUIRES_PAUSE` show their Uzbek texts.

**Phase 3 — Finance (PIN).** Section 7.
*Done when:* checklist item 6 passes and numbers equal the phone app's for the same restaurant on the same day.

**Phase 4 — Polish and release.** Icon set, app icon, version resource, signed installer (the owner decides about a code-signing certificate; without it SmartScreen warns), optional update notice, Uzbek text review by the owner.

After each phase deliver a note: what works, what was **not** tested, the exact build/test commands, and the list of server calls used. Do not claim a phase complete if an acceptance line was not checked.

## 12. Rules from the server side that the UI must not break
- Taxi acceptance is not delivery. The restaurant says "Tayyor"; the system dispatches a taxi. Only the **walking** option ("O‘zimiz yetkazamiz", only for restaurants the owner enabled, only when the customer allowed it) lets the restaurant press "Yetkazildi" (`delivered-self`), and only when `allowedActions` lists it.
- Payment confirmation happens only through `verify-payment` with the explicit confirmation. Real online payments stay disabled by default; the client must not try to enable anything.
- A refund the platform sends itself is not sent by the restaurant (no receipt upload for it).
- Test orders carry `isTest: true` — mark them "TEST" visibly and never count them anywhere.

## 13. Open questions for the owner (do not guess)
1. Production server address and whether staging may be selectable in release builds.
2. Printing (receipt / kitchen ticket): which printer, which paper width.
3. Code-signing certificate for the installer.
4. Should the PC speak "Yangi buyurtma" like the phone? (The phone does after the ringtone.)
5. Changing the finance code from the app/PC: explicitly **later**.
6. Does one restaurant use several PCs at once? (Allowed technically: each login is its own session and has its own finance unlock.)

## 14. Files and assets
- Ringtone: `apps/restaurant-android/app/src/main/res/raw/new_order.mp3` (owner's recording; copy into `DsRestaurant.App/Resources/`). Keep the file's original length; the app caps one play at 15 s.
- Phone app (same behaviour and wording): `apps/restaurant-android/app/src/main/java/com/dsdelivery/restaurant/`
  - API + DTOs: `data/api/`, `data/api/dto/` (finance: `FinanceOverviewDtos.kt`)
  - Alarm: `data/alarm/NewOrderAttention.kt`, `OrderWatcher.kt`, `AlarmPlayer.kt`
  - Orders UI: `ui/screens/orders/`, models `data/model/Order.kt`
  - Finance UI: `ui/screens/finance/`; money text `data/model/FinanceFormat.kt`; checks `apps/restaurant-android/unit-checks/`
- Server: `src/modules/restaurant-orders/` (buckets in `service.ts`), `src/modules/restaurant-finance/` (`pin.ts`, `overview.ts`, `routes.ts`), `src/modules/restaurant-auth/`; DB tests `src/tests/finance-pin-overview.db.test.ts`.
- Product guidance: `docs/ROADMAP.html`; restaurant staff guide: `docs/QOLLANMA_RESTORAN_XODIMLARI.html`.
