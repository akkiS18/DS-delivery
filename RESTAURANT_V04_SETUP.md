# DS Delivery v0.4 — restoran xodimi uchun Telegram boshqaruvi

**Existing v0.3 backend ustiga xavfsiz PATCH.** Maqsad: mijozning kirimi mos kelgandan keyin restoran xodimi bankdagi haqiqiy tushumni tekshirishi, buyurtmani tayyorlashni boshlashi, vaqt belgilashi va "Tayyor" deb qayd etishi.

> Eslatma: bu sinov bosqichida restoran mas’uli va mijoz **bir xil Telegram botdan**, lekin har xil buyruqlardan foydalanadi. Alohida BotFather tokeni kerak emas. Restoran mas’uli shaxsiy Telegram chatida xabar oladi.

## 1. Backup va PATCH o‘rnatish (PowerShell)

`dsb` loyihangni yoki Git branch’ni zaxirala. Backendni `Ctrl+C` bilan to‘xtat.

```powershell
# PATCH arxivini mavjud dsb papkangga ko'chirgan bo'lsang:
Expand-Archive -Path .\ds-delivery-bot-v0.4-PATCH.zip -DestinationPath . -Force
npm install
npx prisma migrate deploy
npx prisma generate
npm run typecheck
npm run test:restaurant
npm run test:bot
npm run smoke:restaurant
```

Migration `20261013000300_restaurant_telegram` faqat yangi ustunlar va `OrderEvent` jadvalini qo‘shadi; eski Order/Payment ma'lumotlarini o‘chirmaydi. `migrate reset` va `db push --force-reset` ishlatma. `.env`, Google OAuth fayllari va database fayllarini almashtirma.

## 2. Telegram mas’ulini ulash

1. Yangi mas’ul (yoki o‘zing) Telegram’da mavjud **DS Delivery mijoz botini** ochib `/start`, so‘ng `/myid` deb yozadi.
2. Bot qaytargan **faqat raqamlardan iborat Telegram ID**ni ol (bot tokenini emas).
3. **VS Code terminalida, `dsb` papkasidan**, quyidagicha bog‘la:

```powershell
npm run staff:link -- demo-restoran 123456789
```

`123456789` o‘rniga `/myid` bergan raqamni yoz. Demo restoranning `slug`i — `demo-restoran`. Har bir restoranga bitta mas’ul Telegram ID ulanadi. Yangi mas’ulni qayta biriktirish eski mas’ulning kirishini avtomatik bekor qiladi. CLI faqat **ishonchli kompyuter terminalida** ishlatiladi; uni mijoz uchun ochiq API sifatida joylamang.

Bog‘langan Telegram akkauntda `/staff` ni yubor. Avvalgi sinov buyurtmalaridan ko‘p xabar kelmasligi uchun yangi xabarlar asosan biriktirilgandan keyin o‘zgargan buyurtmalarga yuboriladi. Eski faol buyurtmalarni `/staff` orqali ochish mumkin.

## 3. Botni ishga tushirish

`.env` dagi sozlamalar:

```env
BOT_ENABLED=true
BOT_PAYMENT_MODE=MOCK
```

`BOT_TOKEN` avvalgi holatda qoladi. Tokenni hech kimga bermang. Telegram API uchun ilgari ishlagan hotspot internetdan foydalaning.

```powershell
npm run dev
```

**Sinov uchun haqiqiy karta raqamiga pul o'tkazma.** MOCK kartada `***9099` ko‘rsatilishi kerak.

## 4. Telegram’dan end-to-end sinash

- Mijoz akkauntida `/start` → Demo restoran → Demo burger → Savat → Buyurtma berish, telefon, manzil, taksi tanlansin.
- Buyurtma yaratilganda `MOCK kirim` tugmasi bilan **sun'iy kirim** yuborilsin. Agar to‘lov `QUEUED` bo‘lsa, karta bo‘shaguncha kuting; `AWAITING` bo‘lmagan to‘lovni mock qilish mumkin emas.
- To‘lov `MATCHED_UNVERIFIED` bo‘ladi. Restoran mas’uliga (biriktirilgan xodimga) shu buyurtma haqida Telegram xabari keladi. U `/staff` orqali ham buyurtmani ko‘ra oladi.
- Restoran: **MOCK kirimni tasdiqlash** → ikkinchi tasdiqlash. Keyin buyurtma `PAYMENT_CONFIRMED` bo‘ladi.
- Restoran: **10 / 15 / 20 / 30 / 45 / 60 daqiqadan birini** tanlaydi — buyurtma `PREPARING` bo‘ladi.
- Restoran: **Taom tayyor** ni bosadi — buyurtma `READY` bo‘ladi.
- Mijoz `/orders` orqali holatlarni ko‘radi va o‘zgarishlar haqida Telegram xabarlarini oladi.
- Tugmalarni qayta bosib ko‘r: boshqa statusga ikkinchi marta o'tmasligi kerak.
- Begona Telegram akkauntidan `/staff` yoki boshqa restoranning eski tugmasini bosib ko‘r: `RUXSAT YO‘Q` chiqishi kerak.

## 5. DB smoke qanday ishlaydi?

`npm run smoke:restaurant` izolyatsiyalangan test restoran, test mijoz va mock payment yaratadi, xodim ruxsati, bir martalik tasdiq, tayyorlash va tayyor holatlarini hamda uchta audit yozuvini tekshiradi. Yakunda aynan o‘zi yaratgan test ma'lumotlarini o‘chiradi; mavjud restoranlar yoki buyurtmalarga tegmaydi. Telegram’ga xabar yubormaydi.

## 6. Xavfsizlik va mavjud cheklovlar

- UZCARD e-mailidagi summa/karta mosligi **bank tasdig‘i emas**. Haqiqiy karta uchun restoran mas’uli o‘z bank ilovasida tushumni alohida tekshirishi kerak. MOCK rejimda bu faqat test bosqichi.
- `READY` — taom tayyor, **yetkazildi degani emas**. Taksi operatoriga avtomatik yuborish / qayta taqsimlash keyingi bosqich.
- Restoran bitta Telegram akkaunti orqali boshqariladi; xodimlar uchun alohida rollar yo‘q.
- Telegram xabari yuborilib, server javobni qayd etmasdan o‘chib qolsa, xabar takror kelishi mumkin. DB holati faqat bir marta almashadi, harakatlar `OrderEvent` jadvalida saqlanadi.
- Bekor qilish / refund / bahsli kirim / mijozdan kelgan chek haqiqiy verifikatsiyasi bu bosqichga kiritilmagan.
- `npm run typecheck` va `npm run smoke:restaurant` sening lokal PostgreSQL muhitingda bajarilishi kerak. Bu chat muhitida paket registriga ulanish bo‘lmadi, shu bois bu ikki tekshiruvni to‘liq bajarganim haqida da'vo qilmayman.
