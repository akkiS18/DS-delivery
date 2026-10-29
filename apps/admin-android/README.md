# DS Admin — administrator ilovasi (Android, Kotlin + Compose)

Telegram botdagi administrator ishlarini ilovaga ko'chirish rejasi: `docs/PLAN_ADMIN_APP.md`. Bu modul — **A1 + A2 + A3 + A4a + A4b**: kirish, "Diqqat" ro'yxati, signal, pul, kartalar, restoranlar (qo'shish/parol/rasm/o'chirish), platforma sozlamalari, mijoz murojaatlari va taksi.
Qaytarish (A4c) keyingi bosqichda qo'shiladi; hozircha u botda. Sozlamalar tepadagi tishli g'ildirak belgisida.

## Nima qiladi
- **Kirish**: Telegram ID → botga 6 xonali kod keladi → kod → telefon uchun PIN (4–8 raqam). Kod 10 daqiqa amal qiladi, urinishlar cheklangan.
  PIN faqat shu telefonda ekranni himoya qiladi (bir daqiqadan ko'p fonda tursa qayta so'raydi; 10 xato → chiqarib yuboradi). Signal PIN siz ham chalinadi.
- **Diqqat ro'yxati** (server hisoblaydi, `GET /api/v1/admin/attention`): ko'rilmagan buyurtma, naqd buyurtma qabul qilinmadi, to'lov tasdiqlanmadi,
  taksi yordam so'radi, tayyor lekin taksi yo'q, yetkazilmadi, restoran ilovasi o'chiq, pul tekshiruvi, karta kutmoqda, murojaat, Gmail ishlamayapti.
  Ilova har 5 soniyada (signal chalayotganda 3 soniyada) so'raydi.
- **Signal**: shoshilinch (CRITICAL) holat — mashina gudogi, har ~2,6 soniyada; boshqalari — yumshoq qo'sh "pip". "Budilnik" ovozida (jim rejim o'chirmaydi),
  ekran o'chiq/ilova yopiq bo'lsa ham (foreground service + wake lock). Telefon qayta yoqilganda o'zi ishga tushadi.
- **Tugmalar**: "📞 Qo'ng'iroq" (restoranga dialer ochadi va kartani 15 daqiqaga jim qiladi), "Jim: 15 daq / 1 soat" (serverda saqlanadi — boshqa telefonda ham jim),
  "Ovozni o'chirish" (faqat shu telefonda 30 soniya, keyin yana chaladi).
- **Jim soatlar**: standart 01:00–07:00; shu vaqtda faqat shoshilinch holatlar signal beradi, qolganlari ro'yxatda jim turadi. Sozlamalarda o'zgartiriladi yoki o'chiriladi.
- **Xavfsizlik**: `FLAG_SECURE` (skrinshot yo'q), token shifrlangan xotirada, "Barcha qurilmalarni yopish" (yoki botda `/logoutall`).
- Telegram nusxasi (backend): ayrim ogohlantirishlar adminga Telegramga ham boradi (`ADMIN_ATTENTION_TELEGRAM=false` o'chiradi).

## Pul va kartalar (A2)
- **Pul** (`/money` botda): mos kelmagan pul (sabab o'zbekcha tushuntiriladi) — amal tanlanadi va 10–300 belgilik izoh yoziladi; ilova pulga tegmaydi, faqat qaror saqlanadi.
  Restoran 10+ daqiqa tasdiqlamagan to'lovlar alohida ro'yxatda.
- **Kartalar** (`/cards`, `/pool`, `/platformcard`, `/collect` botda): tasdiq kutayotgan karta — to'liq raqam faqat shu oynada ko'rinadi (so'rovi auditga yoziladi),
  tasdiqlash ikki bosqichli. Platforma kartalari: 30 kunlik aylanma foizi (70% — jim ogohlantirish, 90% — Diqqatda yumshoq signal), karta qo'shish
  (darhol ishlatilmaydi, avval tasdiqlanadi), restoranni platforma kartalariga o'tkazish/qaytarish (ochiq to'lov bo'lsa rad etiladi).
- "Diqqat" kartalaridagi "Pulni ochish" / "Kartalarni ochish" tugmasi tegishli oynaga o'tkazadi.

## Yordam (A4a)
- **Murojaatlar** (`/tickets` botda): ochiq va oxirgi 7 kunda hal qilinganlar; "javob kutmoqda" belgisi (mijoz oxirgi yozgan). Murojaatni ochsangiz — butun suhbat (5 soniyada yangilanadi).
- Tugmalar botdagi bilan bir xil qoidalar: "Men oldim", javob yozish (olinmagan murojaatga javob yozsangiz u sizga o'tadi — botdagi "Reply" kabi), boshqa adminga o'tkazish / menga o'tkazish,
  "Hal qilindi" (mijozga xabar ketadi), "Qayta ochish". Faqat egasi javob yozadi va yopadi. Har bir bosish o'z kaliti bilan yuboriladi: qayta yuborilsa ham xabar ikki marta ketmaydi.
- Mijoz Telegramdan yozgan bo'lsa javob botga ketadi, ilovadan yozgan bo'lsa — ilovadagi suhbatiga. Admin Telegramidagi kartalar ham yangilanadi.

- **Taksi** (A4b): *Taksi muammolari* (`/taxiadmin`): javobsiz / rad etilgan / yordam kerak bo'lgan so'rovlar, tarixi bilan. Qayta yuborish va boshqa kompaniyaga o'tkazish uchun
  10–300 belgilik izoh YOZILADI ("haydovchi YUBORILMAGANINI operator bilan aniqlaganman"), "Haydovchi allaqachon yuborilgan" esa faqat qayd etadi, yangi buyurtma yaratmaydi.
  *Kompaniyalar* (`/newtaxi`, `/taxiapp`, `/deletetaxi`): yangi kompaniya (login/parol BIR MARTA ko'rsatiladi), yangi parol (kirgan qurilmalar chiqarib yuboriladi), o'chirish/arxivlash.
  "Diqqat"dagi "taksi yordam so'radi" va "tayyor, taksi yo'q" kartalari shu bo'limni ochadi.

## Boshqaruv (A3a)
- **Restoranlar** (`/restaurants`): faol/to'xtatilgan, kartalar soni; o'chirish ikki bosqichli, restoran ilovasidan chiqarib yuboriladi.
  Shu yerning o'zida (A3b): yangi restoran (`/newrestaurant`; parol BIR MARTA ko'rsatiladi, tizim saqlamaydi), yangi parol (`/resetpassword`),
  Telegram xodimini ulash (`/linkstaff`), rasm (`/restaurantphoto`; galereyadan, 1280 px gacha kichraytirilib yuboriladi), o'chirish/arxivlash (`/deleterestaurant`:
  tarixi yo'q — butunlay o'chadi, tarixi bor — arxivlanadi, tugallanmagan buyurtma bo'lsa — rad etiladi).
- **Komissiya** (`/commission`): haftalik to'lanishi kerak summa; "to'landi" faqat qayd etadi (pulga tegmaydi), izoh kamida 10 belgi, summa o'zgargan bo'lsa hech narsa yozilmaydi.
- **Platforma**: real to'lov (`/payments`, ochish ikki bosqichli va botdagi to'siqlar bilan bir xil), naqd (`/cash`), xizmat haqi (`/fee`), taksi rejimi (`/taxi`), reyting tartibi va baholar (`/ratings`).
  Har bir o'zgarish auditga yoziladi va admin Telegram chatiga ham xabar qilinadi.

## Backend
`ADMIN_APP_ENABLED=true` bo'lmasa API 404 qaytaradi. Migratsiyalar: `20261107000200_admin_app_auth`, `20261107000300_admin_attention_ack`.

## Build
```
cd C:\Users\Acer\Documents\DS
powershell -ExecutionPolicy Bypass -File scripts\build-release-apks.ps1 -OnlyAdmin -ApiUrl https://api.sultonxoja.uz -VersionCode N -VersionName x.y.z
```
Natija: `ds-admin-release-<versiya>.apk` (`-OnlyAdmin`siz — boshqa uchta ilova bilan birga). Faqat shu modul:
`apps\customer-miniapp\android\gradlew.bat -p apps\admin-android :app:assembleRelease -PdsApiBaseUrl=https://api.sultonxoja.uz/` (JAVA_HOME = Android Studio jbr; keystore `DS_KEYSTORE_*` muhit o'zgaruvchilarida).
Unit-test: `apps\customer-miniapp\android\gradlew.bat -p apps\admin-android :app:testDebugUnitTest` (AttentionTracker, PinLock, Format, ImagePrep).

## Holat
Kod yozilgan, lekin **kompilyatsiya qilinmagan va telefonda sinalmagan** (`docs/PENDING_MANUAL_TESTS.md` H47). Birinchi build'da kompilyatsiya xatolari chiqishi mumkin.
