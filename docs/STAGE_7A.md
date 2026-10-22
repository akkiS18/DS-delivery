# Stage 7A — Customer Telegram Mini App MVP + critical Android/Taxi fixes

> **Honest status.** Everything below was verified with automated tests and builds. **The Mini App has NOT been run inside real Telegram**
> and the new Android UI has **not been run on a device**. Do the manual checklist at the end before calling this done.

## 1. What changed

### Phase 1 — critical fixes
| Problem | Fix |
| --- | --- |
| Countdown reached 0 but no overdue time | Android shows `Kechikish: N daqiqa` from the first second late and keeps growing; mm:ss detail; never auto-READY. Time comes from the server (`serverNow`, `estimatedReadyAt`) plus monotonic elapsed time, so a wrong phone clock changes nothing. Tickers are lifecycle-aware (`STARTED`) so they cost nothing in the background. |
| Taxi operator silent → `NEEDS_HELP`, no recovery | See "Taxi recovery" below. |
| Confusing Orders UI | Status tabs with counts, large order numbers, age, payment pill, prep/overdue line, taxi shown separately, exceptions first, sticky READY bar, brand colours, no repeated prep/confirm dialogs. |

### Taxi recovery (`src/modules/taxi/assignment.ts`, `recovery.ts`, `src/bot/taxi-admin.ts`)
- **Explicit "no driver sent"** (operator declined / cannot supply) → automatic fallback to the next *eligible* company (active, linked operator, on `TAXI_OPERATOR_ALLOWLIST` when set).
- **Silence is never re-sent blindly** (a driver may already be on the way). After `TAXI_SILENCE_ESCALATION_SECONDS` (300) administrators are alerted through the **taxi bot** with a "Ko‘rish va hal qilish" button.
- Administrators use `/taxiadmin` in the taxi bot: they see the full attempt history and may reassign **only after a written attestation** that no driver was sent. Old attempts become `CANCELLED` (history kept), the new attempt is created under the order row lock, and the partial unique index keeps **one active dispatch per order**.
- `TAXI_AUTO_FALLBACK_ON_SILENCE=true` (default **false**) opts in to automatic re-assignment on silence, with an audited risk flag. Do not enable it for real bookings.
- Nothing retries after a driver was sent (`ASSIGNED`). READY cannot create a second dispatch. Delivery is claimed only on operator confirmation.
- Administrators are `SUPPORT_ADMIN_n_TELEGRAM_ID` (+ optional `TAXI_ALERT_TELEGRAM_ID`) and **must `/start` the taxi bot once**, or Telegram cannot message them.

### Phase 2/3 — Mini App
- Backend: `src/modules/miniapp/{auth,routes,profile,views,static}.ts`, `src/lib/rate-limit.ts`, `src/modules/restaurant-operations/hours.ts`. Contract: `docs/MINIAPP_API_CONTRACT.md`.
- Frontend: `apps/customer-miniapp` (React 18 + TypeScript strict + Vite 5, Uzbek Latin, hash routing). Screens: Restoranlar, Menyu, Savat, Rasmiylashtirish (manzil → telefon → xulosa → to‘lov), Buyurtma kuzatuvi, Buyurtmalarim, Profil.
- The built SPA is served by the backend at **`/app/`** (same origin as `/api`: one HTTPS URL, no CORS) with a strict CSP (`frame-ancestors` for Telegram only).
- Customer bot: `/start` and `/app` show a **"🍽 Buyurtma berish"** WebApp button; the chat menu button is set at startup (`setChatMenuButton`). The old chat checkout stays behind `CHAT_CHECKOUT_ENABLED` (default `true` = still available; set `false` after the Mini App passes real-Telegram E2E; existing orders remain reachable either way).
- Security: signed-initData verification (HMAC, constant-time compare, `auth_date` freshness), identity only from the signed user, ownership enforced in the query, uniform 401/404, strict bodies, rate limiting, `BOT_TOKEN` never reaches the browser, no `initDataUnsafe`.
- Business rules: the customer never picks a taxi; working hours are checked in the restaurant timezone; prices are frozen server-side and a stale cart yields `409 NARX_OZGARGAN` (the app re-prices and asks again; nothing was created); duplicate taps send one request and reuse one `checkoutKey`; the payee card in REAL mode comes only from configuration (otherwise the app says **do not pay**); no delivery price is invented (`delivery.feeSom: null`).

### Migration
`prisma/migrations/20261028000100_miniapp_profile` — additive: `Restaurant.timezone` (default `Asia/Tashkent`), table `CustomerAddress`, one-default-per-customer partial unique index. Already applied to `ds_delivery_test` only. Apply elsewhere with `npx prisma migrate deploy` (never `reset`).

## 2. Environment variables
See `.env.telegram-test.example`.
| Variable | Default | Meaning |
| --- | --- | --- |
| `MINIAPP_ENABLED` | **off** (must be `true`) | mounts `/api/v1/miniapp` and `/app/` |
| `TRUST_PROXY` | false | set `true` ONLY behind your own reverse proxy so the rate limiter sees real client IPs (otherwise everyone shares the proxy's IP bucket) |
| `MINIAPP_URL` | – | **public https** URL, e.g. `https://host/app/` (launcher + menu button) |
| `MINIAPP_AUTH_MAX_AGE_SECONDS` | 86400 | max `auth_date` age |
| `MINIAPP_ORDER_RATE_PER_MINUTE` | 10 | per-customer order creation limit |
| `MINIAPP_DIST_DIR` / `MINIAPP_CSP` | auto | override the dist folder / CSP |
| `CHAT_CHECKOUT_ENABLED` | true | rollback switch for the old chat checkout |
| `TAXI_SILENCE_ESCALATION_SECONDS` | 300 | silence → administrators |
| `TAXI_AUTO_FALLBACK_ON_SILENCE` | false | risky opt-in, see above |

## 3. Local development
```powershell
# backend (test DB only: DATABASE_URL must end in /ds_delivery_test)
npm run miniapp:build            # builds apps/customer-miniapp -> apps/customer-miniapp/dist
npm run dev                      # serves /api and /app/

# UI in a desktop browser (no Telegram): vite proxies nothing, so use the backend-served build, or run vite dev with a signed string
npm run miniapp:dev-initdata -- 123456789 Test      # prints a SIGNED initData string (refuses in production)
#   browser console on the vite dev origin:  localStorage.setItem('ds.dev.initData', '<printed string>')
cd apps/customer-miniapp; npm run dev
```
The `ds.dev.initData` path exists **only in `vite dev`** (`import.meta.env.DEV`); production builds contain no such code path.

### Real phone test (needs HTTPS)
Telegram only opens `https://` Mini Apps and a phone cannot reach `localhost`, so tunnel the backend:
```powershell
cloudflared tunnel --url http://localhost:3000     # or: ngrok http 3000
```
1. Put the printed `https://….trycloudflare.com` into `.env` as `MINIAPP_URL=https://<host>/app/` (trailing `/app/`).
2. `npm run miniapp:build`, then `npm run dev`. The bot sets its menu button on startup and `/start` shows the launcher.
3. Tunnel URLs change on restart; re-set `MINIAPP_URL` and restart.
Use a **test bot** and the `ds_delivery_test` database; keep `TAXI_OPERATOR_ALLOWLIST` set to your own id and `PAYMENT_MODE` on MOCK.

## 4. BotFather
The button is set automatically (`setChatMenuButton`). To do it by hand: `@BotFather` → `/mybots` → your bot → *Bot Settings* → *Menu Button* → *Configure menu button* → send the `https://…/app/` URL → title `Buyurtma berish`. Optionally *Edit Bot* → *Edit Mini App/Main Mini App* with the same URL. No domain registration is needed for menu-button Mini Apps.

## 5. HTTPS deployment (production shape)
One Node process behind a TLS reverse proxy (Caddy/nginx/Cloud Run): `https://host/app/` (SPA) and `https://host/api/…` same origin. Build the SPA in CI (`npm --prefix apps/customer-miniapp ci && npm run miniapp:build`) and ship `dist` with the backend (or set `MINIAPP_DIST_DIR`). Set `NODE_ENV=production` (disables the MOCK path and the dev tool), `TRUST_PROXY=true` so the rate limiter sees real client IPs, `PAYMENT_MODE=REAL` only after the real payee requisite is configured. Never commit `.env`.

## 6. Tests
| Suite | Result |
| --- | --- |
| Mini App vitest (`apps/customer-miniapp`, `npm test`) | 22/22 pass |
| Mini App `tsc --noEmit` + `vite build` | pass |
| Backend `tsc --noEmit` | pass |
| Backend unit tests (all `*.test.ts` outside `src/tests`) | 74/74 pass |
| DB suites on `ds_delivery_test` | acceptance 10, acceptance2 10, checkout.stage6f 12, finance 10, **miniapp 13**, payment 1, payment.safety 10, refunds 13, restaurant-auth 13, restaurant-catalog 15, restaurant-operations 6, restaurant-orders 11, support.conversation 9, support 8, **taxi.recovery 7**, taxi.stage6d 13, telegram.integration 9 — all pass |
| Android pure-Kotlin timer checks (`unit-checks/run.ps1`) | 33/33 pass |
| Android `:app:assembleDebug` | pass → `DS-gemini\apps\restaurant-android\app\build\outputs\apk\debug\app-debug.apk` |

Two existing tests were updated for intended behaviour changes: `restaurant-operations` (the response now includes `timezone`) and `taxi.stage6d` (a fallback company that cannot be reached is no longer given a dead attempt; the order goes to administrators instead).

### NOT run / NOT verified
- **Mini App inside real Telegram (iOS/Android/Desktop)** — initData from a real client, WebApp button, back button, haptics, theme.
- Visual/mobile layout in a real browser (only typecheck, build and unit tests ran).
- New Android UI on a device/emulator (compiled and logic-checked only).
- Real payments, real taxi booking, Gmail polling (all intentionally off).
- Component/DOM tests (the vitest suite covers the pure logic: cart, validation, router, timeline/countdown, error mapping).

## 7. Manual E2E checklist (real Telegram, test bot, test DB)
1. `/start` shows **🍽 Buyurtma berish**; the chat menu button opens the same app. Opening the URL in a normal browser shows "Telegram orqali oching".
2. Home lists restaurants; a paused/closed restaurant shows "Yopiq" with the next opening time and cannot be ordered from.
3. Menu → add items → Savat → quantity/remove/clear; leave and reopen: the cart is still there.
4. Change a product price in the Android app (while paused) while the item is in the cart: the cart/checkout re-prices, warns, and **does not** create an order until the customer confirms the new total.
5. Checkout: new address (+ optional location, save) and phone; the next order offers the saved address and does not ask for the phone. Edit/delete/default in Profil.
6. Double-tap "To‘lovga o‘tish": exactly one order. Reload during submit: still one order.
7. Order page (MOCK): "Sinov to‘lovini bajarish" works; no real money. REAL mode with no configured card: the app says **do not pay**.
8. Android: payment verified → prep timer starts automatically; the Mini App countdown matches; after zero it shows `Kechikish: N daqiqa` and keeps growing; **the order never becomes READY by itself**.
9. READY → taxi stages update (requested → accepted → sent → delivered); "accepted" is not shown as "on the way".
10. Taxi: operator presses "no driver" → automatic fallback; operator silent → administrators get the alert, `/taxiadmin` → written attestation → reassignment; READY twice never creates a second dispatch.
11. Cancel unpaid → cancelled; cancel paid → "so‘rov yuborildi" (not "refunded").
12. `CHAT_CHECKOUT_ENABLED=false`: chat checkout entry points answer with the launcher; **Buyurtmalarim** still works.
13. Another Telegram account cannot open the first account's `#/order/<id>` (shows "Topilmadi").

## 8. Known limitations and production blockers
1. **Not E2E-tested in real Telegram** (above).
2. **Rate limiter is in-memory** (single process). Multiple instances need a shared store (Redis) — blocker for horizontal scaling.
3. **Polling, not push**: the order page polls every 4–8 s while visible; no WebSocket/push. Telegram notifications from the bot remain the push channel.
4. **REAL payments**: needs a configured payee requisite; verification is manual by the restaurant (Gmail is only a signal). Real payments stay disabled by default.
5. **Taxi**: operators and administrators must `/start` the taxi bot; `TAXI_OPERATOR_ALLOWLIST` limits recipients in development; silence recovery is administrator-driven by design.
6. Restaurant working hours are edited per restaurant; the `timezone` has an API (`PATCH /operations/timezone`) but the Android UI does not edit it yet.
7. No images upload for products (URLs only); no promo codes; no per-customer language switch (Uzbek Latin only).
8. Telegram's `initData` is valid for `MINIAPP_AUTH_MAX_AGE_SECONDS`; a Mini App left open longer gets 401 and asks the customer to reopen it.
9. `docs/ROADMAP.html` remains product guidance; Stage 7A does not claim any roadmap day complete.
