# Customer Android — haqiqiy telefon sinovi

Faqat `ds_delivery_test`, MOCK to‘lov, `GMAIL_ENABLED=false`. Haqiqiy to‘lov va taksi chaqirish yo‘q.
Tafsilot: `docs/CUSTOMER_ANDROID_MVP.md`.

## Tasdiqlangan holat (2026-10-21)
- Migratsiya: `20261029000100_customer_guest_android` (oxirgi, 19 ta ichida; tartib buzilmaydi — oldingilar ham 202610xx).
- `.env` → baza `ds_delivery_test` (`prisma migrate status`: up to date). Asosiy bazaga hech narsa qo‘llanmagan.
- Branch `feat/claude-stage3b`, hammasi commitlanmagan.
- `.env`: `MINIAPP_ENABLED=true`, `BOT_PAYMENT_MODE=MOCK`, `GMAIL_ENABLED=false`, `HOST=0.0.0.0`, `PORT=4000`. `ANDROID_GUEST_ENABLED` `.env`da yo‘q — quyida buyruq qatorida beriladi (`.env` o‘zgartirilmaydi).

## Backendni ishga tushirish (PowerShell)
```powershell
cd C:\Users\Acer\Documents\DS
npx prisma migrate status          # "Database schema is up to date" va ds_delivery_test
$env:ANDROID_GUEST_ENABLED = "true"
npm run dev                        # API + customer bot (polling) bitta jarayonda
```
Logda: `database: ds_delivery_test`, `paymentMode: MOCK`, `Telegram client bot started`. Shu `BOT_TOKEN` bilan boshqa jarayon polling
qilmayotgan bo‘lishi shart (aks holda 409). `BOT_USERNAME` bot `getMe`dan avtomatik olinadi.

## Telefon → backend
Hozirgi PC Wi‑Fi manzili `172.20.10.3` (o‘zgarishi mumkin). Telefon **xuddi shu Wi‑Fi**da bo‘lishi kerak. Windows tarmoq profili "Public" →
inbound 4000 yopiq. Administrator PowerShell’da (sinovdan keyin olib tashlang):
```powershell
New-NetFirewallRule -DisplayName "DS test backend 4000" -Direction Inbound -Protocol TCP -LocalPort 4000 -Action Allow -Profile Public
# keyin:  Remove-NetFirewallRule -DisplayName "DS test backend 4000"
```
Tekshirish (telefon brauzerida): `http://<PC-IP>:4000/health` → `{"ok":true,...}`.

## APK yig‘ish (manzil tasdiqlangach)
```powershell
cd C:\Users\Acer\Documents\DS\apps\customer-miniapp
$env:DS_API_BASE_URL = "http://<PC-IP>:4000"     # debug: HTTP ruxsat; release: faqat https
npm run android:sync
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"; $env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
cd android; .\gradlew.bat assembleDebug
# APK: apps\customer-miniapp\android\app\build\outputs\apk\debug\app-debug.apk
```
Vaqtinchalik manzil (LAN IP / tunnel) o‘chsa yoki o‘zgarsa APK API bilan ishlamaydi — qayta yig‘ish kerak.

## Manual checklist
1. Eski nusxani o‘chiring → APK o‘rnating → oching: login/register so‘ralmasdan restoranlar va menyu ko‘rinadi.
2. Ilovani yoping (swipe) → qayta oching: savat va profil joyida (o‘sha guest).
3. Profil: telefon (`+998…`) va manzil saqlang. Mahsulot → savat → checkout → MOCK to‘lov tugmasi → buyurtma yaratiladi.
4. Buyurtma ekranida holat yangilanishini kuzating (ilova ochiq turganda; fon bildirishnomasi YO‘Q).
5. Profil → "Telegramga bog‘lash" → Telegram ochiladi → botda "Ha, bog‘lash" → ilovada ko‘rsatilgan ismni tekshirib "Ha, bu mening akkauntim".
6. Bog‘langach: Profilda "Bog‘langan", buyurtmalar tarixi saqlangan. (Ixtiyoriy: ilovani o‘chirib qayta o‘rnating → yana bog‘lang → tarix qaytadi.)
7. Internet: samolyot rejimini yoqing → xato/qayta urinish ko‘rinadi; o‘chiring → "Qayta yuklash" bilan davom etadi.
8. Android back: ochiq oyna yopiladi → ichki sahifadan orqaga → asosiy sahifada ilovadan chiqadi.
9. Klaviatura: manzil/telefon kiritganda input va asosiy tugma yopilib qolmaydi.
10. Checkout’da "joylashuvim" → ruxsat so‘raladi; rad etilsa matn bilan davom etish mumkin.
Tokenlarni hech kimga yubormang — ular faqat telefonning himoyalangan xotirasida.
