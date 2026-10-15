**v0.3:** Telegram checkout qo‘shildi. Qarang: [BOT_CHECKOUT_SETUP.md](BOT_CHECKOUT_SETUP.md).

# DS Delivery — Backend Starter v0.1

**Backend birinchi. Hali mijoz Telegram boti ulanmagan. Frontend yo‘q.**

Texnologiyalar: Node.js 20.12+ (Node 22 tavsiya qilinadi), TypeScript, Fastify 5, Prisma 6.18.0, PostgreSQL, UZCARD Gmail Reader (Payment CLI V3'dan ko‘chirildi).

## Qaysi qismi tayyor?

- `/health`, restoran ro‘yxati, menyu API
- Ichki API key bilan himoyalangan endpointlar: restoran va mahsulot yaratish, karta qo‘shish, buyurtma yaratish, buyurtma holatini o‘qish, payment review
- Buyurtma summasi **serverdagi** mahsulot narxidan hisoblanadi. Mijoz o‘z narxini yubormaydi.
- Buyurtma + Payment **bitta DB tranzaksiyasida** yaratiladi.
- Har bir Card va Payment `restaurantId` bilan ajratiladi.
- V3 engine: karta + summa bo‘yicha band qilish, navbat, cooldown, eski/noaniq xabarni REVIEW_REQUIRED qilish va DB unique index.
- Gmail Reader: ixtiyoriy, hozircha o‘chirilgan; ruxsatli UZCARD kirim xabarlarini o‘qiydi.
- `MOCK` rejimdagi kirim buyurtma holatini `PAYMENT_MATCHED_UNVERIFIED`ga o‘tkazadi; **hech qachon `PAYMENT_CONFIRMED` qilmaydi**.
- `npm run smoke`: hech qanday UI'siz API + DB + payment zanjirini tekshiradi.

## 0. Eski loyihangga tegma

Yangi loyiha uchun alohida PostgreSQL bazasi **`ds_delivery`** yaratiladi.
`ds_payment_v3`, eski `Platform` va V3 kodlari o‘z joyida qoladi.

## 1. Fayllarni ochish (Windows / VS Code)

ZIP'ni yangi `ds-delivery-backend` papkasiga och va VS Code'da shu papkani och. VS Code terminali (PowerShell):

```powershell
node -v
Copy-Item .env.example .env
```

`.env` faylini tahrirla:

```env
DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@localhost:5432/ds_delivery?schema=public"
HOST=127.0.0.1
PORT=4000
INTERNAL_API_KEY=BU_YERGA_UZUN_TASODIFIY_SECRET
GMAIL_ENABLED=false
```

API kalitini olish uchun:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Chiqqan qiymatni `.env`dagi `INTERNAL_API_KEY`ga yoz. Bu kalitni Telegram frontendga yoki GitHub'ga joylama. Postgres parolingda maxsus belgilar (`@`, `#`, `:`) bo‘lsa `DATABASE_URL`da URL-encode qilish lozim.

## 2. PostgreSQL bazasini yarat

**pgAdmin** → Databases → Create → Database → **`ds_delivery`** → Save.

`ds_delivery` nomli bo‘sh bazadan foydalan. Migratsiyani eski `ds_payment_v3` bazasiga o‘rnatma.

## 3. O‘rnatish va ishga tushirish

```powershell
npm install
npx prisma generate
npx prisma migrate deploy
npm run seed
npm run test
npm run dev
```

`npm run seed` `demo-restoran` va 21 000 so‘mlik sinov burgeri hamda **mock** `***9099` kartani yaratadi. Restoranga haqiqiy karta raqami kiritilmaydi. Terminalda demo restoran va mahsulot ID'sini ham chiqaradi.

Backend ishlayotganini boshqa VS Code terminalidan tekshir:

```powershell
Invoke-RestMethod http://127.0.0.1:4000/health
Invoke-RestMethod http://127.0.0.1:4000/api/v1/restaurants
Invoke-RestMethod http://127.0.0.1:4000/api/v1/restaurants/demo-restoran/menu
```

## 4. To‘liq terminal testi

**Backend ishlayotgan holda** ikkinchi terminalda:

```powershell
npm run smoke
```

Skript quyidagi integratsiya yo‘lini tekshiradi:

```text
GET /health -> restoran -> yangi sinov mahsuloti
-> POST /internal/orders (MOCK)
-> Payment AWAITING, ***9099
-> POST /internal/payments/mock-incoming
-> Payment MATCHED_UNVERIFIED
-> Order PAYMENT_MATCHED_UNVERIFIED
-> noto‘g‘ri summa => REVIEW_REQUIRED
```

Boshqa terminalda tekshirish uchun avval `.env`dagi kalitni ol:

```powershell
$env:DS_API_KEY = (Get-Content .env | Where-Object { $_ -match '^INTERNAL_API_KEY=' }) -replace '^INTERNAL_API_KEY=', ''
$headers = @{ 'x-internal-api-key' = $env:DS_API_KEY }
Invoke-RestMethod http://127.0.0.1:4000/api/v1/internal/orders -Headers $headers
Invoke-RestMethod http://127.0.0.1:4000/api/v1/internal/payments/reviews -Headers $headers
```

Buni faqat lokal sinov uchun ishlat. Keyinchalik bot uchun alohida, cheklangan huquqli autentifikatsiya kerak.

## 5. PostgreSQL parallel test (ixtiyoriy)

```powershell
npm run test:db
```

Sinov vaqtincha yangi test restoran, ikkita mock karta, sakkizta bir xil summali parallel buyurtma yaratadi, so‘ng shu test yozuvlarini tozalaydi. **Faqat lokal/sinov DB** uchun.

## 6. Gmail'ni yoqish (keyingi bosqich)

Agar V3'dagi UZCARD Gmail Reader'ni yangi backendda sinamoqchi bo‘lsang:

1. O‘z kompyuteringda eski V3 papkangdagi `credentials.json` va `gmail-token.json` fayllarini yangi backend **ildiz papkasiga** nusxala.
2. `.env`da `GMAIL_ENABLED=true` va `GMAIL_FROM=noreply@info.uzcard.uz` qilib yoz.
3. Backendni qayta ishga tushir: `Ctrl+C`, so‘ng `npm run dev`.
4. Gmail eski xatlarni qayta ko‘rishi mumkin. Yangi DB sabab eski kirimlar `REVIEW_REQUIRED` bo‘lishi tabiiy.

Ushbu backenddagi demo MOCK karta Gmail bilan aralashtirilmaydi. Real karta qo‘shish uchun quyidagi ichki endpointdan foydalanish mumkin, **lekin haqiqiy pulni avtomatik tasdiqlash uchun tizim hozircha production tayyor emas.**

```
POST /api/v1/internal/cards
Headers: x-internal-api-key: <KEY>
JSON: {"restaurantId":"...","last4":"8167","isTest":false}
```

**Eslatma:** demo karta so‘nggi 4 raqami `9099` bilan farq qilishi kerak. Faqat karta so‘nggi 4 raqami saqlanadi; mijozga to‘lov rekvizitini ko‘rsatish va haqiqiy kartaning to‘liq ma'lumotlarini xavfsiz saqlash **hali amalga oshirilmagan**. Faqat tasdiqlangan restoranning o‘z kartasiga ruxsat bilan ulaniladi.

## REST endpointlar

Public (faqat o‘qish):

```
GET  /health
GET  /api/v1/restaurants
GET  /api/v1/restaurants/:slug/menu
```

`x-internal-api-key` talab qilinadi:

```
POST /api/v1/internal/restaurants
POST /api/v1/internal/restaurants/:restaurantId/products
POST /api/v1/internal/cards
GET  /api/v1/internal/cards
POST /api/v1/internal/orders
GET  /api/v1/internal/orders
GET  /api/v1/internal/orders/:id
GET  /api/v1/internal/payments/status
GET  /api/v1/internal/payments/reviews
POST /api/v1/internal/payments/mock-incoming   # development only, MOCK cards only
```

`POST /api/v1/internal/orders` misol:

```json
{
  "restaurantId": "RESTAURANT_ID",
  "telegramUserId": "123456789",
  "customerName": "Mijoz",
  "addressText": "Bozor yonidagi uy",
  "paymentMode": "MOCK",
  "items": [ { "productId": "PRODUCT_ID", "quantity": 1 } ]
}
```

`paymentMode: "REAL"` restoran real kartasini ishlatishi mumkin, lekin Gmail xabaridagi moslik hali `MATCHED_UNVERIFIED`, haqiqiy bank tasdig‘i emas. Asosiy DS Delivery botini ishlab chiqmaguncha ushbu API kalitini mijozlarga bermang.

## Hozir qilinmagan ishlar (keyingi bosqichlar)

- **Mijoz Telegram botining kodi** (bot allaqachon Telegramda ochilgan, lekin token hali ulanmagan)
- Restaurant Telegram bot, taksi operatori bot, Kotlin restaurant APK / admin APK
- Admin login/parol, harakatlar tarixi va xodim huquqlari; `INTERNAL_API_KEY` faqat developer sinovi uchun
- Yetkazish manzili, taksi tanlash, buyrutma statuslari UI oqimi
- Real karta rekvizitlarini xavfsiz ko‘rsatish, bir nechta Gmail inbox'ini restoranlarga bog‘lash
- Payment tasdiqlash jarayoni, qaytarish, shartnoma va restoran hisob-kitobi
- Soxta/kirishilmagan e-mail orqali tasdiq xavfini bartaraf qilish: email bank API'si emas
- `last4` **global unique**: Gmail faqat so‘nggi 4 raqamni bergani uchun hozir bir xil `last4` bilan ikki karta ishlamaydi. Ko‘p restoran uchun alohida xabar manbasi va to‘liq identifikator talab etiladi.
- Bir necha serverda Gmail reader/maintenance leader election va keng ko‘lamli kuzatuv
- `NODE_ENV=production` bilan haqiqiy deployment, HTTPS, rate limit, audit log, bank/shaxsiy ma'lumot himoyasi

**Ehtiyot:** karta egasi va bankning foydalanish shartlariga muvofiqlikni haqiqiy restoran pulini qabul qilishdan oldin aniqlashtiring.

## Muammo chiqsa

- `P1000`: PostgreSQL paroli xato
- `P1001`: PostgreSQL ishlamayapti
- `P1003`: `ds_delivery` bazasi yaratilmagan
- `P3005`: baza bo‘sh emas (yangi bo‘sh DB ishlat)
- `401`: `INTERNAL_API_KEY` noto‘g‘ri
- `npm run smoke`: backend boshqa terminalda ishlab turgan bo‘lishi kerak
- `Gmail OAuth`: testing rejimida Google Console → Audience → Test users'ga xat keladigan Gmail manzilingni qo‘sh

### Muhim cheklov

Bu muhitda `npm install` ishlamay qoldi (npm registry'ga tarmoq yo‘q). Shu sababli Fastify/Prisma bilan kompilyatsiya va PostgreSQL integratsiya testlarini aynan shu sessiyada ishga tushira olmadim. V3 payment core sinovdan o‘tgan kod asosida ko‘chirildi, biroq bu **yangi** backend to‘liq ishlashi sening Windows/PostgreSQL muhitingda tasdiqlanadi. Agar TypeScript yoki Prisma xatosi chiqsa, xato matnini yubor, tuzatamiz.

## V0.2 — mijoz Telegram boti

V0.2 da `src/bot/client.ts` va `src/bot/cart.ts` qo'shildi. Lokal `BOT_ENABLED=true` va `BOT_TOKEN=...` bilan polling rejimida ishlaydi. Yangi DB migratsiyasi talab etilmaydi. To'liq boshlash yo'riqnomasi: [BOT_SETUP.md](BOT_SETUP.md). Checkout va to'lov hali ulanmagan.

## v0.4 — Restoran mas’ulining Telegram interfeysi

`RESTAURANT_V04_SETUP.md` fayliga qarang. `npm run staff:link -- demo-restoran <TG_ID>` orqali bitta vakolatli Telegram akkaunti biriktiriladi. `/staff` orqali PAYMENT_MATCHED_UNVERIFIED → PAYMENT_CONFIRMED (bankni qo‘lda tekshirish) → PREPARING (tayyorlash vaqti) → READY bosqichlari boshqariladi. Yangi `OrderEvent` jadvali o‘zgarish tarixini saqlaydi. Hozircha taxi dispatch va yetkazish integratsiyasi yo‘q.

## v0.5 — Taxi operatori (2-kun)

- Taksi operatori mavjud botda `/taxi` orqali kelgan buyurtmani qabul qiladi yoki rad etadi.
- Chaqirish vaqti restoran tayyorlash muddatidan hisoblanadi, `READY` erta bo'lsa darhol chaqiriladi.
- `NO_TAXI` bo'lsa va mijoz ruxsat bergan bo'lsa fallback; sukut/timeout bo'lsa aniq javobsiz fallback **yo'q**.
- TaxiDispatch holati order oshxona holatidan alohida, DB'da barqaror saqlanadi.
- [To'liq o'rnatish va sinov qo'llanmasi](TAXI_V05_SETUP.md)
