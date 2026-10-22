# Telegram local testing (with the Restaurant Android app)

All commands: Windows PowerShell, from `C:\Users\Acer\Documents\DS`. Test database: `ds_delivery_test` only.

## 1. What is implemented
There is **one** Telegram bot (one token, one Telegraf instance in `src/bot/client.ts`). It serves four roles, decided by
who is writing to it:

| Role | Who | Entry points |
| --- | --- | --- |
| Customer | anyone | `/start`, `/restaurants`, `/menu`, `/cart`, `/orders`, checkout buttons, MOCK payment button |
| Restaurant staff | the Telegram id linked to a restaurant | `/staff`, `staff:*` buttons (accept, reject, verify payment, prepare, ready), refunds |
| Taxi operator | the Telegram id linked to a taxi company | `/taxi`, `taxi:*` buttons |
| Support | customers + two admin ids | `/support`, `/mytickets`, `/tickets` |

There are no separate bot processes. The bot **starts inside the Fastify server** (`npm run dev` -> `src/server.ts`) when
`BOT_ENABLED=true`. Together with the bot the server starts the background workers: payment notifier, restaurant/customer
order notifier, taxi dispatcher, support notifier. Mode is long polling (no webhook; start-up deletes any webhook).
The Android app talks to the same server over HTTP (`/api/v1/restaurant/...`).

## 2. Why the bots did not work (fixed)
1. `.env` was empty, so `npm run dev` stops at env validation (`INTERNAL_API_KEY`, `DATABASE_URL`) before any bot code.
   `BOT_TOKEN` / `BOT_ENABLED` were not set anywhere.
2. Code bug: `await bot.launch()` never returns in Telegraf 4.16 (it only settles when polling stops), so the workers after
   it never started - no staff order notifications, no customer status messages, no taxi dispatcher. `src/server.ts` now
   continues from the `onLaunch` callback and treats a later polling error (409 duplicate polling, 401 bad token) as fatal
   with a clear log line.

## 3. Create the test bot (BotFather) - you do this
1. In Telegram open **@BotFather**, send `/newbot`, name it e.g. `DS Delivery TEST`, username e.g. `ds_delivery_test_xxx_bot`.
2. Copy the token into `.env` as `BOT_TOKEN` (never paste it in chat or commit it). Do not reuse a production token.
3. Optional: `/setprivacy` is irrelevant (private chats only).
4. Best: two Telegram accounts - one plays the customer, the other plays restaurant staff **and** taxi operator. (One
   account for everything also works but mixes the chats.) Get an id by sending `/myid` to the running bot.
5. Every account must press **Start** in the test bot once, otherwise Telegram refuses to deliver messages to it.

## 4. Environment variable names (values in `.env`, see `.env.telegram-test.example`)
`DATABASE_URL`, `HOST`, `PORT`, `INTERNAL_API_KEY`, `GMAIL_ENABLED=false`, `BOT_ENABLED=true`, `BOT_TOKEN`,
`BOT_PAYMENT_MODE=MOCK`, `RESTAURANT_ACCEPTANCE_MOCK=true`, `RESTAURANT_RESPONSE_SECONDS`, `TAXI_OPERATOR_ALLOWLIST`,
`TAXI_LEAD_MINUTES`; optional `SUPPORT_ADMIN_1_TELEGRAM_ID`, `SUPPORT_ADMIN_2_TELEGRAM_ID`, `TAXI_ALERT_TELEGRAM_ID`.
Safety rails: `BOT_PAYMENT_MODE=REAL` is refused when the database name contains "test"; `TAXI_OPERATOR_ALLOWLIST` blocks
taxi requests to any other id.

## 5. One-time setup
```powershell
copy .env.telegram-test.example .env      # then edit .env: DATABASE_URL, INTERNAL_API_KEY, BOT_TOKEN, ids
npx prisma migrate status                  # must say "up to date" for ds_delivery_test
npm run restaurant:password -- ds-test-restaurant   # hidden prompt; this is the password you type in the Android app
npm run test:setup -- ds-test-restaurant <STAFF_TG_ID> <TAXI_OPERATOR_TG_ID>
```
`test:setup` refuses to run unless the database name contains `test`. It links the staff account to the restaurant
(`staff:link` equivalent), creates a MOCK card (`***9099`, test card), a "Test burger" product if the menu is empty, and
the "Sinov taksi (TEST)" company linked to the operator id.

## 6. Run
```powershell
npm run dev        # API + bot + workers in ONE process. Look for these log lines:
                   #   "Telegram bot configuration" (database: ds_delivery_test, paymentMode: MOCK)
                   #   "Telegram client bot started in polling mode"
                   #   "Taxi dispatch worker started"  /  "Support ticket notifier started"
```
Run only one instance per token. "409 Conflict" in the log means another process (or an old terminal) is polling
this token; stop it. Do not start `prisma studio` and the server with different `DATABASE_URL`s.

Android: in the app's server settings use `http://<PC-LAN-IP>:4000/` (phone and PC on the same Wi-Fi, Windows firewall
allowing port 4000). Log in with slug `ds-test-restaurant` and the password from step 5.

## 7. Full lifecycle test
1. Customer account: `/start` -> restaurant -> add Test burger -> checkout (phone, address, taxi "Sinov taksi (TEST)") -> confirm.
2. Staff chat receives "Restoran buyurtmasi #N" (≤ 7 s). Android Orders tab "Yangi" shows the same #N.
3. Accept from Android (or Telegram) -> customer gets payment details with a **MOCK** card and the button
   "MOCK kirim (pul yubormasdan)". Status shows "Mijoz to'lovi kutilmoqda" in both places.
4. Customer presses the MOCK button -> order becomes "To'lov tekshiruvda"; Android shows "verify in Telegram" and no cooking button.
5. Staff presses "MOCK kirimni tasdiqlash" in Telegram -> "PAYMENT_CONFIRMED"; Android now offers "Tayyorlashni boshlash".
6. Android: Start preparing (choose minutes) -> Telegram + customer see "Tayyorlanmoqda". A taxi dispatch is scheduled
   (`TAXI_LEAD_MINUTES` before the cooking time ends; "ready" brings it forward). The request goes only to ids in
   `TAXI_OPERATOR_ALLOWLIST` and is labelled "MOCK SINOV".
7. Android: Ready -> customer gets "taom tayyor". Taxi operator `/taxi` can answer "Taksi yuborildi" / "Taksi yo'q".
   This never marks delivery (Stage 7A is not implemented).
8. Reject path: new order -> Reject from Android -> customer gets "restoran qabul qila olmadi" once.

## 8. Automated checks
```powershell
$env:INTERNAL_API_KEY = 'any-local-string-of-20+chars'   # DATABASE_URL must already point at ds_delivery_test
npm run test:bot
npm run test:telegram:db      # fake local Telegram API: callbacks, auth, duplicates, notifier retry, Android<->Telegram state
npm run test:orders:db
```
`test:telegram:db` never contacts Telegram; it uses a local HTTP server and a fake token, and deletes only its own rows.

## 9. Known gaps / limitations
- One bot token for every role; no separate restaurant/taxi bots, no webhook mode.
- Payment verification is Telegram-only by design. Gmail is off here; REAL payments stay disabled.
- Price-change proposals to customers are Telegram-only; Android shows a hint.
- Notifications are DB polling (~7 s), at-least-once; a blocked/never-started account is retried every cycle (log line
  `[STAFF NOTICE] ... 403`). Press Start in the bot from each account.
- The server is not hardened for the internet (no TLS); use LAN only.
- Taxi dispatch uses the real Telegram transport to the operator id; safety comes from MOCK labelling plus
  `TAXI_OPERATOR_ALLOWLIST` (there is no separate fake transport in the server).

## 10. Stage 6D: dedicated taxi bot
1. In @BotFather create a **second** bot (`/newbot`, e.g. `DS Taxi TEST`) and put its token in `.env` as `TAXI_BOT_TOKEN`
   (must differ from `BOT_TOKEN`). Restart `npm run dev`; the log shows "Telegram taxi operator bot started".
2. Create the company if needed (`npm run taxi:add -- "Sinov taksi (TEST)"`, or `npm run test:setup ...` which also links an id).
3. Link an operator securely: `npm run taxi:invite -- "Sinov taksi (TEST)"` prints a one-time code; in the taxi bot send
   `/link XXXXX-XXXXX`. Set `TAXI_OPERATOR_ALLOWLIST` to your own Telegram id so nothing can reach anyone else.
4. Flow: restaurant presses "preparing" in the app -> after (prep − lead) minutes the operator gets the booking in the taxi bot
   -> **Qabul qilish** -> **Taksi yuborildi** -> **Yetkazildi** -> confirm. Delivery is accepted only when the restaurant has marked the
   order READY. The Android order screen shows the taxi progress card after a refresh.
5. MOCK orders complete but never earn commission. See `docs/STAGE_6D.md`.

## 11. Stage 6E: restaurants use the app, not Telegram
Set `RESTAURANT_TELEGRAM_ENABLED=false` (default). The staff account no longer needs `/start`, linking or any chat: staff log in to the
Android app. The old `staff:*` buttons only answer "managed in the app". A tester who is both customer and "staff" no longer receives
duplicate messages (and `NotificationLog` de-duplicates per chat even with the legacy panel on). MOCK orders now go
payment -> cooking by themselves; real payments always wait for "To'lovni tasdiqlash" in the app. See `docs/STAGE_6E.md`.
