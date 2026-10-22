# DS Delivery — Customer Android MVP (Capacitor APK)

Mijozlar uchun alohida Android ilova (restoran/kuryer ilovasi emas). Mavjud React/Vite Mini App Capacitor orqali o‘raladi, web
assetlar APK ichiga joylanadi. UI, matnlar va ranglar Mini App bilan bir xil. Ro‘yxatdan o‘tish yo‘q: server guest profil va
sessiya yaratadi. Telegramga bog‘lash ixtiyoriy.

> Holat: **debug APK yig‘ildi, qurilmada sinalmagan** (pastdagi "Natijalar" bo‘limiga qarang). Backend o‘zgarishlari **deploy
> qilinmagan** — APK ularsiz ishlamaydi (pastdagi "Backend talabi").

## 1. Arxitektura

```
apps/customer-miniapp/            React + Vite (bitta kod bazasi)
  src/lib/platform.ts             isAndroidApp = (build target android) VA (Capacitor native runtime)
  src/lib/session.ts              guest sessiya: Keystore-backed SecureStore, single-flight bootstrap
  src/lib/telegram.ts             platforma adapteri: Telegram SDK yoki Android (back stack, brauzer, no-op haptic/ready/expand)
  src/lib/api.ts                  Authorization: "tma <initData>" (Telegram)  YOKI  "Bearer <guest>" (Android) — hech qachon aralashmaydi
  src/screens/TelegramLink.tsx    Profil ichidagi "Telegramga bog‘lash"
  capacitor.config.json           appId com.dsdelivery.customer, CapacitorHttp yoqilgan (native HTTP)
  android/                        Capacitor Android loyihasi (SecureStorePlugin.java, debug network config)
src/modules/miniapp/guest.ts          guest profil + sessiya (faqat SHA-256 hash saqlanadi)
src/modules/miniapp/telegram-link.ts  bog‘lash oqimi va merge
src/modules/miniapp/routes.ts         ikki auth usuli → bitta ichki customer; biznes endpointlar ko‘paytirilmagan
src/bot/telegram-link.ts              /start lnk_<token> va tasdiqlash tugmalari
src/lib/customer-owner.ts             egalik: Telegram id YOKI ichki customerId
```

Muhim qarorlar:
- **Mavjud frontend qayta ishlatildi** (oddiy URL wrapper emas, qayta yozish yo‘q). Web build (`dist/`, Vercel/Telegram) o‘zgarmadi.
- **Platforma adapteri**: Android faqat `__DS_TARGET__ === 'android'` build bayrog‘i **va** `Capacitor.isNativePlatform()` bo‘lganda
  yoqiladi. Oddiy brauzerda "Telegram orqali oching" himoyasi saqlanadi; Android’da bu ekran yo‘q.
- **Server platforma bayrog‘iga ishonmaydi.** `X-Platform` kabi sarlavhalar e’tiborsiz; huquq faqat credentialdan keladi: Telegram
  imzosi (HMAC) yoki server bergan guest sessiya. Noto‘g‘ri `tma` sarlavhasi hech qachon guestga aylanmaydi (alohida sxemalar, fallback yo‘q).
- **Native HTTP** (`CapacitorHttp`): so‘rovlar WebView’dan emas, native qatlamdan ketadi → CORS kerak emas, **CORS o‘zgartirilmadi**
  (hammaga ochilmadi). Debug’da HTTP faqat `src/debug` network config orqali.
- **Credential saqlash**: `SecureStorePlugin` — Android Keystore’dagi AES‑256‑GCM kalit bilan shifrlangan, ilova-private
  SharedPreferences. localStorage/log/URL’da yo‘q. `allowBackup=false` (Keystore kalitlari backupga o‘tmaydi).
- Savat (`localStorage`) credential emas, oldingidek qoldi.

## 2. Guest profil va sessiya

1. Birinchi ochilish: ilova `POST /api/v1/miniapp/guest/session` `{installationId}` chaqiradi (autentifikatsiyasiz).
2. Server `Customer` (telegramUserId = NULL — soxta Telegram ID yo‘q) va `GuestSession` yaratadi; 32 tasodifiy baytdan `dsg_…`
   credential qaytaradi. DB’da faqat SHA-256 hash.
3. Ilova credentialni SecureStore’ga yozadi va `Authorization: Bearer dsg_…` bilan ishlaydi. Qayta ochilganda o‘sha credential tiklanadi.
4. `installationId` — tasodifiy yordamchi yorliq (UUID); **credential emas**. IMEI/Android ID/MAC/fingerprint ishlatilmaydi.
   Faqat installation ID bilan hech qanday profilga kirib bo‘lmaydi (testlangan).
5. Parallel birinchi ochilish: klientda bitta bootstrap (single-flight); serverda har chaqiriq alohida guest (credentialni qayta
   berib bo‘lmaydi). Javob yo‘qolsa, bo‘sh yetim guest qoladi — zararsiz; IP bo‘yicha 20/soat, installationId bo‘yicha 5/soat cheklov.
6. Muddat: 180 kun, ishlatilganda surilib boradi (soatiga bir marta yoziladi). `DELETE /guest/session` — chiqish (revoke).
   Server 401 qaytarsa (muddat/revoke), ilova eski credentialni o‘chirib, bir marta yangi guest boshlaydi (eski guest tarixi tiklanmaydi —
   shuning uchun Telegramga bog‘lash tavsiya etiladi).
7. Guest: menyu, savat, telefon/manzil, checkout (mavjud talablar: telefon + manzil, telefon **tasdiqlangan deb belgilanmaydi**),
   faqat o‘z buyurtmalari. Telefon mosligi bo‘yicha hech narsa avtomatik birlashtirilmaydi.

Funksiya o‘chirgichi: `ANDROID_GUEST_ENABLED=true` bo‘lmasa bootstrap va Bearer sessiyalar 404 (default: o‘chiq).

## 3. Telegramga ixtiyoriy bog‘lash

Profilda: *"Buyurtmalaringizni boshqa qurilmada tiklash uchun Telegramga bog‘lang."* + **Telegramga bog‘lash** tugmasi.

| # | Qadam | Tekshiruv |
|---|-------|-----------|
| 1 | Ilova `POST /me/telegram-link` (guest sessiya) | token 24 bayt, 10 daqiqa, bir martalik; DB’da hash; bitta faol urinish (partial unique index) |
| 2 | Deep link `https://t.me/<bot>?start=lnk_<32 belgi>` (jami 36 ≤ 64) ochiladi | bot username `BOT_USERNAME` yoki botning o‘z `getMe`; sessiya sirlari linkda yo‘q |
| 3 | Bot `/start lnk_…`: Telegram ID **haqiqiy bot update**’dan (`ctx.from`) olinadi, urinishga bog‘lanadi | birinchi foydalanuvchi egasi; boshqasi (replay) = yaroqsiz |
| 4 | Botda **"Ha, bog‘lash"** | CAS: status + bog‘langan Telegram ID mos bo‘lishi shart |
| 5 | Ilova polling (`GET /me/telegram-link/:id`, 40/daq, 3 s) Telegram nomini ko‘rsatadi | identitet faqat bot tasdig‘idan keyin ko‘rinadi |
| 6 | Ilovada **"Ha, bu mening akkauntim"** → `POST …/confirm` | ikki tomonlama tasdiqsiz tugamaydi; boshqa sessiya/guest = 404 |
| 7 | Atomik tranzaksiya, sessiya rotatsiyasi | eski credential revoke, yangi token qaytadi va saqlanadi |

Bekor qilish ikkala tomondan mumkin. Muddat/replay/noto‘g‘ri sessiya/parallel confirm — testlangan.

**Telegram akkaunt oldindan mavjud bo‘lsa** (yangi o‘rnatilgan APK’dan qayta kirish ham shu oqim):
- dublikat Telegram customer yaratilmaydi (`telegramUserId` unique);
- ikkala customer qatori `FOR UPDATE` bilan (id tartibida) qulflanadi; urinish qatori ham → parallel confirm bir marta ishlaydi;
- `Order` va `SupportTicket` qatorlari **qayta bog‘lanadi** (`customerId` o‘zgaradi) — buyurtma, to‘lov, komissiya qatorlari
  qayta yaratilmaydi va o‘zgarmaydi (testda sanalgan);
- **Qoida (hujjatlashtirilgan):** Telegram profil ustun: telefon/ism to‘qnashuvida Telegram qiymati qoladi, guest qiymati faqat bo‘sh
  maydonni to‘ldiradi; manzillar matni (bo‘shliq/registr normallashtirilgan) bir xil bo‘lsa guest nusxasi o‘chadi, qolganlari
  ko‘chadi (limit 10 faqat yaratishda tekshiriladi; ko‘chirishda oshishi mumkin); default manzil — Telegram profilniki, u bo‘lmasa guestniki;
- guest qatori saqlanadi (`mergedIntoId`), sessiyalari revoke; eski guest credential 401;
- `placeOrder` guest qatorini `FOR SHARE` bilan o‘qiydi: merge bilan poygada buyurtma yo‘qolmaydi, tirik profilga yoziladi.

## 4. Sxema va migratsiya

`prisma/migrations/20261029000100_customer_guest_android/migration.sql` (additive):
- `Customer.telegramUserId` NOT NULL olib tashlandi (UNIQUE qoladi; NULL’lar ko‘p bo‘lishi mumkin); `mergedIntoId` + FK + CHECK + index;
- `GuestSession` (hash UNIQUE, CHECK uzunlik 64), `TelegramLinkStatus` enum, `TelegramLinkAttempt` (+ partial unique "bitta faol urinish").
Mavjud ma’lumot buzilmaydi (faqat cheklov yengillashadi). **Asosiy bazaga qo‘llanmagan**; `ds_delivery_test`ga qo‘llangan.
Telegramga bog‘lanmagan customer uchun bot xabarlari yuborilmaydi: notifier'lar belgini "yopadi" (navbat tiqilmaydi), checkout/o‘tish yiqilmaydi.

## 5. API URL sozlash

- API bazasi **build vaqtida** `DS_API_BASE_URL` (oxirida `/`siz). Telefonda `localhost` — telefonning o‘zi; emulyatorda kompyuter = `http://10.0.2.2:4000`;
  haqiqiy telefonda kompyuterning LAN IP’si (`HOST=0.0.0.0` bilan backend) yoki HTTPS tunnel/domen.
- **Release**: `build:android:release` faqat `https://` qabul qiladi (build yiqiladi); release manifestda cleartext yo‘q.
- **Debug**: HTTP faqat `android/app/src/debug/…network_security_config_debug.xml` orqali.
- Eski Cloudflare Quick Tunnel ishlaydi deb taxmin qilinmagan (`vercel.json`dagi URL ishlatilmagan).

## 6. Build va ishga tushirish

Talablar: Node ≥ 20, JDK 21 (Android Studio JBR), Android SDK (platform 34, build-tools 34.0.0), Gradle 8.7 (wrapper o‘zi yuklaydi).

```powershell
cd C:\Users\Acer\Documents\DS\apps\customer-miniapp
$env:DS_API_BASE_URL = "http://10.0.2.2:4000"         # emulyator; haqiqiy telefon: http://<PC-LAN-IP>:4000 yoki https://...
npm install
npm run android:sync                                   # tsc + vite build --mode android + cap sync
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
cd android
.\gradlew.bat assembleDebug
```

`android/local.properties` (`sdk.dir=...`) gitignored, mashinaga xos.

Backend (test bazasi, MOCK):
```powershell
cd C:\Users\Acer\Documents\DS
# .env: MINIAPP_ENABLED=true  ANDROID_GUEST_ENABLED=true  BOT_PAYMENT_MODE=MOCK  GMAIL_ENABLED=false  HOST=0.0.0.0 (telefon uchun)  BOT_USERNAME=<bot>
npx prisma migrate deploy        # faqat TEST baza uchun
npm run dev
```

APK o‘rnatish: `adb install -r app\build\outputs\apk\debug\app-debug.apk` (yoki faylni telefonga ko‘chirib).

## 7. Backend talabi (deploy hali qilinmagan)

APK **shu ishchi daraxtdagi** backendga muhtoj (branch `feat/claude-stage3b`, commitlanmagan): migratsiya
`20261029000100`, `ANDROID_GUEST_ENABLED=true`, `MINIAPP_ENABLED=true`, mijoz boti ishlayotgan bo‘lishi (`BOT_USERNAME` yoki polling). APK ichidagi
manzil — `DS_API_BASE_URL` build vaqtida berilgan qiymat. Deploydan oldin APK’ni production HTTPS manziliga qayta yig‘ish kerak.

## 8. O‘zgargan / yangi fayllar

Backend: `prisma/schema.prisma`, `prisma/migrations/20261029000100_…`, `src/lib/customer-owner.ts`, `src/modules/miniapp/{guest,telegram-link,routes,profile,views}.ts`,
`src/modules/orders/{service,contract}.ts`, `src/modules/refunds/service.ts`, `src/bot/{telegram-link,client,notify,restaurant-notify,support-notify,refunds}.ts`,
`src/server.ts` (BOT_USERNAME), `.env.example`, `.gitignore`, `src/tests/guest.android.db.test.ts`.
Frontend: `apps/customer-miniapp/{vite.config.ts,package.json,capacitor.config.json,src/lib/{platform,session,apiError,api,telegram,types}.ts,src/screens/{TelegramLink,Profile}.tsx,src/components/ui.tsx,src/App.tsx,tests/session.test.ts}`.
Android: `apps/customer-miniapp/android/**` (SecureStorePlugin, MainActivity, manifest, debug config, gradle 8.7 / AGP 8.3.2).

## 9. Natijalar

**APK (debug):** `C:\Users\Acer\Documents\DS\apps\customer-miniapp\android\app\build\outputs\apk\debug\app-debug.apk` (3.9 MB,
debug-imzolangan; `com.dsdelivery.customer`, minSdk 22, targetSdk 34, allowBackup=false, cleartext faqat debug config’da).
Bu APK `DS_API_BASE_URL=http://10.0.2.2:4000` (Android emulyator → kompyuter) bilan yig‘ilgan; boshqa manzil uchun qayta yig‘ing.

| Holat | Tekshiruv |
|---|---|
| CODE PASS | `tsc --noEmit` (backend) toza; `apps/customer-miniapp` `tsc --noEmit` toza |
| CODE PASS | `src/tests/guest.android.db.test.ts` — 9/9 (ds_delivery_test): first launch/qayta ochilish/expiry/revoke, installationId credential emas, parallel bootstrap + rate limit + feature flag, Telegram auth regressiyasi (sxemalar aralashmaydi, soxta platforma sarlavhasi), guest checkout idempotency (6 parallel), ikki guest izolyatsiyasi, MOCK’da komissiya yo‘q, bog‘lanmagan mijozga xabar yuborilmaydi, link: expiry/replay/noto‘g‘ri sessiya/ikki tomonlama tasdiq/bekor, parallel confirm (5×), mavjud Telegram akkauntga merge (tarix, buyurtma/to‘lov/komissiya soni o‘zgarmagan, manzil dublikati, idempotent), ikki guest bir Telegramga parallel |
| CODE PASS | Regressiya (mavjud testlar): `miniapp.db`, `refunds.db`, `checkout.stage6f.db`, `telegram.integration.db`, `support.db`, `matching.test` — 61/61 |
| CODE PASS | Frontend `vitest` 44/44 (shu jumladan yangi `session.test.ts`: single-flight bootstrap, tiklash, 401’dan keyin tashlash, rotatsiya) |
| BUILD PASS | `npm run build` (web, Mini App) o‘zgarishsiz yig‘iladi; `build:android` + `cap sync`; `gradlew assembleDebug` (Gradle 8.7, AGP 8.3.2, JDK 21) — BUILD SUCCESSFUL |
| MANUAL PASS | — **hech narsa qo‘lda/qurilmada sinalmagan** |
| NOT RUN | Haqiqiy qurilma/emulyatorda ishga tushirish; SecureStorePlugin (Keystore) real qurilmada; Telegram ↔ ilova bog‘lash E2E haqiqiy bot bilan; back tugmasi; klaviatura/safe-area; geolokatsiya; release build/imzolash; to‘liq test suite; Android instrumentation testlari |

Eslatma: testlar bog‘lash oqimining bot tomonini servis funksiyalari (`bindFromBot`, `botDecision`) orqali tekshiradi; Telegraf handler (`src/bot/telegram-link.ts`)
haqiqiy Telegram bilan sinalmagan. Bu loyihada o‘rnatilgan paketlar: `@capacitor/{core,app,browser}@6` va dev: `@capacitor/{cli,android}@6.2.2` (aniq versiyalar;
mavjud paketlar yangilanmadi; Prisma 6.18.0 o‘zgarmadi).

## 10. Cheklovlar va productiondan oldingi blokerlar

- **Background bildirishnoma (push): NOT IMPLEMENTED.** Faqat ilova ochiq vaqtdagi (foreground) kuzatuv (mavjud polling). FCM yo‘q.
- Guest sessiya yo‘qolsa (ilova ma’lumoti tozalansa/o‘chirilsa) va Telegramga bog‘lanmagan bo‘lsa — tarix tiklanmaydi.
- Rate limiter xotirada (bitta jarayon); ko‘p nusxali deployda umumiy store kerak (Mini App bilan umumiy blocker).
- Release imzolash, Play Console, ikonka: **qilinmagan**. Mos logotip topilmadi → Capacitor standart ikonkasi (brend yashil fon). Release keystore yaratilmadi.
- `WAITING_CUSTOMER_CONSENT` (narx o‘zgarishiga rozilik) tugmalari faqat Telegram botda; guest uchun bot xabari yo‘q. Bu eski
  "accept-first" oqim (default o‘chiq); yoqilsa guestlar uchun ilovada rozilik ekrani kerak.
- Support (murojaat) hozircha bot orqali; guest uchun ilovada yo‘q.
- `npm audit`: `npm install` bildirgan ogohlantirishlar ko‘rilmadi/`audit fix --force` bajarilmadi.
- Gmail signali REAL to‘lov tasdig‘i emas; komissiya mantig‘i (5 000 UZS, faqat REAL tasdiqlangan va yetkazilgan) o‘zgarmadi; MOCK’da komissiya yozilmaydi (testlangan).
- Haqiqiy qurilmada tekshirilmagan: klaviatura, safe-area, back tugmasi, geolokatsiya ruxsati, brauzer (Custom Tab) → Telegram o‘tishi.

## 11. Qurilmada qisqa test (foydalanuvchi uchun)

1. Backend ishga tushiring (yuqoridagi `.env`), APK o‘rnating, oching → login so‘ralmasdan restoranlar ko‘rinishi kerak.
2. Menyudan mahsulot qo‘shing → savat → checkout (telefon `+998…` va manzil) → buyurtma; MOCK to‘lov tugmasi → holat o‘zgaradi.
3. Ilovani to‘liq yoping va qayta oching → buyurtma va savat joyida (sessiya tiklandi).
4. Profil → manzil qo‘shing → klaviatura ochilganda tugmalar yopilmasligini ko‘ring.
5. Back tugmasi: ochiq oyna yopiladi → ichki sahifadan orqaga → asosiy sahifada ilovadan chiqadi.
6. Profil → **Telegramga bog‘lash** → Telegram ochiladi → botda "Ha, bog‘lash" → ilovada ko‘rsatilgan nomni tekshirib "Ha, bu mening akkauntim".
7. Ilovani o‘chirib qayta o‘rnating → yana bog‘lang → eski buyurtmalar qaytishi kerak.
