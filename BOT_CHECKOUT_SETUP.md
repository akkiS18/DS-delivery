# DS Delivery v0.3 — Telegram Checkout + PaymentService V3

**Bu v0.2 backendga PATCH sifatida o‘rnatiladi.** `.env`, `credentials.json`, `gmail-token.json`, mavjud ma’lumotlar va `node_modules`ni o‘chirmang.

## 1) Yangilash

1. Backendni `Ctrl + C` orqali to‘xtating.
2. **`dsb`** katalogini zaxiralang (yoki Git commit qiling).
3. `ds-delivery-bot-v0.3-PATCH.zip`ni VS Code’dagi mavjud `dsb` katalogiga chiqarib, bir xil nomli fayllarni almashtiring. PATCH ichida `.env` yo‘q.
4. **`.env` ichiga faqat bitta qiymat qo‘shing** (mavjud sozlamalarni saqlang):

```env
BOT_PAYMENT_MODE=MOCK
```

`BOT_ENABLED=true` va `BOT_TOKEN` oldingi kabi qoladi. Telegram API bloklangan Wi-Fi o‘rniga ishlagan hotspot’dan foydalaning.

## 2) Database migratsiyasi (destruktiv emas)

`ds` deb nomlagan haqiqiy backend bazangizga ulanganingizni `.env` dan tekshiring. Avvalgi sinov `ds_payment_v3` bazasini ishlatmang.

```powershell
npm install
npx prisma migrate deploy
npx prisma generate
npm run seed
npm run typecheck
npm run test:bot
```

Migratsiya `TaxiCompany` jadvalini, `Order` ga checkout/telefon/taksi/rozilik ustunlarini hamda `Payment`ga bot bildirishnomasi belgisini qo‘shadi. Mavjud restoranlar va buyurtmalar o‘chirilmaydi. **`migrate reset` kerak emas.**

Agar `npm run seed` mavjud test taomingizni yangilamasa ham, "Demo burger" va "Sinov taksi (TEST)" avtomatik qo‘shiladi.

## 3) Server va smoke

```powershell
npm run dev
```

Yangi VS Code terminalida:

```powershell
npm run smoke
npm run smoke:checkout
```

`smoke:checkout` ikki so‘rov bir vaqtda yuborilganda **bir xil checkoutKey** faqat bitta order va bitta payment yaratishini ham tekshiradi. Tekshiruvlarning ayrimlari oldingi mock buyurtmalar va cooldown tufayli `QUEUED` bo‘lishi mumkin — bu xato emas.

## 4) Telegram’ni sinash

1. Botga `/start` yuboring, **Demo restoran → Demo burger** tanlang.
2. Savatga qo‘shing → **✅ Buyurtma berish**.
3. Telefoningizni Telegram kontakt bilan yuboring yoki `+998901234567` shaklida yozing.
4. **Matnli manzil** yoki **lokatsiya** tanlang. Lokatsiyaga ixtiyoriy mo‘ljal kiritsa bo‘ladi.
5. **Sinov taksi (TEST)** ni tanlang.
6. Boshqa taksiga o‘tish roziligini yoqing/o‘chiring, summani tekshiring va tasdiqlang.
7. Buyurtma va mock karta ko‘rsatiladi (`***9099`). **HAQIQIY PUL YUBORMANG.**
8. **🧪 MOCK kirim** tugmasini bosing; `MATCHED_UNVERIFIED` bo‘lishini tekshiring.
9. `/orders` dan yaratilgan buyurtmani qayta oching; `🔄 Holatni yangilash` ni sinang.

Server qayta ishga tushsa sessiyadagi savat va tugallanmagan checkout tozalanadi. Yaratilgan buyurtma va to‘lov esa PostgreSQL’da saqlanadi.

## 5) Gmail va real to‘lovlar

`GMAIL_ENABLED=true` qilinsa, mavjud Gmail o‘quvchi ishga tushadi. Gmail xabarlari **real** karta va **real** payment uchun ishlatiladi. `BOT_PAYMENT_MODE=MOCK` bo‘lsa, bu botning mock to‘lovlari Gmail bilan aralashmaydi.

**REAL rejimni hozircha yoqmang.** Uni faqat restoran ruxsati, alohida real karta, Gmail monitoringi ishlashi va to‘lov huquqiy tartibi aniqlangach sinash kerak. E-mail summasi mos kelishi bankning mustaqil to‘lov tasdig‘i emas; `MATCHED_UNVERIFIED` avtomatik `PAID` qilinmaydi.

V0.3 kodida REAL uchun qo‘shimcha gating bor: `BOT_PAYMENT_MODE=REAL`, `GMAIL_ENABLED=true`, tegishli restoranning REAL kartasi va env’da uning rekvizitlar xaritasi bo‘lishi kerak. Bu production ishlatishga tayyorligining kafolati emas.

## 6) Nimalar hali YO‘Q?

- Restoranning Telegram buyurtma qabul qilish boti, haqiqiy karta kirimini bank orqali yakuniy verifikatsiya qilish.
- Taksi operatoriga buyurtma yuborish, haydovchi tayinlash, yetkazish bahosi hisoblash.
- Restoranlarning Kotlin APK’i va admin APK’i, rasmli taom katalogi.
- Sessiyani PostgreSQL’ga yozish va haqiqiy production xavfsizlik auditi.

**Eslatma:** Taksi tariflari hisoblanmaydi; yetkazish mijoz va taksi xizmatining alohida hisob-kitobidir.
