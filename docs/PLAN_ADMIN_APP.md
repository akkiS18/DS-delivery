# Admin ilovasi (DS Admin): reja

Holat: **reja tasdiqlandi** (2026-10-30): kirish Telegram kodi + PIN; jim soatlar bor; pishirish vaqti qoidasi olib tashlandi; rollar kerak emas (bitta admin). Kod hali yozilmagan. Egasining qarori: botdagi barcha admin imkoniyatlari ilovaga ko'chadi, osilib qolgan buyurtmalar **ovoz bilan** keladi. UI ikkinchi darajali, asosiysi qulaylik va ishonchlilik.
(Oldingi qaror "admin Telegramda qoladi, admin APK yo'q" 2026-10-22 dan eskirgan: bu reja uni almashtiradi.)

## 1. Maqsadlar va tamoyillar
1. **Osilib qolgan narsa o'tkazib yuborilmaydi:** server o'zi aniqlaydi, ilova baland ovoz bilan chaqiradi, siz "Qo'ng'iroq qildim" deguningizcha to'xtamaydi. Ekrandan to'g'ridan-to'g'ri restoranga qo'ng'iroq tugmasi bor.
2. **Bot o'chirilmaydi.** Telegram buyruqlari zaxira yo'l bo'lib qoladi (ilova ishlamasa, telefon o'chib qolsa). Ikkalasi bir xil xizmat (service) funksiyalarini ishlatadi: mantiq ikki marta yozilmaydi.
3. **Xavfli amallar ikki bosqichli:** real to'lovni ochish/yopish, restoran o'chirish, karta tasdig'i, komissiya "to'landi" belgisi. Hammasi `AdminAuditEvent` ga yoziladi.
4. **Mavjud kodni qayta ishlatamiz:** `apps/restaurant-android` dagi signal tizimi (`AlarmController`, `AlarmPlayer`, `WatchService`, `OrderWatcher`), Kotlin + Compose + Retrofit uslubi, `RestaurantSession` kabi sessiya modeli.

## 2. Hozirgi kod haqida eslatma
Kommit qilinmagan `admin-routes.ts` (x-admin-id sarlavhasi, zaif autentifikatsiya) egasining ruxsati bilan 2026-10-30 da o'chirildi; yangi to'g'ri autentifikatsiyali `/api/v1/admin/*` quriladi.

## 3. Kirish (autentifikatsiya)
- Admin Telegram ID lar allaqachon `SUPPORT_ADMIN_*_TELEGRAM_ID` da. Ilova ochilganda: ID yoziladi, server **bir martalik 6 xonali kodni asosiy bot orqali** shu Telegramga yuboradi, kod ilovaga kiritiladi.
- Server qurilmaga bog'langan uzoq muddatli sessiya beradi (token faqat xesh ko'rinishida saqlanadi; `AdminSession` jadvali, bekor qilish mumkin: Telegramda `/logoutall`).
- Kodda urinishlar cheklangan (rate limit), kod 5 daqiqa amal qiladi, bir marta ishlaydi.
- Ilovada qo'shimcha **PIN yoki barmoq izi** qulfi; xavfli amallarda qayta so'raladi.
- Karta raqamlari ekranda faqat tasdiqlash oynasida to'liq ko'rinadi; ekran tasviri olish (FLAG_SECURE) o'chiriladi.

## 4. "Diqqat" tizimi (asosiy qiymat)
Server har 10–15 soniyada qoidalarni tekshiradi va ochiq **diqqat elementlari** ro'yxatini beradi (`GET /admin/attention`). Ilovadagi fon xizmati (foreground service, restoran ilovasidagi `WatchService` kabi) shuni so'rab turadi va yangi element chiqsa **alarm** chaladi. Har bir element: kimga (restoran, telefon), nima bo'ldi, qancha vaqt, "Qo'ng'iroq" va "Qo'ng'iroq qildim / Hal qilindi" tugmalari. Tasdiqlangunga qadar har 2–3 daqiqada qayta ovoz chiqadi. Bir vaqtda Telegramga ham xabar ketadi (zaxira kanal).

Qoidalar (boshlang'ich daqiqalar, hammasi sozlanadigan):

| # | Holat | Boshlang'ich chegara |
|---|---|---|
| 1 | Pul tushdi, restoran ilovasi buyurtmani **"ko'rdim" deb tasdiqlamadi** | 2 daqiqa |
| 2 | Naqd buyurtma qabul qilinmadi | 3 daqiqa (muddat 15 daqiqa) |
| 3 | Restoran ilovasi aloqada emas (so'nggi so'rov), ochiq buyurtma bor | 3 daqiqa |
| 4 | To'lov kelgan, avtotasdiq bo'lmadi (`MATCHED_UNVERIFIED`) | 3 daqiqa |
| 5 | "Tayyor", taksi chaqirilmadi yoki haydovchi yo'q | 5 daqiqa |
| 6 | Taksi so'rovi javobsiz yoki muammoli (`NEEDS_HELP`) | darhol |
| 7 | "Yetkazildi" taksi operatori tomonidan tasdiqlanmadi (`DELIVERY_ASSUMED`) | 30 daqiqa |
| 8 | Mos kelmagan pul / yangi karta tasdig'i / signal (Gmail, Humo) uzildi | darhol |
| 9 | Karta aylanmasi chegaraning 70% / 90% ga yetdi | bir martalik |
| 10 | Mijoz murojaati javobsiz | 10 daqiqa |

**Kerak bo'ladigan backend o'zgarishi:** hozir buyurtmada "restoran ko'rdi" belgisi yo'q (faqat bronda `restaurantSeenAt` bor). 1-qoida uchun restoran ilovasi signalni o'chirganda `ack` yuboradi (`Order.restaurantSeenAt`, qo'shimcha ustun). Bu restoran ilovasini qayta yig'ishni talab qiladi. 3-qoida uchun `RestaurantSession.lastSeenAt` (har ~60 soniyada yangilanadi) ishlatiladi.

**Ishonchlilik:** Android fon xizmatini o'ldirishi mumkin. 1-bosqichda foreground service + wake lock (restoran ilovasidagi usul), bateriya optimizatsiyasidan chiqarish ko'rsatmasi. 2-bosqichda (siz Google/Firebase loyihasi ochsangiz) FCM yuqori ustuvorlikli push qo'shiladi. Har ikki holatda Telegram zaxira kanal ishlaydi.

## 5. Botdagi imkoniyatlar -> ilova ekranlari

| Bot buyrug'i | Ilova ekrani | Backend (mavjud xizmat) |
|---|---|---|
| (yangi) | **Diqqat** (bosh ekran) | yangi `attention` xizmati |
| /orders, buyurtma holati | **Buyurtmalar** (jonli ro'yxat, restoran bo'yicha filtr) | restoran buyurtmalari xizmati |
| /money | **Pul**: mos kelmagan to'lovlar, uzoq tasdiqlanmaganlar, kunlik hisobot | `payment/review.ts` |
| /cards, /pool, /platformcard, /collect | **Kartalar**: tasdiqlash, platforma kartalari, aylanma, restoranni poolga o'tkazish | `restaurant-cards`, `payment/pool-admin.ts` |
| /commission | **Komissiya**: haftalik hisob, "to'landi" belgisi | `commission/settlement.ts` |
| /restaurants, /newrestaurant, /resetpassword, /linkstaff, /restaurantphoto, /deleterestaurant | **Restoranlar**: yoqish/to'xtatish, yangi qo'shish, parol, Telegram ulash, rasm, o'chirish | `restaurant/admin.ts`, `provision.ts`, `platform/removal.ts` |
| /newtaxi, /taxiapp, /deletetaxi, /taxiadmin | **Taksi**: kompaniyalar, ilova paroli, qotgan so'rovni tiklash | `taxi-app/provision.ts`, `taxi/recovery.ts` |
| /payments, /cash, /fee, /taxi (rejim), /ratings | **Sozlamalar**: real to'lov eshigi, naqd, xizmat haqi, taksi rejimi, reyting tartibi | `platform/settings.ts`, `payment/method.ts`, `pricing/config.ts`, `taxi/mode.ts`, `ratings/service.ts` |
| /tickets + javob | **Yordam**: murojaatlar, mijoz bilan chat | `support/service.ts`, `conversation.ts` |
| pul qaytarish (refunds) | **Qaytarishlar**: tasdiqlash, holat | `refunds/service.ts` |
| Humo/Gmail ogohlantirishlari | Diqqat ichida | `bot/gmail-alerts.ts`, `humo-alerts.ts` |
| (keyingi) | **Kunlik to'lov hisoboti** (restoranga o'tkaziladigan summa), **bloklar va strike'lar** | alohida bosqich |

## 6. Bosqichlar (har biri alohida ishlatiladigan, to'xtatib qo'yish mumkin)
- **A0. Poydevor.** `AdminSession` va bir martalik kod jadvallari (additive migratsiya), `/api/v1/admin/*` skeleti, auditga yozish, bot orqali kod yuborish. Testlar: begona ID rad etiladi, kod bir marta, sessiya bekor qilinadi.
- **A1. Diqqat + alarm** (eng katta foyda, birinchi chiqariladi). `attention` xizmati va qoidalar 1–8, ilova qobig'i (kirish, PIN, bosh ekran), fon xizmati va alarm, qo'ng'iroq tugmasi, Telegram zaxira. Restoran ilovasiga `ack`.
- **A2. Pul va kartalar.** Mos kelmagan pul, karta tasdig'i, pool va aylanma ko'rinishi, 70/90% ogohlantirish.
- **A3. Restoranlar va sozlamalar.** Restoran boshqaruvi, real to'lov eshigi, naqd, xizmat haqi, taksi rejimi, reyting, komissiya.
- **A4. Yordam, taksi, qaytarishlar.**
- **A5. Kunlik to'lov hisoboti va bloklar.** (alohida kelishilgan qoidalar: 1 strike -> naqd o'chadi, 5 -> blok; "Mijoz olmadi" tugmasi restoran va taksi ilovalarida; Telegram `userId` + Android ID.)
- **A6. Push (FCM)** va pul uchun alohida bot (xohlansa).

Har bosqichdan so'ng: backend testlari, ilova qo'lda tekshiruvi ro'yxati (`docs/PENDING_MANUAL_TESTS.md` ga qo'shiladi), alohida APK (`com.dsdelivery.admin`), productionga faqat egasining ruxsati bilan.

## 7. Xavflar
- Admin ilovasi butun platformaning kaliti: telefon yo'qolsa, sessiyani Telegramdan bekor qilish va PIN shart.
- Fon xizmati ishonchliligi telefon ishlab chiqaruvchisiga bog'liq (Xiaomi, Samsung agressiv). Birinchi telefonda sinash shart; FCM bu xavfni kamaytiradi.
- Ovozli alarm tunda uyg'otadi: "jim soatlar" yoki ustuvorlik darajasi (faqat qizil elementlar) sozlamasi kerak bo'ladi.
- Telegramdagi buyruqlar va ilova bir vaqtda bir amalni qilsa: barcha o'zgartirishlar mavjud compare-and-set himoyasidan o'tadi, ikki tomonlama bosish bitta natija beradi.

## 8. Egasining javoblari (2026-10-30)
1. Kirish: Telegram kodi + PIN: ha.
2. Daqiqalar mos; pishirish vaqti qoidasi kerak emas.
3. Jim soatlar: kerak (faqat jiddiy holatlar uyg'otadi; soatlar A1 da kelishiladi).
4. FCM (Firebase): egasi bu nima ekanini so'radi; A6 gacha kutadi.
5. Ikkinchi odam/rol: kerak emas, bitta admin.
