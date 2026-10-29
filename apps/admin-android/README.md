# DS Admin — administrator ilovasi (Android, Kotlin + Compose)

Telegram botdagi administrator ishlarini ilovaga ko'chirish rejasi: `docs/PLAN_ADMIN_APP.md`. Bu modul — **A1 bosqichi**: kirish + "Diqqat" ro'yxati + signal.
Pul/kartalar (A2), restoran va sozlamalar (A3), qo'llab-quvvatlash/taksi/qaytarish (A4) keyingi bosqichlarda qo'shiladi; hozircha ularning hammasi botda.

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

## Backend
`ADMIN_APP_ENABLED=true` bo'lmasa API 404 qaytaradi. Migratsiyalar: `20261107000200_admin_app_auth`, `20261107000300_admin_attention_ack`.

## Build
```
cd C:\Users\Acer\Documents\DS
powershell -ExecutionPolicy Bypass -File scripts\build-release-apks.ps1 -OnlyAdmin -ApiUrl https://api.sultonxoja.uz -VersionCode N -VersionName x.y.z
```
Natija: `ds-admin-release-<versiya>.apk` (`-OnlyAdmin`siz — boshqa uchta ilova bilan birga). Faqat shu modul:
`apps\customer-miniapp\android\gradlew.bat -p apps\admin-android :app:assembleRelease -PdsApiBaseUrl=https://api.sultonxoja.uz/` (JAVA_HOME = Android Studio jbr; keystore `DS_KEYSTORE_*` muhit o'zgaruvchilarida).
Unit-test: `apps\customer-miniapp\android\gradlew.bat -p apps\admin-android :app:testDebugUnitTest` (AttentionTracker, PinLock, Format).

## Holat
Kod yozilgan, lekin **kompilyatsiya qilinmagan va telefonda sinalmagan** (`docs/PENDING_MANUAL_TESTS.md` H47). Birinchi build'da kompilyatsiya xatolari chiqishi mumkin.
