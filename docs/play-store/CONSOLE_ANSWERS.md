# Play Console: deklaratsiyalar uchun tayyor javoblar (mijoz ilovasi)

Javoblar kod bo'yicha tayyorlangan (AndroidManifest: faqat INTERNET + joylashuv; reklama/tahlil SDK yo'q; backend: `src/modules/miniapp`, `account-deletion.ts`). Console'dagi savol matni o'zgarib turadi: mazmun bo'yicha tanlang, shubha bo'lsa yozing. **Eng xavfli xato — Data safety'da kam deklaratsiya qilish**; ortiqcha deklaratsiya xavfsiz.

## 1. App access (ilovaga kirish)
**"All or some functionality is restricted"** tanlanmaydi. Javob: *Ilovaning barcha qismlari maxsus kirishsiz ochiq* (mehmon sessiyasi ilova ochilganda avtomatik yaratiladi).
Tekshiruvchiga izoh (Instructions, inglizcha):
> No login is required. A guest session is created automatically on first launch. Browse restaurants and menus on the home screen. To check the checkout flow, add a dish to the cart and open the cart; placing an order sends a real order to the restaurant, so please do not complete the payment step. Profile → "Delete account" shows the in-app account deletion flow (also at https://api.sultonxoja.uz/legal/delete-account).

## 2. Ads (reklama)
"Does your app contain ads?" → **No**.

## 3. Content rating (IARC so'rovnomasi)
Kategoriya: **Utility / Reference / "Food delivery"-ga yaqin: "All other app types"** (o'yin emas). Javoblar: zo'ravonlik **No**, jinsiy kontent **No**, qo'pol til **No**, giyohvand modda **No**, qimor **No**, **spirtli ichimlik/tamaki mahsuloti sotish yoki reklama: No** (menyuda bo'lmasligi shart, 5.4 ga qarang), foydalanuvchilar o'zaro muloqoti (UGC): **No** (yordam yozishmasi faqat administrator bilan, ommaga ko'rinmaydi), joylashuv almashish: **No** (boshqa foydalanuvchilarga ko'rsatilmaydi), raqamli xaridlar: **No** (Play orqali). Kutilgan natija: PEGI 3 / Everyone.

## 4. Target audience
**18+** (faqat kattalar). "Appeals to children": **No**. Families Policy talablari qo'llanmaydi.

## 5. Boshqa deklaratsiyalar
- Government app: **No**. News app: **No**. Health app / COVID: **No**.
- **Financial features**: ilova bank/kredit/to'lov xizmati emas. Tegishli "financial features" katakchalarining hech biri tanlanmaydi (**"My app doesn't provide any financial features"**). Ilova ichida bank karta ma'lumoti **kiritilmaydi**: to'lov restoran kartasiga o'tkazma yoki naqd.
- **Advertising ID**: ilova ishlatmaydi (manifestda `AD_ID` yo'q, tekshirilgan) → "No".
- **Payments policy**: jismoniy tovar (ovqat) — Google Play Billing talab qilinmaydi.
- **Permissions declaration**: joylashuv (ACCESS_FINE/COARSE) — oldingi planda (foreground only, faqat tugma bosilganda). Fon joylashuvi **yo'q**.
- **Data deletion**: URL = `https://api.sultonxoja.uz/legal/delete-account`; ilova ichida ham bor (Profil → Hisobni o'chirish).
- Mamlakatlar: **O'zbekiston**. Narx: **Bepul**. Ilova ichida xarid (in-app products): **yo'q**.

## 6. Data safety (yakuniy jadval)
Umumiy: ma'lumot to'planadi — **Ha**. Uzatishda shifrlanadi — **Ha** (HTTPS). Foydalanuvchi o'chirishni so'ray oladi — **Ha** (+ URL). Ma'lumot **sotilmaydi**. Reklama/tahlil uchun ishlatilmaydi. Uchinchi tomonga "ulashish" (sharing): restoran va yetkazish (taksi) xizmati ilova funksiyasini bajarish uchun — Google'ning ta'rifiga ko'ra bu **"service provider / ilova funksiyasi uchun uzatish"** hisoblanadi, lekin ehtiyot uchun shu ma'lumotlarni **"Shared"** deb ham belgilash xavfsizroq.

| Toifa → tur | Collected | Shared | Majburiy? | Maqsad |
|---|---|---|---|---|
| Personal info → Name | Ha (Telegram bog'langanda; ixtiyoriy) | Ha (restoran) | Ixtiyoriy | App functionality |
| Personal info → Phone number | Ha | Ha (restoran, taksi) | Majburiy (buyurtma uchun) | App functionality |
| Personal info → Address | Ha | Ha (restoran, taksi) | Majburiy (yetkazish uchun) | App functionality |
| Personal info → User IDs (Telegram id, hisob id) | Ha | Yo'q | Ixtiyoriy (Telegram) | App functionality, Fraud prevention |
| Location → Approximate/Precise location | Ha (faqat tugma bosilganda) | Ha (restoran/taksi, manzil nuqtasi sifatida) | Ixtiyoriy | App functionality |
| Financial info → Purchase history | Ha (buyurtmalar, to'lov holati) | Ha (restoran) | Majburiy | App functionality |
| Messages → Other in-app messages | Ha (yordam yozishmasi) | Yo'q (faqat administrator) | Ixtiyoriy | App functionality / Customer support |
| App activity → Other user-generated content (baho izohi) | Ha | Ha (restoran, anonim) | Ixtiyoriy | App functionality |
| Device or other IDs (ilova o'rnatish identifikatori, seans tokeni) | Ha | Yo'q | Majburiy | App functionality, Fraud prevention, Security |

**Tanlanmaydi (Yo'q):** karta/bank hisobi ma'lumoti, kredit ma'lumoti, kontaktlar, fotosuratlar/videolar, audio, fayllar, kalendar, sog'liq/fitnes, veb-qidiruv tarixi, ilova ishdan chiqish/diagnostika (crash log) ma'lumoti, reklama identifikatori.

Eslatma: tekshiruvchi Data safety'ni ilova xatti-harakati bilan solishtiradi. Agar kelajakda tahlil/crash SDK, reklama yoki push (FCM) qo'shilsa, jadval va maxfiylik siyosati yangilanishi shart.

## 7. Maxfiylik siyosati va foydalanish shartlari URL'lari
- https://api.sultonxoja.uz/legal/privacy
- https://api.sultonxoja.uz/legal/terms
- https://api.sultonxoja.uz/legal/delete-account
**Diqqat:** hozir production'da bu sahifalar eski matn bilan turibdi va aloqa `@S18_2003`. Yangi matn va `LEGAL_OPERATOR_*` faqat keyingi relizdan keyin ishlaydi. Console'ga URL'ni reliz **dan keyin** kiriting.

## 8. Yuborishdan oldingi qisqa tekshiruv
- [ ] Production relizi chiqqan (account-deletion + yangi maxfiylik), 3 ta URL ochiladi, pochta ko'rinadi.
- [ ] Imzolangan AAB yuklangan, `targetSdk 36`, telefonda sinalgan.
- [ ] Kamida 1–2 restoran **24 soat ochiq**, menyu rasmli (tekshiruvchi bo'sh ekran ko'rmasin; "yopiq" restoranga buyurtma bera olmaydi).
- [ ] Mijoz menyusida spirtli ichimlik yo'q (`docs/play-store/PRE_SUBMIT_CHECK.sql`, faqat o'qiydi).
- [ ] Skrinshotlar tayyor, shaxsiy ma'lumotsiz.
