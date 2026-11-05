# Plan: DS Taxi for Windows (.NET) — detailed

Status: PLAN ONLY (written 2026-11-06). No code exists yet.
File: `docs/PLAN_TAXI_WINDOWS.md` (repository root `C:\Users\Acer\Documents\DS`).
Audience: the developer (Gemini) who builds the app. It is the sibling of `docs/PLAN_RESTAURANT_WINDOWS.md` — **read that file first**: the solution layout, tray, autostart, single instance, DPAPI storage, logging, installer, sound player and test tooling are the same and are NOT repeated here; this file lists what is different.
Owner rule **[owner]**: the PC app has **exactly the same functions as the phone app (DS Taxi)**; only the look is desktop-style (big window, mouse + keyboard, several things visible at once).
Facts below were read from the phone app (`apps/taxi-android`) and the server (`src/modules/taxi-app`) on 2026-11-06. If the code and this file disagree, **the code wins** — then tell the owner.

---------------------------------------------------------------------------------------------------

## 1. What it is
A dispatcher's desk program for a **taxi company operator**. When a restaurant order needs a taxi, the system sends the company a *taxi request*. The operator must **answer quickly** (accept → send a driver → confirm delivery). Missed requests are the main failure, so the program's first job is to **ring until answered**, exactly like the phone.
One login per taxi company (the administrator gives it: Telegram `/newtaxi`, `/taxiapp`, or the DS Admin app → Taksi). The same login can be used on the phone and on the PC at once.

Non-goals (same as phone): no fares, no driver tracking, no maps inside the app, no customer/restaurant features.

## 2. Feature parity checklist (phone → PC)
| Phone function | PC |
|---|---|
| Login (login + password) | same; DPAPI-stored token |
| Poll requests every ~3 s (also the "app is online" heartbeat) | same, see section 5 |
| Ring on a new / late / unclear request, repeat until answered | same, with the new ringtone `new_order.mp3` |
| "Ovozni o'chirish" mutes the current ones 30 s, rings again if still unanswered | same |
| Voice "Yangi buyurtma" after the ringtone | optional (Windows speech), see section 6 |
| Full-screen alert on locked phone | window pops to front + taskbar flash + tray balloon |
| Foreground service + wake lock + boot receiver | tray process + sleep prevention + autostart |
| Duty switch ("Navbatchilik") | same switch |
| Request card: restaurant (name, address, phone), delivery (address, customer phone, GPS), food state, price, CASH/CARD banner | same content, laid out for a wide screen |
| Buttons: Qabul qilish · Rad etish / Taksi yo'q · Taksi yuborildi · Yetkazildi (with confirmation) | same, server decides which exist |
| Answer countdown for a new request | same |
| Call / Map buttons | PC version: copy phone, open map in the browser (section 8) |
| History, last 24 hours | same tab |
| Readiness checks (notifications, volume, battery, full-screen permission) | PC equivalents (section 9) |
| Sound test, max volume | sound test; volume tip |
| Logout with warning | same |
| Offline strip "Ulanish yo'q — yangi so'rovlar kelmayapti" | same |

If something exists on the phone and is missing here, it is a bug in this plan: tell the owner.

---------------------------------------------------------------------------------------------------

## 3. Server contract (all under `{base}/api/v1/taxi/`)
Base URL: same rule as the restaurant plan (setting; staging `https://staging.sultonxoja.uz`; owner confirms production). HTTPS only. Bearer token on every call except login. Dates ISO-8601 UTC, shown in the PC's local zone **(the operators are in Uzbekistan = UTC+5; use Asia/Tashkent explicitly, do not trust a wrong PC zone)**.
Reference DTOs: `apps/taxi-android/app/src/main/java/com/dsdelivery/taxi/data/Dtos.kt`, endpoints in `data/Repository.kt`. Server: `src/modules/taxi-app/routes.ts`, `service.ts`.

| Call | Body → Response |
|---|---|
| `POST auth/login` | `{login, password}` → `{accessToken, tokenType, expiresAt, company{id,name,login}}`. `401 INVALID_CREDENTIALS`; `403 COMPANY_INACTIVE`; `429 TOO_MANY_ATTEMPTS {retryAfterSeconds}` (+`Retry-After` header) |
| `GET auth/me` | → `{company, session{expiresAt}}` |
| `POST auth/logout` | → 204 |
| `GET requests` | → `{serverNow, company, active[], history[]}` — **this is the poll** |
| `GET requests/{id}` | → `{request}`; 404 `TAKSI_SOROVI_TOPILMADI` (another company's id looks the same) |
| `POST requests/{id}/action` | `{action: "ACCEPT"\|"SENT"\|"NO_TAXI"\|"DELIVERED"}` → `{changed, finalStatus, fallbackCompany, request}` |

`RequestDto`: `id, orderCode, status, attention, createdAt, sentAt, answerBy, updatedAt, deliveredAt, isTest, restaurant{name,address,phone}, delivery{address,lat,lng,customerPhone}, food{ready,status,prepMinutes,estimatedReadyAt,readyAt,totalSom}, payment{method: "CASH"|"CARD", payRestaurantSom}, actions[], deliverBlockedReason`. `payment`, and other newer fields, may be missing on an older server → nullable. Unknown status strings: show the raw text, never crash.

**Statuses** (title / colour): `REQUESTED` "Yangi so'rov" (red), `CANCELLATION_PENDING` "Javob kechikdi — aniqlashtiring" (red), `NEEDS_HELP` "Aniqlashtirish kerak" (red), `ACCEPTED` "Qabul qilingan — haydovchi yuboring" (orange), `ASSIGNED` "Taksi yo'lda" (green), `DELIVERED` "Yetkazildi" (green), `DECLINED` "Rad etilgan" (grey), `CANCELLED` "Bekor qilingan" (grey).
`active` = REQUESTED, ACCEPTED, CANCELLATION_PENDING, NEEDS_HELP, ASSIGNED. `history` = DELIVERED, DECLINED, CANCELLED of the last 24 h.
`attention == true` for REQUESTED, CANCELLATION_PENDING, NEEDS_HELP: **these ring.**

**Actions per status (decided by the server in `actions[]` — draw only what is listed, never derive from status):**
| Status | Actions → button text |
|---|---|
| REQUESTED | ACCEPT "Qabul qilish" (primary, yellow) · NO_TAXI "Rad etish" (red outline, confirm) |
| ACCEPTED | SENT "Taksi yuborildi" (primary) · NO_TAXI "Taksi yo'q" (confirm) |
| CANCELLATION_PENDING / NEEDS_HELP | SENT "Haydovchi yuborilgan" · NO_TAXI "Taksi yo'q" (confirm) |
| ASSIGNED | DELIVERED "Yetkazildi" (confirm; disabled while `deliverBlockedReason != null`, show that text in orange) |

Confirm dialogs (copy exactly): DELIVERED — title "Yetkazildimi?", text "Buyurtma mijozga haqiqatan topshirildimi? Tasdiqlasangiz buyurtma yakunlanadi, qaytarib bo'lmaydi.", buttons "Ha, yetkazildi" / "Yo'q, ortga". NO_TAXI — title "Taksi yo'qmi?", text "Bu so'rovga haydovchi yuborib bo'lmasligini tasdiqlaysizmi? Mijoz roziligi bo'lsa boshqa kompaniyaga murojaat qilinadi.", buttons "Ha, taksi yo'q" / "Yo'q, ortga".
The response field `fallbackCompany` (the company the server asked next after a "no taxi") is **not shown on the phone**; for parity the PC does not show it either (it just re-polls). Optional extra, only if the owner asks later.

**Errors on actions are 409 with a ready Uzbek `message` — show that message as is:** `TAKSI_SOROVI_ESKIRGAN` "Bu amal eskirgan. Ro'yxatni yangilang." (someone else — e.g. the phone — answered first), `TAKSI_HALI_YUBORILMAGAN`, `BUYURTMA_HALI_TAYYOR_EMAS` "Taom hali tayyor emas…", `BUYURTMA_BEKOR_QILINGAN`, `QAYTARISH_JARAYONIDA`, `TOLOV_TASDIQLANMAGAN`, `BUYURTMA_YETKAZISH_UCHUN_FAOL_EMAS`; 403 `TAKSI_OPERATOR_RUXSAT_YOQ`. After any failed action re-poll at once. Network texts as on the phone: "Internet yo'q. Qayta urinib ko'ring.", "Sessiya tugagan. Qayta kiring." (401), "Biroz kuting." (429).

**Session:** sliding 180 days, renewed on use; at most **5 live sessions per company** (a 6th login signs the oldest device out) — phone + PC + spare devices count. Any 401 on a protected call = signed out: clear the token, stop ringing, show login.

**Server clock:** `serverNow` in every poll. Countdown of `answerBy` uses `serverNow` offset (`clockOffsetMs = server − local at response time`), never the raw PC clock.

**Heartbeat:** the poll itself is the "this company's app is online" signal; the server warns the administrators if no poll arrives for ~90 s. So the PC app must keep polling whenever it is running and logged in, even when hidden in the tray.

---------------------------------------------------------------------------------------------------

## 4. Structure
Reuse the restaurant plan's layout; **[builder, strongly recommended]** put the shared parts in a `DsDesktop.Shared` library used by both programs (typed HTTP base with the 401 handler, DPAPI `SessionStore`, `AlarmPlayer` (ringtone loop), tray/autostart/single-instance helpers, Serilog setup, money/time formatters, `AttentionTracker`/`NewOrderAttention` generic core). The two programs stay **separate executables with separate installers** (different users, different accounts).
```
DsDesktop.sln
  src/DsDesktop.Shared/
  src/DsRestaurant.*   (see restaurant plan)
  src/DsTaxi.Core/     Api/ (TaxiApi, Dtos), Dispatch/ (Dispatcher, AttentionTracker, RequestActions, Format)
  src/DsTaxi.App/      WPF: Views, ViewModels, Tray, Resources (new_order.mp3, icons)
  tests/DsTaxi.Core.Tests/
  installer/ds-taxi.iss
```
App name "DS Taxi", data folder `%LOCALAPPDATA%\DsTaxi\`, mutex name `DsTaxi.SingleInstance`, autostart value `DsTaxi`.

## 5. Dispatcher and alarm (the most important part) — port of `core/Dispatcher.kt` + `core/AttentionTracker.kt`
**Poll loop:** `GET requests` every **3 s**, every **2 s while something is ringing**. One request at a time, 8 s timeout. A failed poll increments `failures`; at **3 failures in a row** set `offline = true` (red strip "Ulanish yo'q — yangi so'rovlar kelmayapti"). The first success resets `failures` and `offline`. On success store `active`, `history`, `loaded = true`, `lastOkAt`, `clockOffsetMs`.
**401** → sign out (clear token, stop everything, login screen; ring one short warning once).

**AttentionTracker (port exactly, with its unit tests from `apps/taxi-android/app/src/test/…`):**
- The key of a request is `"{id}:{status}"` — a request that **changes status rings again** even if it was silenced.
- `update(requests, now)`: attention set = keys of requests with `attention == true`; forget the silence of keys that left the set; return the keys that are ringing (not silenced).
- `silence(now)`: mute every currently pending key for **30 s**. When the time is over and the key is still pending, it rings again. A new key rings at once.
- `pending()` = ringing + silenced.

**Ringing** happens only if **duty is on** and at least one key is ringing. Ring cycle: play `new_order.mp3` once (cap one play at 15 s), pause 1.2 s, repeat; stop the moment nothing rings. Set the alarm state from `publish()` after every poll and after "silence" and "duty changed".
**Visual alert:** when a key starts ringing: bring the window to the front (`Activate`, flash the taskbar button with `FlashWindowEx` until focused), tray balloon "N ta so'rov javob kutmoqda". The ringing request card shows a big "🔕 Ovozni o'chirish" button; the top bar has the same button.
**Both devices ring** when the same login is on the phone and the PC. Whoever answers first wins; the other gets `409 TAKSI_SOROVI_ESKIRGAN` (show it, re-poll) and stops ringing on its next poll.

**Duty switch ("Navbatchilik")** — same texts as the phone: on = "Yoqilgan — ilova fonda ishlaydi, yangi so'rovda gudok chaladi." off = "O'chirilgan — ilova yopiq bo'lsa so'rovlar kelmaydi va signal chalinmaydi." While off, no ringing and no balloon (polling may continue while the program is open, like the phone's dispatcher). Persist the choice (settings file). Status strip: offline → red "Ulanish yo'q — yangi so'rovlar kelmayapti"; duty off → grey "Navbatchilik o'chirilgan"; else green "Ulangan • navbatchilik yoqilgan". The tray icon colour mirrors it (green / grey / red), the tooltip repeats the duty text: "N ta so'rov javob kutmoqda" · "N ta faol buyurtma" · "Yangi so'rovlarni kutyapman".

## 6. Sound
- Ringtone: `apps/taxi-android/app/src/main/res/raw/new_order.mp3` (owner's recording, the same file as in the restaurant app). Copy to `DsTaxi.App/Resources/`.
- Output: default device, system volume (do not change it). Warning banner if no device / muted: "Tovush o'chiq — so'rov eshitilmaydi". Settings: "Ovozni sinash" button; tip text "Kolonka ovozini baland qiling".
- Optional voice after the ringtone, as the phone does ("Yangi buyurtma", `core/OrderVoice.kt`: Uzbek → Russian → English fallback, 4 s timeout): use `System.Speech` / Windows SAPI if an Uzbek or Russian voice exists, otherwise skip silently. **[builder]** may leave it out of version 1.

## 7. Screens (Uzbek; same wording as the phone where it exists)
Desktop layout: **left = list of requests (cards), right = selected request detail with the big action buttons**, top bar with status + duty + mute, tabs "So'rovlar" · "Tarix" · "Sozlamalar". Min. window 1100×700; scales on Full HD and 125–150 % DPI; strong contrast (this is read at a glance in a noisy dispatch office). Colours from the phone: urgent `#D32F2F`, warn `#EF6C00`, ok `#2E7D32`, neutral `#616161`, taxi yellow (primary buttons, text `#1B1B1F`). A new urgent request gets a thick red border (as on the phone).

1. **Login**: "DS Taxi" / "Taksi operatori uchun", Login, Parol, "Kirish". Errors: wrong (401) → "Login yoki parol noto'g'ri."; inactive (403) → "Bu kompaniya o'chirilgan. Administrator bilan bog'laning."; locked (429) → "Juda ko'p noto'g'ri urinish. N daqiqadan keyin qayta urinib ko'ring." (N = ceil(retryAfterSeconds / 60)); other → "Kirib bo'lmadi. Birozdan keyin qayta urinib ko'ring."; offline → "Internet yo'q."
2. **So'rovlar** (active): cards sorted: attention first (oldest first), then others by `updatedAt`. Empty state: "Hozir so'rov yo'q" + (duty ? "Yangi so'rov kelsa, kompyuter gudok chaladi." : "Navbatchilik o'chirilgan: dastur yopiq bo'lsa so'rov kelmaydi."). Card (and detail): `#orderCode`, `SINOV` chip when `isTest`, status chip; for REQUESTED the **answer countdown** "Javob muddati: m:ss" (grey > 30 s, red below; at 0 "Javob muddati o'tdi — hoziroq javob bering"); **Olib ketish**: restaurant name, address ("Manzil kiritilmagan" if empty), phone; **Yetkazish**: address, customer phone, GPS "Xarita" only if lat/lng exist; **Taom**: "Taom: TAYYOR (HH:mm)" green / "Taom: tayyorlanmoqda"; "Taom narxi: 55 000 so'm (yetkazish haqi emas — uni taksi xizmatingiz belgilaydi)"; payment banner: CASH → red box "NAQD: restoranga {payRestaurantSom} to'lanadi" + "Puli bor haydovchi yuboring. Shu summani mijozdan olasiz." ; CARD → green "Taom puli kartadan to'langan — restoranga to'lash shart emas"; `deliverBlockedReason` in orange; then the action buttons.
3. **Tarix**: "So'nggi 24 soat"; rows `#code`, status chip, "Restoran → manzil", time; empty "Hali hech narsa yo'q."
4. **Sozlamalar**: Navbatchilik switch · Signal (Ovozni sinash) · Tayyorlik (section 9) · Hisob (Login, "Chiqish" with confirm "Chiqasizmi? Chiqsangiz bu kompyuter yangi so'rovlarni eshitmaydi.") · version "DS Taxi x.y.z".
Keyboard (desktop gain, optional but cheap): `Enter` = the primary action of the selected request (confirm dialogs still apply), `Esc` = close dialog, `M` or `F9` = mute 30 s, `Up/Down` = move between requests. Never a shortcut for DELIVERED / NO_TAXI without the dialog.

## 8. Phone and map on a PC
- Phone numbers: show the number big, with buttons **"Nusxalash"** (clipboard, toast "Nusxalandi") and — if the PC can dial (Phone Link / softphone registered for `tel:`) — "Qo'ng'iroq" using the `tel:` URI. Numbers are dialled as typed with spaces/dashes removed (`dialable()` in `ui/Format.kt`).
- Map: only when the customer/restaurant shared coordinates (`lat`,`lng`): "Xarita" opens `https://www.google.com/maps?q={lat},{lng}` in the default browser (`Process.Start` with `UseShellExecute`). A typed address is **never** searched on a map (a guess can send a driver to the wrong place) — same rule as the phone.

## 9. Readiness (replaces the phone's "Tayyorlik")
Show a yellow banner "Signal ishonchli ishlamasligi mumkin" with a "Tuzatish" button when something is wrong:
- sound device missing / system output muted (core audio `IAudioEndpointVolume`) → "tovush o'chiq";
- autostart is off → "Windows bilan ishga tushmaydi";
- program is not in duty mode → shown by the status strip, not by this banner.
Sleep: while logged in and duty is on, call `SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)` so the PC does not sleep (the screen may turn off). Tip text in Sozlamalar: "Kompyuterni quvvatga ulangan va internetga ulangan holda qoldiring. Windows yangilanishidan keyin dastur o'zi ishga tushadi."
Tray: closing the window hides to the tray (polling continues); menu: Ochish · Ovozni o'chirish (30 s) · Navbatchilik (check mark) · Chiqish (confirm "Yangi so'rovlar eshitilmaydi. Chiqilsinmi?"). Autostart on by default after the first login (HKCU Run, `--minimized`). Single instance.

## 10. Security
As in the restaurant plan: DPAPI token, HTTPS only, no certificate overrides, no analytics, no customer data in logs (phone numbers/addresses never logged), nothing from requests stored on disk, tray tooltip and window title never show addresses or phones. Every action is sent only after the user's click; no auto-accept, ever.

## 11. Tests
**Unit:** `AttentionTracker` (new rings; silenced is quiet; new key during silence rings; silence over → rings again; status change = new key rings again; answered/removed forgets silence); status → look mapping; `actionLabel` per status; DTO parsing with missing fields (`payment` absent, unknown status); `som()` format ("55 000 so'm"); `mmss`; clock-offset countdown; poll back-off/offline after 3 failures (fake clock); error mapping (401, 403, 409 with message, 429).
**Integration (MockHttp):** login → poll shows REQUESTED → ring starts → ACCEPT → status ACCEPTED rings again? (it does not: ACCEPTED has `attention=false`) → SENT → DELIVERED blocked then allowed; another device answered first (409 `TAKSI_SOROVI_ESKIRGAN`); 401 mid-poll signs out.
**Manual on staging (owner checklist):**
1. Create a test order that needs a taxi → rings within ~3 s; mute 30 s → rings again; accept on the phone → PC stops within one poll.
2. Tray for 10 min → new request pops the window and rings.
3. Pull the network 30 s → red strip; recovers; the administrator is warned by the server after ~90 s of silence (expected).
4. CASH order shows the red NAQD box with the right sum; CARD shows the green line.
5. DELIVERED is disabled with the orange text until the restaurant marks the food ready.
6. Windows sign-out/sign-in → autostart; second launch focuses the first window.
7. Mute the PC / no speakers → red banner.
8. 150 % DPI and a 1366×768 laptop.

## 12. Phases and acceptance
**Phase 0 — skeleton.** Solution (shared library), login/me/logout, DPAPI session, logging, single instance, tray. *Done when:* login works on staging, restart keeps the session, errors show the right Uzbek text.
**Phase 1 — Dispatch core.** Poller, AttentionTracker port, alarm, visual alert, offline strip, duty switch, request cards with all actions + confirmations, countdown, CASH/CARD banners, tray, autostart, sleep prevention. *Done when:* manual items 1–7 pass and unit/integration tests are green.
**Phase 2 — Rest of the phone's functions.** History tab, settings/readiness, sound test, logout, keyboard shortcuts, phone-copy/map buttons. *Done when:* every row of the section 2 checklist is ticked.
**Phase 3 — Release.** Installer (per-user, self-contained `win-x64`), version resource, icon (yellow taxi/checker style from the customer app), 24-hour soak (memory < 150 MB, no crash, polls never stop), owner text review, signing decision.
After each phase deliver: what works, what was **not** tested, exact build/test commands, the server calls used. Do not claim a phase complete if an acceptance line was not checked.

## 13. Rules that must not be broken
- The program never decides which buttons exist; the server's `actions[]` does.
- "Yetkazildi" only after the dialog; never automatic. Taxi acceptance or "Taksi yuborildi" is **not** delivery.
- A request of another company never appears (the server enforces it; the client must not try other ids).
- Real payments / money settings do not exist in this app.

## 14. Open questions for the owner (do not guess)
1. Production server address; may staging be selectable in release builds?
2. Is a PC `tel:` "Qo'ng'iroq" button wanted, or only "Nusxalash"?
3. Voice "Yangi buyurtma" on PC: wanted?
4. Code-signing certificate for the installer.
5. May one company run several PCs? (Technically yes, up to 5 live sessions per company including phones.)

## 15. Reference files
- Phone app: `apps/taxi-android/app/src/main/java/com/dsdelivery/taxi/` — `data/Dtos.kt`, `data/Repository.kt`, `core/Dispatcher.kt`, `core/AttentionTracker.kt`, `core/AlarmPlayer.kt`, `core/OrderVoice.kt`, `ui/RequestCard.kt`, `ui/MainScreen.kt`, `ui/SettingsTab.kt`, `ui/Format.kt`; README: `apps/taxi-android/README.md`.
- Server: `src/modules/taxi-app/` (`routes.ts`, `service.ts`, `auth.ts`), state machine `src/modules/taxi/`.
- Ringtone: `apps/taxi-android/app/src/main/res/raw/new_order.mp3`.
- Companion plan: `docs/PLAN_RESTAURANT_WINDOWS.md`.
