# DS Delivery — mijoz Telegram boti (v0.2)

Bu yangilanish **mavjud DS Delivery backend v0.1** loyihasiga mo'ljallangan. Restoran, menu, savatning birinchi bosqichi. **Buyurtma berish, bank to'lovi yoki mijozga karta ko'rsatish bu versiyada yo'q.**

## 1. Yangilanishni qo'llash (Windows PowerShell)

VS Code da hozir ishlayotgan serverni `Ctrl+C` bilan to'xtating. Backend papkangizda (`package.json` bor joyda) quyidagilarni bajaring:

```powershell
# Ixtiyoriy: avval server fayllarini zaxiralang
Copy-Item src/server.ts src/server.v01.backup.ts.txt
Copy-Item src/lib/env.ts src/lib/env.v01.backup.ts.txt
# ds-delivery-bot-v0.2-PATCH.zip'ni backend papkangizga ko'chiring
Expand-Archive -Path .\ds-delivery-bot-v0.2-PATCH.zip -DestinationPath . -Force
npm install telegraf@^4.16.3
```

**ESLATMA:** Patch `.env`, PostgreSQL ma'lumotlari, Prisma schema va payment modulini o'zgartirmaydi. `src/server.ts` va `src/lib/env.ts` fayllarini yangilaydi va `src/bot/` qo'shadi. Sizda bu ikki faylda qo'shimcha shaxsiy o'zgarishlar bo'lsa, avval ko'rib chiqing. Test sifatida foydalanuvchilar faqat private chat'da ishlaydi.

## 2. Bot tokenini lokal `.env` fayliga kiriting

BotFather bergan tokenni hech kimga yubormang. `.env` faylingizning OXIRIGA qo'shing:

```env
BOT_ENABLED=true
BOT_TOKEN=123456789:PASTE_REAL_TOKEN_HERE
```

`BOT_TOKEN` o'rniga o'zingizning haqiqiy tokeningizni qo'ying. UZCARD Gmail sozlamalaringiz va `DATABASE_URL` o'zgarishsiz qolsin.

## 3. Ishga tushiring

```powershell
npm run typecheck
node --import tsx --test src/bot/cart.test.ts
npm run dev
```

Agar `npm run typecheck` xato bersa, terminalning xato matnini yuboring; bu muhitda Telegraf npm paketini o'rnatib to'liq compile tekshirib bo'lmadi.

Server terminalida odatda:

```text
Server listening at http://127.0.0.1:4000
Telegram client bot started in polling mode
```

*Gmail'dagi oldingi UZCARD kirimlari saqlanadi. Botga bu ma'lumotlar uzatilmaydi.*

## 4. Telegram sinovi

O'zingiz yaratgan mijoz botining shaxsiy chatini oching:

1. `/start` -> restoranlar ro'yxati. Seed'dan `Demo restoran` ko'rinishi kerak.
2. `Demo restoran` -> menyu. `Demo burger` ko'rinishi kerak.
3. `Demo burger` -> `Savatga qo'shish` tugmasini 2 marta bosing.
4. `Savat` -> 2 × 21 000 = 42 000 so'm ko'rinishi kerak.
5. `➖` -> 21 000 so'm; `➕` -> yana 42 000 so'm; `🗑` -> bo'sh savat.
6. `/reset` -> savatni tozalash; `/help` -> buyruqlar.

`/start`, `/menu`, `/cart`, `/reset`, `/help` buyruqlari bor. Restoran faqat `isActive=true` bo'lsa ko'rinadi. `isPaused` bo'lsa menyuda ogohlantirish chiqadi. Savat faqat bitta restoran uchun; boshqasini tanlaganda savat yangilanadi.

## Cheklovlar

- Hozircha savat **RAM xotirada** (Telegraf session). Server restart bo'lsa, savatlar tozalanadi.
- Restoran/menyu/savat funktsiyasi ishlaydi. **Buyurtma, taksi tanlash va to'lov hali yo'q.**
- Bot uchun `polling` ishlatiladi; Telegram webhook kerak emas. Bot tokeni bilan **boshqa bot instansiyasini parallel ishlatmang** (409 Conflict bo'lishi mumkin).
- OAuth tokenlar, `.env`, maxfiy ma'lumotlarni GitHub'ga joylamang.
- Haqiqiy Telegram tarmog'i bilan bog'liq xatolar va TypeScript compile tekshiruvi foydalanuvchi lokal muhitida yakunlanadi.

## Keyingi qadam

Birgalikda Telegramda `/start` -> `Demo restoran` -> `Demo burger` -> `Savat` zanjirini tekshiramiz. Keyin telefon, lokatsiya/matnli manzil, taksi kompaniyasini tanlash va PaymentService bilan checkout integratsiyasini alohida boshlaymiz.
