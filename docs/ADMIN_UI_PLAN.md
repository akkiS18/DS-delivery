# DS Admin: UI/UX reja (2026-11-10)

Maqsad: admin ilovani bitta tartibli dizayn tizimiga keltirish (shrift, rang, logo, navigatsiya, komponentlar). Pul va PIN/kirish **mantig‘iga tegilmaydi**, faqat ko‘rinish va tuzilma.
Qarorlar egasi bilan "grill-me" suhbatida qabul qilingan (2026-11-10). Oxirida shu uslub `ds-admin-ui` skill sifatida beriladi (7-bo‘lim).

## 1. Hozirgi holat (audit)

| Joy | Holat | Muammo |
|---|---|---|
| Shrift | Tizim Roboto, `Theme.kt`da 5 ta qo‘lda uslub | Bitta ham maxsus shrift yo‘q; `labelSmall`, `headline` yo‘q, qolgan joyda Material standarti |
| Rang | Ko‘k `#1565C0`; holat ranglari (`UrgentColor`, `WarnColor`, `OkColor`, `InfoColor`, `NeutralColor`) `Format.kt`da, Theme'dan tashqarida | Dark mode yo‘q, kontrast tekshirilmagan, 4 ilova 4 xil rangda |
| Logo | Ko‘k fonda oq qo‘ng‘iroq | Brend belgisi emas |
| Navigatsiya | 5 pastki tab (Diqqat, Pul, Kartalar, Boshqaruv, Yordam) + tishli tugma (Sozlamalar) + "Boshqaruv" ichida 5 ichki tab | Ichki tablar telefonda tor; Sozlamalar yashirin |
| Komponentlar | `Card`, `Banner`, `PrimaryButton` `MoneyTab.kt`da; har ekran o‘z dialog va bo‘sh/xato matnini yozadi | Bir xillik yo‘q ("Yuklanmoqda…" matni, "Yuklab bo‘lmadi…") |
| Hajm | 28 UI fayl, ~5300 qator | Bosqichma-bosqich o‘tish shart |

## 2. Qabul qilingan qarorlar

| Mavzu | Qaror |
|---|---|
| Rang yo‘nalishi | Grafit neytral + **bitta aksent: indigo `#4F5BD5`** |
| Holat ranglari | Aksentdan alohida: qizil = shoshilinch, to‘q sariq = ogohlantirish, yashil = yaxshi. Rang yolg‘iz belgi emas: har doim ikonka + matn |
| Shrift | **Manrope** (ilovaga o‘rnatiladi). Zaxira: Plus Jakarta Sans (faqat Manrope o‘zbek belgilarida muammo bersa) |
| Logo | Egasi tayyor logo bermaydi: men oddiy **"DS" monogramma** (vektor) chizaman |
| Dark mode | **Ha**, tizim sozlamasiga ergashadi |
| Zichlik | **O‘rta (standart Material)**: asosiy matn 15-16sp |
| Bosh ekran | Shoshilinch ishlar **+ bugungi raqamlar** |
| Tablar | **4 pastki tab**: Diqqat · Pul · Murojaat · Yana |
| Bosqichlar | Asos → Bosh+navigatsiya → Pul → qolgan bo‘limlar; har biri alohida commit |
| Skill | Faqat DS Admin uslubi |

## 2a. Alifbo: yangi o‘zbek lotin imlosi (egasi talabi, 2026-11-10)

Qonun O‘RQ-1184 (imzolangan 2026-10-21, kuchga kirishi 2027-04-22): **Oʻ→Ö, Gʻ→Ğ, Sh→Ş, Ch→Ç**; `ng` o‘z holicha qoladi, tutuq belgisi qoladi (`ma’no`, `şe’r`). Misollar: so‘m→**söm**, qo‘ng‘iroq→**qöngğiroq**, shoshilinch→**şoşilinç**, choy→**çoy**, tekshirish→**tekşiriş**.

Qoidalar: (1) ilovadagi barcha o‘zbekcha matn shu imloda; (2) yangi matn to‘g‘ridan-to‘g‘ri yangi imloda yoziladi, nuqtasiz `ı` ishlatilmaydi; (3) tekshiruv: `node scripts/uz-new-alphabet.mjs apps/admin-android/app/src` (eski imlo qolsa 1 qaytaradi; `--write` tuzatadi, ingliz so‘zi/kodga tegmaydi: izoh, kalit, `${...}` ichi); (4) serverdan keladigan matn (Diqqat kartalari, `src/modules/admin-attention/service.ts`, ~24 qator) 2-bosqichda o‘tkaziladi.

## 3. Dizayn tokenlari (boshlang‘ich qiymatlar; 1-bosqichda kontrast testi bilan tasdiqlanadi)

**Ranglar** (yorug‘ / qorong‘i):

| Token | Yorug‘ | Qorong‘i |
|---|---|---|
| background | `#F5F6F8` | `#121317` |
| surface (karta) | `#FFFFFF` | `#1C1E24` |
| surfaceVariant (kiritish maydoni, chip) | `#ECEEF2` | `#272A31` |
| outline (chiziq) | `#D7DAE1` | `#383B44` |
| onSurface (matn) | `#1B1D23` | `#E8E9ED` |
| onSurfaceVariant (ikkinchi darajali matn) | `#555A66` | `#A9ADB8` |
| primary (aksent) | `#4F5BD5` | `#A3AAFF` |
| onPrimary | `#FFFFFF` | `#14163A` |
| urgent | `#C62828` | `#FF8A80` |
| warn | `#A85F00` | `#FFB74D` |
| ok | `#1E7B4A` | `#6FD29B` |

Qoida: matn kontrasti kamida **4.5:1** (WCAG AA), katta matn/ikonka **3:1**. Buni JVM unit test hisoblaydi (emulator kerak emas).

**Tipografiya** (Manrope; 400/500/600/700/800 vazn, summalar uchun tabular raqamlar bo‘lsa `tnum`):

| Uslub | Hajm | Vazn | Qayerda |
|---|---|---|---|
| display | 28sp | 800 | Bosh ekrandagi katta raqam |
| titleLarge | 22sp | 700 | Ekran sarlavhasi |
| titleMedium | 17sp | 600 | Karta sarlavhasi |
| bodyLarge | 16sp | 400 | Asosiy matn |
| bodyMedium | 15sp | 400 | Ikkinchi darajali matn |
| labelLarge | 15sp | 600 | Tugma |
| labelSmall | 12sp | 600 | Chip, nishon |

Telefon shrift masshtabi 1.3 gacha ekran sinmasligi kerak (matn kesilmaydi, tugmalar o‘z ichida o‘raladi).
Karta raqami (`CardsTab`) monospace qoladi.
Tekshirilgan (2026-11-10): Ö ö Ğ ğ Ş ş Ç ç va ’ Manropeda bor; tutuq belgisi ʼ (U+02BC) yo‘q, shuning uchun interfeysda ’ (U+2019) ishlatiladi; kirill қ ғ ҳ yo‘q (restoran nomida bo‘lsa tizim shriftidan chiqadi). Raqamlar uchun tnum (tabular) bor.

**Bo‘shliq/shakl:** 4dp setka; ekran chetidan 16dp; karta 16dp radius, ichida 16dp; karta orasi 12dp; tugma balandligi 48dp; bosiladigan joy kamida 48x48dp.

## 4. Navigatsiya va ekranlar

```
Pastki panel:  Diqqat   Pul   Murojaat   Yana
Diqqat  = bosh ekran: [4 ta bugungi raqam kartasi] + shoshilinch ishlar ro‘yxati (hozirgi AttentionTab)
Pul     = Pul bosh (to‘lovlar, qaytarish, komissiya, restoranlarga to‘lov) + Kartalar (ichki bo‘lim, pastdagi 3 ta chip/segment)
Murojaat= support chat (hozirgi Yordam tabining murojaatlar qismi)
Yana    = katta qatorli ro‘yxat: Restoranlar, Taksi, Mijozlar, Aksiya, Joylar, Platforma, Qo‘llanma, Sozlamalar
```
- "Yana" ichidagi har bo‘lim **o‘z ekraniga** ochiladi (yuqorida orqaga strelka); gorizontal ichki tablar yo‘qoladi.
- Yuqoridagi tishli tugma olib tashlanadi, Sozlamalar "Yana" ichida.
- Belgilar (badge) soni tablarda qoladi (`badgeFor`); "Yana"da yig‘indi nuqta.
- Orqaga tugmasi (system back) har doim bir qadam orqaga; Diqqatdan chiqish ilovani yopadi.

**Bosh ekran raqamlari** (yangi o‘qish-faqat server endpoint, `GET /api/v1/admin/today`, admin sessiyasi bilan, pulga tegmaydi):
1. Bugungi buyurtmalar: jami / yetkazilgan / bekor / jarayonda
2. Bugungi tushum: bugun tasdiqlangan to‘lovlar summasi (test buyurtmalar kirmaydi, Toshkent kuni)
3. To‘lanishi kerak komissiya (hozirgi Komissiya ekranidagi jami)
4. Ochiq murojaatlar va kutayotgan tekshiruvlar soni

## 5. Komponentlar (yagona to‘plam, `ui/kit/` papkasi)

`AdminTheme` · `AdminCard` · `SectionHeader` · `ListRow` (ikonka, sarlavha, ikkinchi qator, o‘ng tomonda holat/chevron) · `StatusChip` (rang + ikonka + matn) · `MetricTile` · `PrimaryButton` / `SecondaryButton` / `DangerButton` · `ConfirmDialog` (pulga/qaytarib bo‘lmas amallar: nima o‘zgarishi aniq yoziladi, "Ha, ..." tugmasi amalni nomlaydi) · `EmptyState` (sabab + nima qilish kerak) · `ErrorState` (ulanish yo‘q + "Qayta urinish") · `LoadingSkeleton` (qotib turgan "Yuklanmoqda…" matni o‘rniga) · `FormField` · `Snackbar` (natija xabari).

Eski `Card`, `Banner`, `PrimaryButton` (`MoneyTab.kt`) va `Format.kt`dagi holat ranglari shu to‘plamga ko‘chiriladi; ekranlar o‘tgan sari eski nomlar o‘chadi.

**UX qoidalari:**
1. Bir kartada bitta asosiy amal; xavfli amal (o‘chirish, qaytarish, pul) har doim tasdiq so‘raydi.
2. Har amal natijasi ko‘rinadi (snackbar yoki holat o‘zgarishi); jim muvaffaqiyat yo‘q.
3. Bo‘sh ro‘yxat sababini tushuntiradi; xato "Bajarilmadi" emas, sabab + yechim.
4. Yuklash paytida skelet, eski ma‘lumot ustida yangilanish (pull-to-refresh qoladi).
5. Rang yolg‘iz ma‘no tashimaydi (ikonka + matn).
6. Pul summalari bir xil format (`somText`), o‘ngga tekislangan/tabular, katta.
7. Matn o‘zbek lotin, qisqa, buyruq shaklida ("Tasdiqlash", "Yopish").

## 6. Bosqichlar

| # | Nima | Qamrab oladi | Tekshiruv |
|---|---|---|---|
| 1 | **Asos** (BAJARILDI 2026-11-10, telefonda ko‘rilmagan) | Manrope fayllari, `Theme.kt` (yorug‘+qorong‘i), tokenlar, holat ranglarini Theme'ga ko‘chirish, `ui/kit/` komponentlari, "DS" logo (adaptive icon + monochrome qatlam + kirish ekranidagi belgi), `colors.xml/themes.xml` (status bar, splash) | `compileReleaseKotlin`, JVM testlar (kontrast, shrift belgilari), mavjud testlar |
| 2 | **Bosh + navigatsiya** (BAJARILDI 2026-11-10: kod+testlar, telefonda ko‘rilmagan, serverga qo‘yilmagan) | 4 tab, "Yana" ro‘yxati, Diqqat ekrani yangi dizayni, bugungi raqamlar + server endpointi (`/admin/today`) va uning DB testi | `tsc`, `test:admin:db` + yangi test, Kotlin kompilyatsiya, telefon |
| 3 | **Pul** | Pul bosh, Kartalar, Qaytarish, To‘lovlar, Komissiya | Kotlin kompilyatsiya, telefon (egasi) |
| 4 | **Qolgan** | Murojaat, Restoranlar, Taksi, Mijozlar, Aksiya, Joylar, Platforma, Qo‘llanma, Sozlamalar, Kirish va PIN ekranlarining ko‘rinishi | Kotlin kompilyatsiya, telefon |
| 5 | **Skill** | `.claude/skills/ds-admin-ui/` (haqiqatan yozilgan kodga mos) | skillni yangi ekranda sinash |

Har bosqich: kichik commit, hisobot (nima tekshirildi / tekshirilmadi), deploy faqat egasining "ha"siga. Server tomoni faqat 2-bosqichdagi yagona yangi endpoint.

## 7. Skill (5-bosqich)

`.claude/skills/ds-admin-ui/SKILL.md` + `tokens.md` (rang/shrift/bo‘shliq jadvali) + `components.md` (har komponent: qachon, misol). Mazmuni: bu hujjatdagi qoidalar, yangi ekran tekshiruv ro‘yxati ("kit komponentlari ishlatildimi, tasdiq bormi, bo‘sh/xato holat bormi, dark mode, 1.3x shrift"), va qilinmaydigan ishlar (qo‘lda `Color(0x...)`, `Text` bilan o‘z "Yuklanmoqda…"i, rangni yolg‘iz belgi qilish). Skill kodga qarab yoziladi, shu reja ko‘chirilmaydi, shunda u haqiqatga mos bo‘ladi.

## 8. Ochiq masalalar (standart yechim bilan)

| Masala | Standart | O‘zgartirish kerakmi |
|---|---|---|
| Monogramma ko‘rinishi | Indigo yumaloq kvadrat, oq "DS", D va S bitta chiziqda (geometrik) | 1-bosqichda 2-3 variant ko‘rsataman, siz tanlaysiz |
| "Tushum" ta‘rifi | Bugun tasdiqlangan to‘lovlar summasi (CONFIRMED_MANUAL), test va bekor qilinganlarsiz | Restoran ulushi/komissiya ajratib ko‘rsatilsinmi? |
| Tekshirish usuli | JVM testlar + egasi telefonda ko‘radi (emulator/screenshot kutubxonasi o‘rnatilmaydi, AGENTS.md qoidasi) | Screenshot-test (Paparazzi) kerak bo‘lsa, ruxsat kerak |
| Restoran/taksi ilovalari | Tegilmaydi (skill faqat admin) | — |
