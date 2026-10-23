# Restoran ilovasi: UX audit (2026-10-23)

Kod bo'yicha o'qib tuzildi (telefonda emas). Maqsad: Apple "Human Interface" ruhida tushunarlilik va qulaylik (dizayn emas): har ekranda bitta asosiy vazifa, oddiy so'zlar, dasturchi tilisiz, bir xil atamalar. Egasining qarori: pul tasdig'i avtomatik, restoran hech narsa bosmaydi (Stage 8D).

## A. Mantiq bilan ziddiyat (eng muhim, avval shu)
Stage 8D'dan keyin to'lovni restoran tasdiqlamaydi, lekin ilova hali shunday deydi:
1. `OrderComponents.kt` "To'lov sizning tekshiruvingizni kutmoqda: bank hisobini tekshirib, tasdiqlang."
2. `OrdersScreen.kt` banner: "... e'tibor talab qiladi (to'lovni tasdiqlash, ...)".
3. `OrderDetailScreen.kt` "To'lovni tasdiqlash" oynasi (belgi qutisi "Pul bank hisobimizga tushganini o'zim tekshirdim"), "To'lov tekshiruvda: bank hisobingizni tekshiring", "Bu faqat signal — bank tasdig'i emas".
4. `FinanceScreen.kt` "Tekshirilmagan (pochta mos kelgan)", "restoran xodimi tasdiqlagan", "Yetkazib berish tasdiqlanmaydi ... serverda mavjud emas" (komissiya Stage 8C'da bor, matn eskirgan bo'lishi mumkin).
Taklif: odatiy holatda restoran faqat "To'langan, tayyorlanmoqda" ni ko'radi. "Qo'lda tasdiqlash" tugmasi faqat zaxira rejimida (`GMAIL_AUTO_CONFIRM=false` yoki avtomatik tasdiq rad etilganda) chiqadi, oddiy 1 jumla bilan.

## B. Dasturchi tili va sinov qoldiqlari (olib tashlash)
- Kirish: "Stage 3 — Real Auth & Catalog CRUD" nishoni; "Restoran slug identifikatori" (→ "Restoran kodi"); "Ochiq menyuni ko'rish (Demo)" tugmasi; "API: https://..." chipi; "Server sozlamasi" (yakuniy ilovada ko'rinmasin; ilovani boshqa serverga yo'naltirish xavfi).
- Sozlamalar: "Server sozlamasi" tugmasi, "Identifikator (slug)", "Backend Holati" oynasi, "Emulator (10.0.2.2)" / "Localhost" tezkor tugmalari.
- Mahsulot shakli: "Backend Stage 5B arxitekturasida rasm yuklash API kiritilmagan ...", "Rasm URL manzili" maydoni va "Tezkor sinov rasmlari" (unsplash havolalari) — yakuniy ilovadan olib tashlansin; rasm yuklash bo'lmasa shu bo'lim butunlay yashirilsin.
- Inglizcha/texnik so'zlar: "(Conflict)", "(VERSION_CONFLICT)", "(Refresh)", "(Refunds)", "(none)", toifa "(v3)" versiya raqami, "Mahsulotlar Boshqaruvi" (Title Case).
- Xatolik oynalari: "Versiya to'qnashuvi" o'rniga "Boshqa qurilmada o'zgartirilgan. Yangilab qayta urining."

## C. Atamalar va sarlavhalar mos emas
- Pastki tab "Sozlamalar" — sarlavha "Restoran Operatsiyalari"; tab "Menyu" — sarlavha "Mahsulotlar Boshqaruvi"; tab "Moliya" — "Moliya va Tushumlar". Tab nomi = sarlavha bo'lsin: Buyurtmalar / Menyu / Moliya / Sozlamalar. (Test hujjatidagi "Operatsiyalar" ham shu sababli chalkash edi.)
- "Bekor qilish" ikki xil ma'noda: dialogni yopish va buyurtmani bekor qilish (bekor qilish oynasida tasdiqlash tugmasi "Bekor qilish", yopish tugmasi "Ortga"). Qoida: yopish = "Yopish"/"Ortga"; buyurtmani bekor qilish = "Buyurtmani bekor qilish".
- Apostrof har xil: `'`, `‘`, `’` ("ma'lumot" va "ma’lumot"). Bitta turini ishlatish.

## D. Tuzilma va qulaylik
- Sozlamalar tartibi: eng muhim pul sozlamasi (To'lov kartalari) o'rtada. Tartib: 1) Qabul holati, 2) To'lov kartalari, 3) Tayyorlash vaqti, 4) Ish vaqti, 5) Hisob (restoran nomi, chiqish).
- "Chiqish" ikki joyda (Menyu sarlavhasidagi ikonka va Sozlamalar). Yagona joy: Sozlamalar → Hisob.
- Mayda shrift: ko'p joyda 11–13 sp (tugmalar, chiplar, pastki tab). Asosiy matn kamida 15–16 sp, tugma balandligi kamida 44 dp.
- Tayyorlash vaqti chiplari 4+3 qatorga bo'lingan va 11 sp; bitta qator (aylantiriladigan) yoki stepper bo'lsin.
- Uzun tushuntirish matnlari: Moliya (komissiya haqida 4–5 gap), buyurtma bosqichlari ostidagi izohlar, rad etish oynasi. Qoida: har bir matn bitta qisqa jumla; qolgani "Batafsil" ga.
- Buyurtma ekrani: bitta asosiy tugma (hozirgi bosqichga mos), qolganlari ikkinchi darajali. Xavfli amal ("Buyurtmani bekor qilish / pulni qaytarish") ajratilgan, lekin tasdiq oynasi bilan.
- Qabul qilish qadami: hozir restoran avval buyurtmani qabul qiladi, keyin mijozga to'lov rekvizitlari yuboriladi. Bu inson kutishi (mijoz kutib o'tirolmaydi). QAROR KERAK: avtomatik qabul (restoran ochiq va menyu to'g'ri bo'lsa) qilinsinmi, restoran faqat "rad etish" huquqini saqlasinmi.

## Bajarildi (2026-10-23, kodda; yig'ilmagan, telefonda sinalmagan)
A (matn qismi), B, C va D ning katta qismi: Kirish, Sozlamalar (qayta tuzildi, tizim sozlamalari uslubida), To'lov kartalari (kursor xatosi ham), Buyurtmalar, Buyurtma tafsiloti, Menyu, Taom shakli, Toifalar, Moliya, xato xabarlari. Qolgan: "Qo'lda tasdiq" tugmasini faqat zaxira rejimida ko'rsatish (backend bayrog'i kerak), shrift o'lchamlarini to'liq tekshirish, telefonda ko'rib chiqish.

## E. Tuzatish rejasi (tasdiqlansa)
1. Matn va atamalar bo'yicha bitta o'tish (A, B, C): faqat satrlar, mantiq o'zgarmaydi.
2. Sozlamalar tartibi, shriftlar, chiplar, "Chiqish" (D).
3. Zaxira rejimidagi qo'lda tasdiq (A) — faqat `GMAIL_AUTO_CONFIRM=false` bo'lganda ko'rinadi (backend bayroqni ilovaga bildirishi kerak: kichik API o'zgarishi).
4. Bitta yangi restoran APK, keyin faqat o'zgargan ekranlar qayta sinaladi.
Tekshirilmagan: bu audit ilovani ishga tushirmasdan, kod bo'yicha qilingan.
