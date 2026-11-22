# Restoran ilovasi (Android): UI/UX hisobot (2026-11-22)

Kod bo'yicha o'qib tuzildi, telefonda ishga tushirilmagan. Oldingi audit: `docs/RESTAURANT_UX_AUDIT.md` (2026-10-23) — undagi matn va atamalar ishi asosan bajarilgan, bu hisobot yangi topilganlar haqida.
Tartib: avval oshxonada xato yoki buyurtma o'tkazib yuborilishiga olib keladiganlar.

## 0. Tuzatildi (shu kuni)
- **Ringtone'dan keyin telefonning o'zi "Yangi buyurtma" deb gapirardi.** `OrderVoice` (telefonning nutq dvigateli, TTS) har bir qo'ng'iroqdan keyin ishga tushardi, ringtone esa o'zida shu so'zni aytadi. `OrderVoice.kt` o'chirildi, `AlarmPlayer` endi faqat ringtone + vibratsiya chaladi (qo'ng'iroq ham, "Ovozni sinash" tugmasi ham).
- Xuddi shu muammo **taksi ilovasida** ham bor edi (`apps/taxi-android/.../core/OrderVoice.kt`) — u ham olib tashlandi. Windows ilovalarida TTS yo'q.
- Holati: kod o'zgardi, APK yig'ilmagan, telefonda sinalmagan.

## A. Muhim (buyurtmani noto'g'ri o'qish / o'tkazib yuborish xavfi)
1. **"Tayyor" va "Tayyorlanmoqda" bir xil rangda.** `SuccessGreen` va `BrandPrimary` bir xil rang (`#087F5B`, `ui/theme/Color.kt`). Natija: buyurtma kartasidagi chap chiziq (tayyorlanmoqda = tayyor), "Qabul qildim" va "Tayyor" tugmalari, "O'zimiz yetkazamiz" va "Taksi chaqirish" tugmalari bir xil ko'rinadi.
   Tuzatish: `SuccessGreen`ni alohida yorqin yashil (masalan `#16A34A`) qilish yoki "Tayyorlanmoqda" uchun boshqa rang (ko'k/binafsha) berish; "Taksi chaqirish"ni ikkinchi darajali (outlined) tugma qilish.
2. **"Ochiq / Tanaffus" tugmasi yashil sarlavha ichida ko'rinmaydi.** `OrdersScreen.kt:214` — "Ochiq" holatida tugma foni `SuccessGreen`, sarlavha foni `BrandPrimary` = bir xil rang, shuning uchun bu tugma oddiy yozuvga o'xshaydi; xodim uni bosish mumkinligini bilmaydi.
   Tuzatish: oq fon + yashil matn (yoki oq chegara) va kichik nuqta/ikonka (● Ochiq).
3. **Tungi rejimda (telefon dark mode) ba'zi matnlar ko'rinmaydi.** Ilova telefon sozlamasiga qarab qorong'i mavzuga o'tadi (`Theme.kt`), lekin ko'p joyda rang qattiq yozilgan:
   - `CashDueLine` ("Haydovchi restoranga … so'm to'laydi") matni `BrandDark`, kartaning foni ham `BrandDark` → umuman ko'rinmaydi. Bu **naqd pul summasi** — eng xavflisi.
   - `WalkLine`, "Taksi: …" qatori, "Tayyorlanmoqda" nishoni, tasdiq oynasidagi ogohlantirish — `BrandDark` matn qorong'i fonda.
   - Status bar: qorong'i rejimda och yalpiz (`BrandMint`) fonga oq ikonkalar.
   Tuzatish (eng tez): ilovani doim yorug' mavzuda ochish (`darkTheme = false`). To'g'ri yo'l: qattiq ranglar o'rniga `MaterialTheme.colorScheme.onSurface` va h.k.
4. **Qo'ng'iroq chalinayotgani haqidagi qizil chiziq pastda qoladi.** Buyurtmalar ekrani tepasida ketma-ket 5 tagacha element turadi: filtr chiplari → "navbatchilikda emas" → **"Yangi buyurtma kutmoqda!"** → "e'tibor kerak" → "Internet yo'q" → qidiruv maydoni. Kichik telefonda birinchi buyurtma kartasi ekranning pastiga tushadi.
   Tuzatish: qizil "kutmoqda" chizig'i eng tepada (chiplardan oldin); qidiruv maydonini sarlavhadagi 🔍 ikonkaga yashirish (oshxonada qidiruv kam ishlatiladi).
5. **"Internet yo'q. Qayta urinilmoqda..." juda ko'zga tashlanmaydi.** Oddiy kulrang matn (`OrdersScreen.kt:331`). Internet yo'q paytda yangi buyurtma kelmaydi — bu eng muhim ogohlantirishlardan biri.
   Tuzatish: qizil/to'q sariq to'liq chiziq + ikonka, "Oxirgi yangilanish: 14:32".
6. **Buyurtma tafsilotida taomlar ro'yxati pastda.** `OrderDetailScreen.kt`: Xulosa → ogohlantirish → tugmalar → **Holat tarixi (timeline)** → keyin Taomlar. Oshxona birinchi navbatda taomlarni o'qiydi, tarix esa kam kerak.
   Tuzatish: Taomlar kartasi Xulosadan keyin darhol; Holat tarixi pastga yoki yig'iladigan bo'limga.

## B. O'rtacha (qulaylik)
7. **"Buyurtmani bekor qilish" asosiy tugmalar bilan yonma-yon.** Tafsilotda xavfli tugma "Qabul qilish / Tayyorlash" ostida darhol turadi. Oyna tasdiq so'raydi, lekin barmoq tasodifan tegishi oson.
   Tuzatish: sahifaning eng pastiga, oraliq bilan, kichikroq matnli tugma qilib o'tkazish.
8. **Mayda shriftlar qolgan.** Holat nishoni 11 sp, to'lov nishoni 10 sp, pastki tab 11 sp, ogohlantirish izohi 11 sp. Oshxonada telefon qo'lda emas, stolda — qo'l uzunligida o'qiladi.
   Tuzatish: kamida 13–14 sp; pastki tab 12 sp.
9. **Juda kichik bosish joylari.** Xato chizig'ini yopish tugmasi 20 dp (`OrdersScreen.kt:396`), Sozlamalardagi ba'zi ikonkalar 20 dp. Android tavsiyasi — kamida 48 dp.
10. **To'q sariq matn och to'q sariq fonda past kontrastli.** `WarningOrange` (`#D97706`) 10–15 % shaffof to'q sariq fonda (~3:1). Ishlatiladigan joylar: "e'tibor kerak", "Qabul qildim" izohi, "navbatchilikda emas". Tuzatish: matn uchun to'qroq rang (`#B45309` yoki `#92400E`).
11. **"Qabul qildim" kartasidagi matn uzun** (to'lov + bekor qila olmaydi + tayyorlashni boshlang — 3 fikr bir jumlada). Tuzatish: "To'lov keldi. Qabul qiling." va tugma; qolgani kerak emas.
12. **Yangi buyurtma haqida bir vaqtda 3 ta signal.** Qizil chiziq + pastdan snackbar "Yangi buyurtma: …" + qo'ng'iroq. Snackbar pastki tugmalarni yopib qo'yishi mumkin. Tuzatish: qo'ng'iroq yoqilgan telefonda snackbarni ko'rsatmaslik (qizil chiziq yetarli).
13. **Ilovaga qaytganda ro'yxat ikki marta yangilanadi va aylanuvchi belgi chiqadi.** `MainScreen` (jim) va `OrdersScreen` (belgi bilan) ikkalasi ham `ON_RESUME`da yuklaydi. Tuzatish: faqat bittasi, jim rejimda.
14. **Menyu kartasida holat ikki marta yozilgan:** "Mavjud" nishoni va kalit yonida "Sotuvda". Bittasi yetarli (kalit + "Sotuvda / Sotuvda emas").
15. **"Sozlamalar" tabi do'kon ikonkasi bilan** (`Storefront`). Odatiy belgi — tishli g'ildirak (`Settings`).

## C. Kichik / egasining qarori kerak
16. **Moliya yashirin: Sozlamalarni 3 marta tez bosish.** Bu egasining qarori (kassir ko'rmasin) va ustida 4 xonali kod ham bor. Kod bor ekan, ochiq "Moliya 🔒" qatori (Sozlamalar ichida) xavfsizlikni kamaytirmaydi, lekin rahbar uchun topish oson bo'ladi. QAROR KERAK.
17. Ilova matnlari kodga qattiq yozilgan (`strings.xml` emas) — mijoz ilovasidagidek rus/kirill tilini qo'shish kerak bo'lsa, avval ularni ko'chirish kerak.
18. Apostrof har xil (`‘`, `’`, `'`) hali ham bor: "e‘tibor" (`OrdersScreen.kt:306`) va "e’tibor" (`:321`).

## Tuzatish rejasi (tasdiqlansa)
1. Ranglar: A1, A2, A3 (eng tezi — doim yorug' mavzu), B10. Faqat rang qiymatlari, mantiq o'zgarmaydi.
2. Buyurtmalar ekrani tartibi: A4, A5, B12, B13.
3. Tafsilot ekrani: A6, B7, B11.
4. Shrift va bosish joylari: B8, B9, B14, B15, C18.
5. Bitta yangi restoran APK (ovoz tuzatishi bilan birga), telefonda: yangi buyurtma qo'ng'irog'i, tungi rejim, kichik ekran.

Tekshirilmagan: hisobot kod bo'yicha; ranglar va joylashuv telefonda ko'rilmagan.
