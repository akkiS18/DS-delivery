# Mijoz ilovasini Google Play'ga chiqarish rejasi

Tuzildi: 2026-11-05. Maqsad: ilova tekshiruvdan **birinchi urinishda** o'tsin. Hech narsa hali bajarilmagan; bu reja.
Eslatma: ba'zi Play qoidalari (12 tester qoidasi, targetSdk muddati) uchinchi tomon maqolalari va Google yordam sahifalari asosida yozilgan. Play Console'dagi ko'rsatmalar ustun: har bosqichdan oldin tekshiring.

## Qarorlar va holat (2026-11-05)

- Akkaunt: **shaxsiy** (12 tester × 14 kun majburiy). Imzo: **Play App Signing, Google yaratgan imzo kaliti**; mavjud `ds-release.jks` faqat **yuklash kaliti** (o'rnatgan faqat egasi, shuning uchun qayta o'rnatish muammo emas). Mas'ul tomon: **Sultonxoja**, pochta: `sultonxojakalon@gmail.com`. Davlat: O'zbekiston. Tillar: uz, ru, en.
- **5.1 bajarildi (kodda, telefonda sinalmagan):** Capacitor 6.2.2 → 8.6.0, AGP 8.13, Gradle 8.14.3, targetSdk/compileSdk **36**, minSdk 24, edge-to-edge CSS (`data-app="android"`), `-CustomerAab` rejimi build skriptida. Tekshirildi: `tsc`, Mini App testlari 153/153, debug APK va imzosiz AAB yig'ildi, APK'da `targetSdk 36`, faqat INTERNET + joylashuv ruxsatlari (AD_ID yo'q), native `.so` yo'q (16 KB talabi tegmaydi). Qoldi: imzolangan AAB (parolni siz kiritasiz) va telefon sinovi.
- **5.2 + 5.3 bajarildi (kodda, production'ga CHIQARILMAGAN):** `DELETE /api/v1/miniapp/me` (`src/modules/miniapp/account-deletion.ts`, tranzaksiya + `FOR UPDATE`, takroriy chaqiruv xavfsiz, audit `CUSTOMER_ACCOUNT_DELETED`, ochiq buyurtma/bron/qaytarish bo'lsa 409), migratsiya `20261111000100_customer_deleted_at` (additive), `/legal/delete-account` va yangilangan maxfiylik matni, `npm run customer:delete -- --phone ...` (pochta so'rovlari uchun, standart dry-run), ilovada Profil → "Hisobni o'chirish" (uz/ru). Tekshirildi: DB testi 7/7, backend `tsc`, legal testlari 6/6, ilova `tsc` va vitest 156/156. Tekshirilmadi: telefonda, production migratsiyasi. Reliz paytida `LEGAL_OPERATOR_NAME=Sultonxoja`, `LEGAL_OPERATOR_CONTACT=sultonxojakalon@gmail.com` o'rnatiladi.
- **5.4–5.6 tayyorlandi (2026-11-05):** ilova ikonkasi DS logotipi (adaptive, tekshirildi); eski Capacitor ko'k splash o'rniga DS logotipli splash (Android <12, 11 ta zichlik); oflayn holatda ochiq xabar (`ErrorBox`, uz/ru); do'kon matnlari uz/ru/en va grafika (`docs/play-store/LISTING.md`, `icon-512.png`, `feature-graphic-1024x500.png`); Console javoblari (`docs/play-store/CONSOLE_ANSWERS.md`: App access, reklama, IARC, 18+, Data safety jadvali); production tekshiruv SQL'i (`PRE_SUBMIT_CHECK.sql`). **Bajarilmadi:** production bazadagi restoran ish vaqti/rasm/spirtli ichimlik tekshiruvi (production o'qishga ruxsat berilmadi; SQL egasi o'zi ishga tushiradi); skrinshotlar (egasi); Console'ni to'ldirish (egasi); 5.7 sinov treklari (AAB, testerlar).

## 0. Eng muhim 5 narsa (shundan boshlang)

1. **Hisob turi hal qiladi.** Agar akkaunt **shaxsiy** (personal) va 2023-yil 13-noyabrdan keyin ochilgan bo'lsa, ilovani ommaga chiqarishdan oldin **kamida 12 ta tester 14 kun ketma-ket** yopiq testda bo'lishi shart. Bu eng uzun, shuning uchun **testerlarni bugundan yig'ishni boshlang**. Tashkilot (organization) akkauntida bu talab yo'q.
2. **targetSdk 36 kerak.** Hozir ilova 34 da. Google'ning rasmiy sahifasi: 2026-yil 31-avgustdan yangi ilovalar va yangilanishlar Android 16 (API 36) ni nishon qilishi shart. Hozirgi holatda **yuklash rad etiladi**. Bu eng katta texnik ish (Capacitor 6 → 8).
3. **Hisobni o'chirish** (account deletion) ilovada va veb-havola sifatida bo'lishi shart. Hozir yo'q. Bu keng tarqalgan rad etish sababi.
4. **Maxfiylik siyosati** hozir "sinov bosqichi", aloqa — Telegram nomi (`@S18_2003`), yuridik nom yo'q. Play uchun haqiqiy mas'ul tomon, elektron pochta, joylashuv, o'chirish yo'li kerak.
5. **Imzo kaliti qarori** (4.2-bo'lim): sizning mavjud `ds-release.jks` bilan o'rnatilgan APK'lar Play'dan yangilanmaydi, agar Play'ga shu kalitni topshirmasak.

## 1. Hozirgi holat (kodda tekshirildi)

| Narsa | Holat | Play uchun ma'nosi |
|---|---|---|
| Paket nomi | `com.dsdelivery.customer` | OK. Bir marta yuklangach o'zgarmaydi |
| targetSdk / compileSdk / minSdk | 34 / 34 / 22 | **Yetarli emas** (kerak: 36) |
| Capacitor | 6.2.2, Gradle 8.7, AGP 8.3.2, JDK 21 bor | Capacitor 8 + AGP ~8.13 + Gradle ~8.14 ga o'tish |
| Chiqarish fayli | faqat APK (`assembleRelease`) | Play **AAB** (`bundleRelease`) talab qiladi |
| Ruxsatlar | INTERNET, joylashuv (aniq + taxminiy, ixtiyoriy, tugma bosilganda so'raladi) | Kam va oqlanadigan. Data safety'da e'lon qilinadi |
| Trafik | `usesCleartextTraffic=false`, `allowBackup=false` | Yaxshi |
| Veb-sahifa assetlari | ilova ichiga joylangan (`dist-android`), API `https://api.sultonxoja.uz` | "Saytni WebView'ga o'rash" emas: o'z backend'i va to'liq funksiyasi bor. Xavf past-o'rta (3-bo'lim) |
| Kirish | mehmon (qurilma identifikatori) + ixtiyoriy Telegram bog'lash; telefon va manzil serverda saqlanadi | Akkaunt bor → **o'chirish talab qilinadi** |
| Maxfiylik/shartlar sahifasi | `https://api.sultonxoja.uz/legal/privacy` va `/terms` 200 qaytaradi, ilova Profilda ochadi | Mavjud, lekin matnni yangilash kerak |
| Ikonka | maxsus (Oct 25'da yangilangan), splash bor | Ko'zdan kechirish kerak |
| Reklama, obuna, ilova ichidagi raqamli xarid | yo'q | Play Billing kerak emas (jismoniy xizmat: yetkazish) |

## 2. Play talablari va bizning javobimiz

- **Target API**: yangi ilova/yangilanish API 36 (2026-08-31 dan). [Rasmiy sahifa](https://developer.android.com/google/play/requirements/target-sdk).
- **16 KB sahifa o'lchami**: faqat native (.so) kutubxonalari bor ilovalarga tegadi. Bizda WebView, native kutubxona yo'q. AAB'ni tekshirib tasdiqlaymiz.
- **Akkaunt o'chirish**: ilova ichida akkaunt yaratilsa, ilova ichida ham, veb-havola orqali ham o'chirishni so'rash imkoni bo'lishi va havola Data safety formasiga kiritilishi shart. [Google qoidasi](https://support.google.com/googleplay/android-developer/answer/13327111).
- **Data safety formasi**: to'liq va haqiqatga mos bo'lishi shart. Noto'g'ri javob = rad etish.
- **To'lov siyosati**: Play Billing raqamli mahsulotlar uchun. Ovqat yetkazish jismoniy xizmat, tashqi to'lov ruxsat etiladi. [To'lov siyosati](https://support.google.com/googleplay/android-developer/answer/10281818). Ikki Google sahifasi bu haqda bir-biriga mos kelmaydi; matnda to'lov usulini ochiq yozamiz.
- **Minimal funksiya / WebView**: bo'sh "sayt o'rami" rad etiladi. Bizda assetlar ilova ichida va to'liq ish bor.
- **Shaxsiy akkaunt testi**: 12 tester × 14 kun, so'ng "production access" so'rovi.
- **Android developer verification**: Play orqali tarqatilgan ilovalar avtomatik ro'yxatdan o'tadi. 2026-09-30 dan faqat Braziliya, Indoneziya, Singapur, Tailand'da majburiy; butun dunyoda 2027 va keyin. O'zbekiston uchun hozir ish yo'q, lekin sideload qilinadigan xodim ilovalari (restoran/taksi/admin APK) uchun 2027 da qayta ko'ramiz. [Google](https://developer.android.com/developer-verification/guides).

## 3. Rad etilish xavflari va oldini olish

| Xavf | Ehtimol | Choramiz |
|---|---|---|
| targetSdk < 36 | 100% (hozir) | 5.1 bosqich |
| Akkaunt o'chirish yo'q | Yuqori | 5.2 bosqich (ilova + veb-sahifa + Data safety havolasi) |
| Maxfiylik siyosati mos emas / aloqa yo'q | Yuqori | 5.3 bosqich: haqiqiy nom, pochta, joylashuv, o'chirish |
| Data safety javobi ilova xatti-harakatiga mos emas | O'rta | 6-bo'lim jadvalini kod bilan solishtirib to'ldiramiz |
| Reviewer ilovani ochganda restoran yopiq / menyu bo'sh ("ishlamayapti") | **Yuqori** | Tekshiruv paytida kamida 1–2 restoran 24 soat ochiq va menyusi rasmli bo'lsin; Play Console'da "App access" ga yo'riqnoma yozamiz |
| Reviewer buyurtma bera olmaydi (to'lov haqiqiy karta o'tkazmasi) | O'rta | Yo'riqnomada aytamiz: buyurtma savatchagacha va to'lov ekranigacha tekshiriladi; zarur bo'lsa maxsus sinov restorani (to'lovsiz oqim, 5.7) |
| "Saytning o'rami" deb baholash | O'rta-past | Tavsifda haqiqiy funksiyalar: joylashuv, buyurtma kuzatuvi, bronlar, yordam chati, ikki til. Xohlasangiz keyin push-bildirishnoma (FCM) qo'shamiz: kuchli "native" dalil |
| Spirtli ichimlik / tamaki menyuda | Past (hozir yo'q) | Mijoz ilovasida spirtli taom bo'lmasin (aroq, pivo). Egasi qarori; bo'lsa yosh cheklovi va alohida qoidalar |
| Shaxsiy kartaga pul o'tkazish "firibgarlik" deb ko'rinishi | O'rta-past | Tavsifda ochiq yozamiz: "karta orqali o'tkazma"; Telegram, bank va kartalar logotiplari ishlatilmasin |
| Ilova nomi/ikonka boshqa brendga o'xshash | Past | "DS Delivery" nomini tekshirib ko'rish (Play'da shu nom borligini qidirish) |
| Sifat: ishdan chiqish (crash), bo'sh ekran, internet yo'q holati | O'rta | Play "pre-launch report" natijalarini yuklagach ko'ramiz; xira-ekransiz oflayn xabar |

## 4. Qarorlar (sizdan kerak)

1. **Akkaunt turi**: shaxsiymi yoki tashkilotmi? Shaxsiy bo'lsa 12 tester qoidasi amal qiladi.
2. **Imzo kaliti** (mavjud `ds-release.jks`):
   - **A (tavsiya, agar mijozlar APK'ni allaqachon o'rnatgan bo'lsa):** Play App Signing'ga shu kalitni topshiramiz. Shunda eski APK o'rnatgan mijozlar Play orqali yangilana oladi. Buning uchun birinchi yuklashda kalit eksport qilinadi (keystore parolingiz kerak, men ko'rmayman).
   - **B (agar hali kam odam o'rnatgan):** Play yangi imzo kalitini yaratadi, `ds-release.jks` esa faqat "upload key" bo'ladi. Eski APK egalari o'chirib, Play'dan qayta o'rnatishlari kerak.
3. **Mas'ul tomon nomi** (YaTT/MChJ yoki shaxs ismi) va **elektron pochta** (maxfiylik siyosati va do'kon sahifasi uchun; pochta tekshirib turiladigan bo'lsin).
4. **Davlatlar**: faqat O'zbekiston (tavsiya). Tekshiruvchi chet eldan ochadi, shuning uchun "App access" yo'riqnomasi kerak.
5. **Tillar**: do'kon sahifasi o'zbekcha (lotin) + ruscha + inglizcha (tekshiruvchi uchun).
6. **Spirtli ichimliklar** mijoz ilovasida ko'rinmasin (tavsiya).

## 5. Ishlar bosqichma-bosqich

Belgilar: **M** = men (kod/matn), **S** = siz (Play Console, telefon, kalit paroli).

### 5.0 Bugunoq (S)
- [ ] Hisob turini aniqlang (4.1). Shaxsiy bo'lsa: **12–20 tester** toping (Gmail hisobi bor odamlar: restoran xodimlari, do'stlar, oila). Har biri Play'dan test havolasini ochib "tester bo'lish" bosishi va 14 kun chiqib ketmasligi kerak.
- [ ] Play Console: shaxsni tasdiqlash tugallanganini va (shaxsiy hisobda) telefon orqali tekshiruv bajarilganini tasdiqlang.
- [ ] 4-bo'limdagi qarorlarni bering.

### 5.1 Texnik: targetSdk 36 (M)
- [ ] Capacitor 6 → 7 → 8 (qadamma-qadam, har biri `cap migrate`), AGP/Gradle/Kotlin yangilash, `minSdk` 24 (22–23 qurilmalar yo'qoladi, juda kam).
- [ ] **Edge-to-edge**: API 35+/36 da kontent status va navigatsiya panellari ostiga chiqadi. CSS'da `env(safe-area-inset-*)` bilan tuzatamiz (pastki tab va "Savat" paneli ayniqsa).
- [ ] Android 14+ ruxsat xatti-harakatlari, `FileProvider`, manifestni qayta ko'rish. Birlashgan manifestda **AD_ID** ruxsati bo'lmasligini tekshirish.
- [ ] `bundleRelease` (AAB) ni `scripts/build-release-apks.ps1` ga qo'shish; `versionCode` mavjud APK'lardan yuqori.
- [ ] Tekshiruvlar: `npm run typecheck`, `npm test` (Mini App testlari), AAB tarkibini tahlil (16 KB, ruxsatlar).
- [ ] (S) Telefonda sinov: ro'yxatdan o'tmasdan menyu, savat, joylashuv tugmasi, to'lov ekrani, hujjatlar, bron, yordam; Android 14/15/16 qurilmada bo'lsa yaxshi.

### 5.2 Akkauntni o'chirish (M) — pul va hisob-kitob yozuvlari tufayli ehtiyotkorlik bilan
- [ ] Ilova: Profil → **"Hisobni o'chirish"** (ikki bosqichli tasdiq, oqibati yozilgan).
- [ ] Backend: shaxsiy ma'lumotni anonimlashtirish (ism, telefon, Telegram bog'lash, manzillar, koordinatalar, qurilma seanslari). Buyurtma/to'lov/komissiya yozuvlari hisob-kitob uchun qoladi, lekin shaxsga bog'lanmaydi (buyurtmadagi telefon nusxasi `phoneSnapshot` va manzil matni ham). Ochiq buyurtma yoki qaytarilmagan pul bo'lsa o'chirish rad etiladi. Hammasi audit yoziladi.
- [ ] Veb-sahifa: `https://api.sultonxoja.uz/legal/delete-account` (ilova nomi, qadamlar, pochta/shakl orqali so'rov, nimalar o'chirilishi va nimalar qonun bo'yicha saqlanishi). Ilovani o'rnatmagan odam ham so'rov yubora oladi.
- [ ] Testlar: DB testi (anonimlash, ochiq buyurtmada rad, takroriy chaqiruv xavfsiz). `ds-backend-safety` ro'yxati bo'yicha ko'rib chiqish (ledger append-only triggerlari buzilmasin).
- [ ] Production'ga chiqarish alohida reliz (migratsiya bo'lsa zaxira nusxa bilan).

### 5.3 Maxfiylik siyosati va shartlar (M, S)
- [ ] Matnni yangilash: sinov bosqichi qaydini olib tashlash, **haqiqiy mas'ul tomon nomi + elektron pochta**, joylashuv (ixtiyoriy, aniq/taxminiy, faqat tugma bosilganda), qurilma identifikatori, ma'lumot saqlash muddatlari, o'chirish yo'li (ilova + veb-sahifa), bolalar (18+), kimlarga berilishi (restoran, taksi operatori).
- [ ] `LEGAL_OPERATOR_NAME` va `LEGAL_OPERATOR_CONTACT` production sozlamasini haqiqiy qiymatga o'zgartirish (S aytadi, M server tomonda o'rnatadi).
- [ ] URL ochiq va pochta/telefon bilan bog'lanish mumkin ekanini tekshirish.

### 5.4 Ilova sifati va kontent (M, S)
- [ ] Ikonka (512×512 do'kon ikonkasi va ilova ikonkasi bir xil), splash, ilova nomi "DS Delivery".
- [ ] Internet yo'q / server javob bermaydi holati aniq xabar bilan (xira ekran yo'q).
- [ ] Menyuda spirtli ichimlik, noqonuniy yoki haqorat qiluvchi kontent yo'qligini tekshirish. Rasmlarning huquqi: biz qo'ygan rasmlarning litsenziyasi (Wikimedia, CC) ro'yxati saqlangan (`CREDITS.md`), muallif ko'rsatish talabi bor, ilovada "Rasmlar manbalari" bo'limi qo'shish mumkin.
- [ ] Tekshiruv oynasi uchun: kamida 1–2 restoran 24 soat ochiq, menyu rasmli va to'liq.

### 5.5 Do'kon sahifasi (M matn, S rasm)
- [ ] Nom ≤ 30 belgi, qisqa tavsif ≤ 80, to'liq tavsif ≤ 4000 (uz, ru, en). Haqiqatga mos: "eng yaxshi", narx va'dalari, boshqa brend nomlari yo'q.
- [ ] Ikonka 512×512, feature graphic 1024×500, **kamida 2 (tavsiya 6–8) telefon skrinshoti** (haqiqiy ilova ekranlari; S telefondan oladi, men matn/ketma-ketlik tayyorlayman).
- [ ] Kategoriya: Food & Drink. Aloqa: pochta, sayt, maxfiylik URL.

### 5.6 Play Console deklaratsiyalari (S, javoblarni M tayyorlaydi)
- [ ] **Data safety** (6-bo'lim jadvali), akkaunt o'chirish havolasi.
- [ ] **Kontent reytingi** (IARC so'rovnomasi): zo'ravonlik, qimor, spirtli ichimlik yo'q deb javob beriladi (menyuda bo'lmasa).
- [ ] **Target auditoriya**: 18+ (bolalar uchun emas, Families siyosatiga tushmaydi).
- [ ] **Reklama**: yo'q. **Reklama ID**: ishlatilmaydi. **Moliyaviy xususiyatlar** deklaratsiyasi: moliyaviy xizmat emas (ovqat yetkazish), shu tarzda javob beriladi. **Sog'liq/yangiliklar/davlat ilovasi**: yo'q.
- [ ] **App access**: "kirish talab qilinmaydi (mehmon)" + tekshiruvchiga yo'riqnoma.

### 5.7 Sinov treklari (S, M yordam)
1. **Ichki sinov** (internal testing): AAB yuklash, 5–10 tester; pre-launch hisobotini ko'rish. Tekshiruvsiz tez.
2. **Yopiq sinov** (closed): shaxsiy hisobda **12+ tester × 14 kun**; qayta aloqa ularga so'raladi. Tester ilovani haqiqatan ochib ishlatsa yaxshi.
3. "Production access" so'rovi, savollarga haqiqiy javob.
4. **Ishlab chiqarish**: boshida 20% bosqichli tarqatish, keyin 100%.
- [ ] (M, ixtiyoriy) Sinov restorani: to'lovsiz demo oqim, faqat tekshiruvchi va testerlar uchun. Bu faqat sizning roziligingiz bilan, `AGENTS.md` qoidalariga (haqiqiy pul o'chiq, taksi yetkazish deb da'vo qilinmasin) mos.

## 6. Data safety javoblari (kod bo'yicha qoralama)

| Ma'lumot | To'planadi | Uzatiladi | Maqsad | Majburiymi |
|---|---|---|---|---|
| Ism (Telegram orqali, ixtiyoriy) | Ha | Restoranga (qisman) | Ilova funksiyasi | Yo'q |
| Telefon raqami | Ha | Restoran, taksi operatori | Ilova funksiyasi (buyurtma) | Ha (buyurtma uchun) |
| Manzil (yetkazish) | Ha | Restoran, taksi operatori | Ilova funksiyasi | Ha (buyurtma uchun) |
| Aniq/taxminiy joylashuv | Ha (faqat tugma bosilganda) | Restoran (piyoda yetkazishda), taksi operatori | Ilova funksiyasi | Yo'q |
| Buyurtma tarixi / xaridlar | Ha | Restoran, taksi operatori | Ilova funksiyasi | Ha |
| Yordam yozishmalari | Ha | Faqat administrator | Mijozlarga yordam | Yo'q |
| Qurilma/seans identifikatori | Ha | Yo'q | Ilova funksiyasi, firibgarlikdan himoya | Ha |
| Sharhlar/baholar | Ha | Restoranga (anonim) | Ilova funksiyasi | Yo'q |
| Reklama, tahlil, bank karta ma'lumoti | **Yo'q** | – | – | – |

Shifrlash: uzatishda HTTPS (ha). O'chirishni so'rash: ha (ilova + veb). Sotish: yo'q. Bu qoralama; yuborishdan oldin 5.1–5.2 yakunidagi haqiqiy xatti-harakat bilan qayta solishtiriladi.

## 7. Taxminiy muddat

| Bosqich | Kim | Davomiyligi |
|---|---|---|
| 5.0 testerlarni yig'ish + qarorlar | S | 1–3 kun (parallel boshlanadi) |
| 5.1 targetSdk 36 + AAB | M (+ S telefon sinovi) | 2–4 kun |
| 5.2 akkaunt o'chirish + reliz | M | 2–3 kun |
| 5.3–5.5 matnlar, rasmlar | M + S | 2–3 kun (parallel) |
| 5.6 deklaratsiyalar | S | 1 kun |
| 5.7 ichki sinov → yopiq sinov (14 kun, agar shaxsiy akkaunt) → production access → ko'rib chiqish | S | **~3–4 hafta** shaxsiy hisobda; tashkilotda ~1 hafta |

Eng uzun yo'l: shaxsiy hisobda **14 kunlik yopiq sinov**. Shuning uchun kod ishlari bilan bir vaqtda ichki sinov uchun birinchi AAB tayyor bo'lishi bilan testerlar qo'shiladi. Eslatma: yopiq sinovda yuklanadigan AAB targetSdk 36 bo'lishi kerak, ya'ni 5.1 testerlar ishga kirishishidan oldin tugashi kerak, 5.2 esa production'dan oldin.

## 8. Tavsiya etilgan tartib

1. S: hisob turi, qarorlar (4), testerlar ro'yxati.
2. M: 5.1 (targetSdk 36 + AAB) → S: telefon sinovi → ichki sinov + testerlarni yopiq sinovga qo'shish (14 kun boshlanadi).
3. M: 5.2 + 5.3 (hisobni o'chirish, maxfiylik) → production'ga reliz → yopiq sinov davomida yangi AAB.
4. M/S: 5.4–5.6 (kontent, do'kon sahifasi, deklaratsiyalar), skrinshotlar.
5. 14 kundan keyin "production access" → 20% bosqichli chiqarish.

## Manbalar
- [Target API talabi](https://developer.android.com/google/play/requirements/target-sdk)
- [Akkaunt o'chirish talablari](https://support.google.com/googleplay/android-developer/answer/13327111)
- [Play to'lov siyosati](https://support.google.com/googleplay/android-developer/answer/10281818)
- [Android developer verification](https://developer.android.com/developer-verification/guides)
- [Capacitor 8 ga o'tish (uchinchi tomon)](https://capgo.app/blog/upgrade-capacitor-app-to-capacitor-8/)
- [Yopiq sinov qoidasi (uchinchi tomon)](https://ontest.app/blog/google-play-12-testers-14-days-requirement-explained)
