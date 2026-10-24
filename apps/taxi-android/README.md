# DS Taxi — taksi operatori ilovasi (Android, Kotlin + Compose)

Taksi kompaniyasi operatori uchun: DS Delivery buyurtmalari bo'yicha taksi so'rovlari shu ilovaga keladi. Telegram taksi paneli o'rniga ishlaydi
(backend `TAXI_TELEGRAM_ENABLED=false`).

## Nima qiladi
- Login/parol bilan kirish (kompaniya uchun bitta login; administrator Telegramda `/newtaxi` yoki `/taxiapp` bilan beradi).
- **Gudok signali**: yangi so'rov (yoki "javob kechikdi / aniqlashtiring") kelganda telefon qisqa ikki ohangli gudok chaladi va har ~2,6 soniyada
  takrorlaydi, javob berilguncha. Ovoz "Budilnik" kanalida (jim rejim o'chirmaydi), ilovada sintez qilinadi (audio fayl yo'q). "Ovozni o'chirish" 30 soniyaga
  o'chiradi, javob berilmagan bo'lsa yana chaladi.
- Fonda ishlash: foreground service (`DispatchService`) + `PARTIAL_WAKE_LOCK`, telefon qayta yoqilganda o'zi ishga tushadi (`BootReceiver`).
  Ekran o'chiq/qulflangan bo'lsa to'liq ekranli bildirishnoma ilovani ochadi.
- Telegram botdagi hamma amallar: Qabul qilish / Rad etish, Taksi yuborildi, Taksi yo'q, Yetkazildi (tasdiq bilan), tafsilotlar (restoran, olib ketish
  manzili va telefoni, yetkazish manzili va GPS, mijoz telefoni, taom tayyorligi). Qo'ng'iroq va xarita tugmalari. Tarix (24 soat).
- Sozlamalar → Tayyorlik: bildirishnoma, signal ovozi, batareya tejash, to'liq ekran ruxsati; "Ovozni sinash".

## Qanday ishlaydi
`Dispatcher` har ~3 soniyada `GET /api/v1/taxi/requests` ni so'raydi (bu ayni paytda "ilova onlayn" signali). `AttentionTracker` (toza mantiq, unit-test)
qaysi so'rov chalishi kerakligini hal qiladi. Amallar `POST /api/v1/taxi/requests/:id/action` — backendda Telegram tugmalari bilan bir xil holat mashinasi.
Backend faqat o'z kompaniyasining so'rovlarini beradi; begona id "topilmadi" bilan bir xil javob oladi.

## Build
```
cd C:\Users\Acer\Documents\DS
powershell -ExecutionPolicy Bypass -File scripts\build-release-apks.ps1 -ApiUrl https://api.sultonxoja.uz -VersionCode N -VersionName x.y.z
```
Natija: `ds-taxi-release-<versiya>.apk` (mijoz va restoran APK'lari bilan birga). Yoki faqat shu modul:
`apps\customer-miniapp\android\gradlew.bat -p apps\taxi-android :app:assembleRelease -PdsApiBaseUrl=https://api.sultonxoja.uz/` (JAVA_HOME = Android Studio jbr).
Unit-test: `:app:testDebugUnitTest`.

## Cheklovlar
- Push (FCM) yo'q: telefon o'chiq, internetsiz yoki ilova "Force stop" qilingan bo'lsa so'rov eshitilmaydi. Server esa 90 soniya poll bo'lmasa administratorlarni ogohlantiradi.
- Ba'zi telefonlarda (Xiaomi, Huawei, Samsung) avtoyuklash/batareya cheklovini qo'lda o'chirish kerak (Sozlamalar ichida yo'riqnoma bor).
