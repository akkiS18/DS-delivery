# DS Delivery v0.5 — Taxi dispatcher (2-kun)

**Holati:** Kod tayyor; sof taxi workflow unit testlari shu muhitda o'tgan. PostgreSQL + Prisma + Telegraf integratsiyasi foydalanuvchi kompyuterida sinovdan o'tishi kerak.

## Arxitektura

- **Mijoz** botda taksi kompaniyasini tanlaydi va fallback roziligini belgilaydi (v0.3).
- **Restoran xodimi** `/staff` orqali to'lovni mustaqil tekshiradi va tayyorlash vaqtini tanlaydi (v0.4).
- Aynan `START_PREPARING` tranzaksiyasida `TaxiDispatch` yozuvi yaratiladi, `dueAt = prepStartedAt + max(0, prepMinutes - TAXI_LEAD_MINUTES)`.
- Agar ovqat erta tayyor bo'lsa, `READY` shu rejalashtirilgan chaqiruvni darhol faollashtiradi.
- PostgreSQL scheduler operatorning **shaxsiy Telegramiga** xabar yuboradi. Operator `/taxi` orqali **Taksi yuborildi** / **Taksi yo'q** deb javob beradi.
- **Taksi yo'q** + mijozning oldingi roziligi = boshqa *biriktirilgan, faol* operatorga yangi so'rov. Avvalgi so'rov `DECLINED` bo'ladi.
- **Operator javob bermasa**, so'rov `CANCELLATION_PENDING` ga o'tadi. Operatorning **aniq tasdig'isiz** avtomatik boshqa mashina chaqirilmaydi (ikkita haydovchi xavfi).
- Operatorning `ASSIGNED` degani **haydovchi yuborilgan**, bu **yetkazib berilgan** degani emas. `Order.status` oshxona uchun `PREPARING/READY` bo'lib qoladi; `TaxiDispatch.status` — alohida.
- DB partial unique indeksi bir order uchun bittadan ortiq faol dispatch bo'lishini bloklaydi.
- Telegram xabarini yuborish `at-least-once`: restart atrofida bitta xabar takrorlanishi mumkin; callback operatsiyasi idempotent. Bir buyurtmaga faqat bir haydovchi yuborish haqidagi operator ko'rsatmasi amal qiladi.
- To'lov MOCK bo'lsa, Telegram xabarida **haqiqiy haydovchi yubormang** degan katta ogohlantirish bo'ladi.

## PATCH o'rnatish (mavjud v0.4 `dsb` papkasida)

1. `npm run dev` va eski test jarayonlarini `Ctrl + C` bilan to'xtat.
2. `dsb` papkangni zaxirala. **`node_modules`, `.env`, `credentials.json`, `gmail-token.json` fayllarini o'zgartirma.**
3. ZIP'ni `dsb` ichiga qo'y va PowerShell'da:

```powershell
Expand-Archive -Path .\ds-delivery-bot-v0.5-PATCH.zip -DestinationPath . -Force
npm install
npx prisma migrate deploy
npx prisma generate
npm run typecheck
npm run test:taxi
npm run smoke:taxi
npm run smoke:restaurant
npm run smoke:checkout
```

**Migratsiya nomi:** `20261014000100_taxi_dispatch`. `migrate reset` va `db push --force-reset` ishlatma. `npx prisma generate` `EPERM` qaytarsa, barcha Node dev jarayonlari to'xtaganini tekshir.

## `.env` sozlamalari (ixtiyoriy)

```env
TAXI_LEAD_MINUTES=7
TAXI_OPERATOR_RESPONSE_SECONDS=180
TAXI_WORKER_INTERVAL_SECONDS=5
# TAXI_ALERT_TELEGRAM_ID=TELEGRAM_ADMIN_ID
```

Agar qo'shilmasa, yuqoridagi default qiymatlar ishlaydi. `TAXI_ALERT_TELEGRAM_ID` admin shaxsiy Telegram ID'si. Botga oldin `/start` yuborgan bo'lishi kerak. **Tokenni hech kimga yuborma**.

## Telegram operatorini ulash

1. Operator (sinovda o'zing ham bo'lishing mumkin) mavjud DS Delivery botiga `/start`, so'ng `/myid` yuboradi.
2. Terminalda (botni vaqtincha to'xtatsang ham bo'ladi):

```powershell
npm run taxi:link -- "Sinov taksi (TEST)" 123456789
```

`123456789` o'rniga operatorning **haqiqiy Telegram ID** raqamini yoz. Bu xodimning restorandagi ID'si bilan bir xil bo'lishi **sinov uchun mumkin**, ammo real hayotda alohida mas'ullar qulayroq.

3. Restoran olib ketish manzilini xabar uchun sozla (sinov qiymatlari o'zingniki bilan almashtiriladi):

```powershell
npm run restaurant:pickup -- demo-restoran +998901234567 "Ziyovuddin, TEST restoran, markaz"
```

4. `npm run dev` — terminalda `Taxi dispatch worker started (DB-backed)` chiqishi kerak.

## Telegramdagi haqiqiy MOCK sinov (real pul / haydovchi yuborma)

1. Mijoz botda **yangi** MOCK buyurtma ochadi, `Sinov taksi (TEST)`ni tanlaydi.
2. MOCK to'lov → restoran `/staff` → MOCK tasdiq → 10 daqiqa tayyorlash vaqtini tanla.
3. `TAXI_LEAD_MINUTES=7` bo'lsa, so'rov **3 daqiqadan keyin** yuboriladi. Tezroq sinov uchun restoranda **Taom tayyor** tugmasini bos — reja darhol faollashadi (5 soniya ichida worker ishlaydi).
4. Operator Telegramda xabar ko'radi yoki `/taxi` yuboradi. `Taksi yuborildi` ni bos.
5. Mijoz va restoran holat haqida xabar oladi. `/orders`da yetkazish bo'limida operator javobini ko'rish mumkin.

## Ikkinchi operator / fallback sinovi

Ikkinchi Telegram akkaunt kerak. Bitta Telegram ID ni ikkita taksi kompaniyasiga biriktira olmaysan.

```powershell
npm run taxi:add -- "Ikkinchi sinov taksi"
npm run taxi:link -- "Ikkinchi sinov taksi" 987654321
```

Mijoz checkout'da **"Boshqa taksiga ruxsat: HA"** ni yoqqan bo'lishi kerak. Restoran tayyorlashni boshlaydi, operator 1 `Taksi yo'q` deydi, shunda ikkinchi operatorga so'rov ketadi. Birinchi operatorning eskirgan tugmasi rad etiladi.

## Operator javob bermasa

Operator javob muddati o'tgach yangi haydovchi avtomatik chaqirilmaydi. Avvalgi kompaniyadan `Haydovchi yuborilmadi` tasdig'i kelgachgina boshqa operatorga o'tish mumkin. Agar operator umuman javob bermasa, holat tekshiruvda qoladi va administrator qo'lda bog'lanadi. Bu xavfsizlik uchun ataylab qilingan tanlov.

## Chegaralar

- Demo to'lovlar haqiqiy pul emas; Gmail kirimini avtomatik haqiqiy bank tasdig'iga aylantirmaymiz.
- Bu bosqich **yetkazilganini** tasdiqlamaydi, taksi narxini hisoblamaydi va avtomatik komissiya undirmaydi.
- Buyurtmani bekor qilish / taksi so'rovini bekor qilishni qo'lda boshqarish keyingi bosqich; real pilotda bunga alohida protsedura kerak.
- Eskidan allaqachon `PREPARING/READY` bo'lgan buyurtmalar uchun avtomatik o'tgan sanali taksi so'rovi yaratmaymiz — **yangi buyurtma** bilan sinang.
- Backendning bitta lokal polling jarayoni uchun mo'ljallangan; productionda xabarlarning qayta yuborilishi va worker monitoringi yana sinovdan o'tadi.
