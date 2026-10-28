# Bir nechta restorandan buyurtma (OrderGroup) — reja

Yozilgan sana: 2026-10-28. Holat: **REJA, egasi tasdiqlamagan. Kod yozilmagan.**
Tasdiqlangandan keyin bosqichma-bosqich (M1…M4) qilinadi; productionga faqat egasining alohida ruxsati bilan chiqariladi.

---

## 1. Maqsad

Mijoz bitta savatda 2–3 ta restorandan ovqat tanlaydi, **bitta manzilga, bitta taksi** bilan oladi. Masalan: bir restorandan lavash, boshqasidan ichimlik va desert.

Egasi avval aytgan shartlar (2026-10-27):
- bir nechta restorandan buyurtma beriladi (`OrderGroup`);
- bitta taksi bir nechta olib ketish manzilidan oladi;
- savat bir nechta restorandan bo'ladi;
- mijozga "taksi narxi oshishi mumkin" deb sezdirmay eslatiladi;
- restoranlar soniga chegara qo'yiladi;
- foydalanish shartlariga band qo'shiladi.

## 2. Hozirgi tizim va nima uchun bu oddiy qo'shimcha emas

Kodda tekshirilgan haqiqiy holat:

| Narsa | Hozir | Ko'p restoranga ta'siri |
|---|---|---|
| `Order` | bitta `restaurantId` | har restoran uchun alohida `Order` kerak |
| `Payment` | `orderId` unique, bitta restoran kartasiga | har restoran o'z kartasiga alohida to'lov oladi |
| Pul | mijoz → restoran kartasi (platforma pul ushlamaydi) | mijoz **ikki-uch marta alohida o'tkazma** qiladi |
| `TaxiDispatch` | `orderId` majburiy, `(orderId, attemptNo)` unique, buyurtmaga bitta faol dispatch | bitta taksi uchun bitta "boshliq" buyurtma kerak |
| Taksi xabari / taksi ilovasi | bitta restoran manzili | bir nechta olib ketish nuqtasi ko'rsatilishi kerak |
| Yetkazildi tasdig'i (`completeDelivery`) | bitta buyurtmani `READY → COMPLETED` qiladi, komissiyani yozadi | guruhdagi hamma buyurtmani yopishi kerak |
| Savat (mijoz ilovasi) | `restaurantId` bitta; boshqa restoran qo'shilsa savat tozalanadi | savat restoran bo'yicha guruhlanadi |
| Cheklov | `maxOpenUnpaidOrders` (REAL: 2) | 3 restoranli guruh shu limitga uriladi |

Xulosa: eng xavfli joylar **pul** (to'lov, komissiya, qaytarish) va **taksi** (yetkazildi tasdig'i). Shu sabab reja mavjud mantiqni o'zgartirmaydi, ustiga qo'shadi.

## 3. Asosiy g'oya (arxitektura qarori)

**Har restoran uchun alohida `Order` saqlanadi, ularni `OrderGroup` bog'laydi.** Har buyurtma o'zining to'lovi, restorani, tayyorlash holati, komissiyasi, qaytarishi, bahosi va qo'llab-quvvatlash murojaatiga ega — hozirgi barcha qoidalar shu tariqa o'zgarishsiz ishlaydi.

**Taksi uchun bitta "boshliq" (lead) buyurtma tanlanadi.** Dispatch faqat shu buyurtmada bo'ladi. Qolgan buyurtmalarda dispatch bo'lmaydi (bazadagi trigger bilan majburlanadi, xuddi o'zimiz yetkazish rejimidagi kabi). Taksi xabari va ilovasi guruhdagi hamma restoranlarni olib ketish nuqtasi sifatida ko'rsatadi. Yetkazildi tasdiqlanganda boshliq buyurtma bilan birga guruhdagi tayyor buyurtmalar ham bir tranzaksiyada yopiladi.

Bu yondashuvning afzalligi: `TaxiDispatch`, taksi worker, qayta tiklash (recovery), taksi ilovasining holat mashinasi, "bitta buyurtmaga bitta faol dispatch" invarianti — hammasi o'zgarmaydi.

Rad etilgan variantlar:
- *Bitta katta `Order` ichida bir nechta restoran* — to'lov, komissiya, restoran ekrani, qaytarish hammasini qayta yozishni talab qiladi. Juda xavfli.
- *Har buyurtmaga alohida taksi* — mijoz bir necha taksi haqi to'laydi, egasining talabiga zid.
- *Platforma bitta to'lov qabul qilib restoranlarga taqsimlaydi* — platforma pul ushlamaydi qoidasiga zid.

## 4. Mijoz tajribasi

### 4.1 Savat
- Menyudan boshqa restorandan taom qo'shilganda savat tozalanmaydi; endi restoran bo'yicha bo'limlarga bo'linadi: "Restoran A — …", "Restoran B — …". Har bo'limda o'z summasi, oxirida umumiy summa.
- Chegara (tavsiya: **3 restoran**) to'lganda: "Bir buyurtmada eng ko'pi bilan 3 ta restoran. Avval bittasini olib tashlang yoki alohida buyurtma bering."
- 2 va undan ko'p restoran bo'lganda savatda sezdirmay, kichik kulrang matn: *"Bir nechta restorandan olinganda taksi narxi oshishi mumkin. Narxni taksi xizmati belgilaydi."*
- Savat xotirasi (`ds.cart.v1`) yangi shaklga (`v2`) ko'chiriladi; eski bitta-restoranli savat avtomatik v2 ga o'giriladi, yo'qolmaydi.
- Xizmat haqi (FLAT/PERCENT/TIERED) **har restoran savati uchun alohida** hisoblanadi (§9 savol 5).

### 4.2 Rasmiylashtirish (Checkout)
- Manzil, telefon, taksi xizmati tanlovi — bir marta (guruh uchun umumiy).
- To'lov usuli: **faqat karta** (naqd va "o'zimiz yetkazamiz" guruhda o'chiq, §9 savol 4).
- Tugma bosilganda **hammasi yoki hech nima**: istalgan restoran yopiq/pauzada, taom tugagan, narx o'zgargan yoki kartasi yo'q bo'lsa — hech qaysi buyurtma yaratilmaydi, mijozga qaysi restoran muammo ekani aytiladi (qaysini savatdan olib tashlash mumkin).
- Qayta bosish xavfsiz: guruh `checkoutKey` bilan idempotent.

### 4.3 To'lov
- Guruh ekrani: har restoran uchun alohida to'lov kartochkasi (karta raqami, summa, hisoblagich, holat). Ikkita (uchta) o'tkazma qilinadi.
- Tepada aniq matn: *"Har bir restoranga alohida o'tkazma qilinadi. Summani aynan ko'rsatilgandek yuboring."* (har kartochkada hozirgi `PayWarning` ogohlantirishi qoladi.)
- To'langan kartochka "To'landi ✓" bo'ladi; qolganlari kutadi.

### 4.4 Kuzatish
- Guruh ekrani: har restoran bo'yicha holat (to'lov kutilmoqda / tayyorlanmoqda / tayyor) + pastda bitta taksi holati: "Hammasi tayyor bo'lgach taksi chaqiriladi" → "Taksi yo'lda" → "Yetkazildi".
- Buyurtmalar ro'yxatida guruh bitta qator bo'lib chiqadi ("2 ta restoran • #ABC12"), ichiga kirsa alohida buyurtmalar.
- Har buyurtmaning o'z ekrani (`#/order/<id>`) saqlanadi; u yerda "Bu buyurtma guruhning qismi" havolasi bor. Baho, qo'llab-quvvatlash, bekor qilish/qaytarish — **har buyurtma bo'yicha alohida**, hozirgidek.

## 5. Restoran tajribasi
- Restoran ilovasida hech narsa majburiy o'zgarmaydi: restoran faqat o'z buyurtmasini ko'radi, o'z summasini oladi, o'zi "Tayyorlash" va "Tayyor" bosadi.
- Kichik qo'shimcha (M4, ixtiyoriy): buyurtma kartochkasida "Boshqa restoran bilan birga yetkaziladi. Taksi hamma tayyor bo'lgach chaqiriladi." deb ko'rsatish — restoran taksi nega kelmayotganini tushunsin.
- Restoran boshqa restoranni, uning mijoz ma'lumotini, summasini ko'rmaydi (ko'rinadigan narsa faqat "guruh, N ta restoran").
- Komissiya/xizmat haqi, moliya ekrani, qaytarishlar — hozirgidek **har buyurtma bo'yicha**.

## 6. Taksi

### 6.1 Qachon chaqiriladi
**Tavsiya: guruhdagi hamma to'langan buyurtma "Tayyor" bo'lgandan keyin** (oxirgi "Tayyor" bosilgan zahoti). Aks holda haydovchi birinchi restoranda kutadi yoki ovqat sovib qoladi.
- Kamchilik: birinchi tayyor bo'lgan ovqat ikkinchi restoran tugatguncha kutadi. Yumshatish (keyingi bosqichda): restoranlarga tayyorlash vaqtini muvofiqlashtirish tavsiyasi.
- Alternativa (tavsiya etilmaydi): birinchi "Tayyor"da chaqirish — haydovchi uzoq kutadi, taksi haqi oshadi.

### 6.2 Boshliq buyurtma
- Guruhdagi hamma kutilayotgan buyurtma tayyor (yoki bekor/muddati o'tgan) bo'lgan zahoti, **oxirgi tayyor bo'lgan buyurtma** boshliq bo'ladi: `OrderGroup.leadOrderId` CAS bilan bir marta yoziladi (ikki jarayon bir vaqtda urinsa, bittasi yutadi).
- Faqat shu buyurtmaga `TaxiDispatch` yaratiladi (mavjud `scheduleTaxiWhenPreparing(... { immediate: true })`, WALK_OK yo'lidagi kabi).
- Hamma kutilayotgan buyurtma tayyor bo'lmasa ham, xavfsizlik to'ri (sweeper) har ~5 soniyada tekshiradi: bekor/muddati o'tgan buyurtma tufayli "oxirgi tayyor" hodisasi o'tkazib yuborilmasin.

### 6.3 Taksi xabari va ilovasi
- Telegram xabari: "Olib ketish: 1) Restoran A — manzil, telefon; 2) Restoran B — manzil, telefon" + yagona yetkazish manzili.
- Taksi ilovasi API: yangi `stops` ro'yxati (nom, manzil, telefon, buyurtma kodi). **Eski ilovalar uchun moslik**: eski maydon `restaurant` birinchi nuqta bo'lib qoladi, lekin nomi "A + B (2 ta restoran)", manzili "A: …; B: …" ko'rinishida to'ldiriladi — shunda taksi ilovasi hali yangilanmagan bo'lsa ham haydovchi ikkala manzilni matnda ko'radi.
- Taksi ilovasining (Kotlin) yangi ekrani nuqtalarni ro'yxat qilib ko'rsatadi (M4). Egasi APK'ni o'zi yig'adi.
- "Ovqat qiymati" — guruh bo'yicha yig'indi, "taksi haqi emas" izohi bilan. Naqd guruhda yo'q.

### 6.4 Yetkazildi tasdig'i
`completeDelivery` boshliq dispatch bo'yicha ishlaydi (o'zgarmaydi). Qo'shimcha: **o'sha tranzaksiyada** guruhdagi qolgan buyurtmalardan holati `READY`, to'lovi tasdiqlangan va ochiq qaytarish so'rovi yo'qlari CAS bilan `READY → COMPLETED` qilinadi, har biriga `OrderEvent` (`DELIVERY_CONFIRMED`, `viaLeadOrder`) yoziladi va komissiya yoziladi (har buyurtma o'ziniki, ledgerdagi mavjud qoidalar bilan; takroriy chaqiruv no-op). Shartga mos kelmagan buyurtma o'tkazib yuboriladi va event bilan qayd etiladi, hech qachon "yetkazildi" deb belgilanmaydi.

## 7. Backend dizayni

### 7.1 Ma'lumotlar bazasi (faqat qo'shimcha migratsiya, hech narsa o'chirilmaydi)
```
OrderGroup
  id, code (ommaviy kod, unique), customerId, checkoutKey (unique)
  addressText, deliveryLat, deliveryLng, phoneSnapshot
  taxiCompanyId?            -- mijoz tanlagan taksi xizmati (yoki avtomatik)
  leadOrderId? (unique)     -- taksi uchun boshliq buyurtma, CAS bilan bir marta yoziladi
  isTest, createdAt, updatedAt
Order.groupId String?  (FK -> OrderGroup, indeks)
```
Bazadagi cheklovlar ("kamida bitta" emas, har "ko'pi bilan bitta" qoida uchun DB kafolati):
- `UNIQUE (groupId, restaurantId)` (qisman, `groupId IS NOT NULL`) — guruhda bir restoran faqat bir marta.
- `OrderGroup.leadOrderId` unique — guruhga bitta boshliq.
- **Trigger** `TaxiDispatch_group_lead_only`: `groupId`li buyurtmaga dispatch faqat u `OrderGroup.leadOrderId` bo'lsa yaratiladi (aks holda xato). Guruhsiz buyurtmalar uchun hech narsa o'zgarmaydi.
- **Trigger** (yoki CHECK): bitta guruhda ko'pi bilan `MULTI_MAX_RESTAURANTS` ta buyurtma (xizmat darajasida ham tekshiriladi).
- `Order.groupId` bo'sh bo'lgan hamma eski buyurtma o'zgarishsiz ishlaydi.

### 7.2 Endpointlar (mijoz ilovasi, `/miniapp/...`)
- `POST /order-groups` — `{ checkoutKey, orders: [{ restaurantId, items, expectedTotalSom, expectedUnitPrices }], address|addressId, phone?, taxiCompanyId? }`, 2…N restoran, faqat karta.
- `GET /order-groups` va `GET /order-groups/:id` — faqat egasiga ko'rinadi; begona id "topilmadi" kabi (mavjud `customerWhere` qoidasi).
- Mavjud `/orders`, `/orders/:id`, bekor qilish, baho — o'zgarmaydi.
- `/config` javobiga `multiRestaurant: { enabled, maxRestaurants }` qo'shiladi (eski ilovalar ko'rmaydi, buzilmaydi).

### 7.3 Buyurtma yaratish oqimi (`placeOrderGroup`, yangi modul `src/modules/order-groups/`)
1. Kirish tekshiruvi (zod, strict), oqim funksiyasi yoqilganligi (`multi_restaurant_enabled`), restoranlar soni ≤ chegara, takroriy restoran yo'q.
2. `checkoutKey` bo'yicha oldingi guruh bor bo'lsa — o'sha qaytariladi (idempotent). Boshqa mijozning kaliti → `CHECKOUT_KEY_BEGONA`.
3. **Bitta tranzaksiya, bitta to'lov qulfi** (`engine`ga yangi `createGroupCheckout`, mavjud `createCheckout` mantig'i har buyurtma uchun takrorlanadi):
   - har restoran uchun mavjud `validateCheckout` (ochiq/pauza emas, taomlar mavjud, narxlar bazadan, kutilgan summa mos), xizmat haqi shu restoran savati bo'yicha;
   - REAL rejimda har restoranda faol tasdiqlangan karta, olib ketish manzili, TOLOV_YOPIQ darvozasi (mavjud tekshiruvlar);
   - `OrderGroup` + N ta `Order` (`groupId`, `checkoutKey = "<guruhKaliti>:<restoranId>"`) + N ta `Payment` + har biriga karta ajratish;
   - birortasi muvaffaqiyatsiz bo'lsa **butun tranzaksiya qaytariladi** (hech narsa yaratilmaydi).
4. Mijoz limiti: `maxOpenUnpaidOrders` **guruhni bitta hisoblaydi** (aks holda 3 restoranli guruh REAL limit 2 ga uriladi).
5. Audit: har buyurtma uchun `OrderEvent` `PLACED` (`details.groupId`), guruh yaratilishi alohida event.

### 7.4 Tayyor → taksi (`settleGroup`)
- `takeStaffAction` ichida: `START_PREPARING` da guruh buyurtmasi uchun taksi **jadvallanmaydi** (hozir har buyurtmada "to'xtatilgan" dispatch yaratiladi — guruhda bu trigger bilan taqiqlangan); `MARK_READY` da `settleGroup(tx, groupId)` chaqiriladi.
- `settleGroup`: guruh qatorini `FOR UPDATE` bilan qulflaydi; hali tugallanmagan a'zolar (to'lov kutilmoqda/tasdiqlangan/tayyorlanmoqda) bor-yo'qligini sanaydi; yo'q bo'lsa va kamida bitta `READY` bo'lsa — `leadOrderId` ni CAS bilan yozadi va dispatch yaratadi. Qayta chaqirish no-op.
- Sweeper (taksi worker siklida): `leadOrderId IS NULL` va hamma a'zo tayyor/terminal bo'lgan guruhlar uchun `settleGroup` — bekor/muddati o'tish natijasida "oxirgi tayyor" hodisasi o'tib ketmasligi uchun.

## 8. Pul, komissiya, qaytarish
- Har restoran o'z kartasiga o'z summasini oladi; platforma hech narsa ushlamaydi (o'zgarmagan qoida).
- Xizmat haqi/komissiya: har buyurtma yetkazilganda o'z yozuvi (`CommissionEntry`, `orderId` unique) — qo'shimcha o'zgarish yo'q, faqat guruh orqali yopilganda ham xuddi shu `accrueCommissionTx` ishlaydi.
- Qaytarish: har buyurtma bo'yicha mustaqil (hozirgi `RefundRequest` oqimi). Guruhdagi bir buyurtma bekor bo'lsa, qolganlari davom etadi; bekor bo'lgan restoran taksi kutishida to'siq bo'lmaydi.
- To'lov bir restoran uchun o'tdi, ikkinchisi uchun muddati o'tdi: to'langan buyurtma **yolg'iz** yetkaziladi (§9 savol 3). Muddati o'tgan buyurtmani mijoz xohlasa qayta buyurtma qiladi.
- "Haqiqiy to'lov" darvozasi, `GMAIL_AUTO_CONFIRM`/`HUMO_AUTO_CONFIRM` avtomatik tasdiqlash — har bir to'lov uchun mavjud qoidalar bilan (guruh hech qanday yangi avtomatik tasdiqlash yo'lini ochmaydi).

## 9. Chekka holatlar

| Holat | Qaror |
|---|---|
| Restoranlardan biri yopiq/pauza/taom tugagan (buyurtma paytida) | Guruh umuman yaratilmaydi; mijozga qaysi restoran ekani aytiladi |
| Narx o'zgargan | 409 `NARX_OZGARGAN`, har restoran bo'yicha tafsilot |
| Restoranda faol karta yo'q | Guruh yaratilmaydi (`RESTORAN_TOLOV_QABUL_QILMAYDI`) |
| Mijoz bir restoran uchun to'ladi, ikkinchisiga to'lamadi | Ikkinchisi muddati o'tadi; to'langani yolg'iz yetkaziladi |
| Restoran to'langan buyurtmani bekor qiladi | Qaytarish oqimi (qo'lda); qolganlari davom etadi; taksi qolganlar uchun chaqiriladi |
| Bir restoran juda sekin | Taksi kutadi; ovqat sovishi mumkin — mijozga "hammasi tayyor bo'lgach" deb aytilgan; keyingi bosqich: vaqtni muvofiqlashtirish |
| Taksi "rad etdi / topilmadi" | Mavjud mantiq (boshliq dispatch bo'yicha, fallback, admin tiklash) |
| Taksi yetkazdi, lekin bir buyurtmada ochiq qaytarish so'rovi bor | Shu buyurtma yopilmaydi, event bilan qayd etiladi, qolganlari yopiladi |
| Ikki marta bosish / qayta yuborish | `checkoutKey` bo'yicha bitta guruh |
| Bir vaqtda ikki restoran "Tayyor" bosadi | `settleGroup` qulf + CAS, bitta boshliq, bitta dispatch |
| Guruhdagi bir restoran mock/sinov | Guruh butunlay MOCK yoki butunlay REAL (aralashmaydi) |
| Eski ilova (guruh haqida bilmaydi) | Hech narsa o'zgarmaydi: eski ilova bitta restoranli buyurtma beradi; guruh buyurtmasini `/orders` ro'yxatida oddiy buyurtma kabi ko'radi |
| Eski taksi ilovasi | Matnda ikkala manzil ko'rinadi (§6.3 moslik) |

## 10. Xavfsizlik invariantlari (ds-backend-safety bo'yicha)
- Qo'shimcha migratsiya, ma'lumot yo'qolmaydi; eski buyurtmalar `groupId = NULL`.
- Idempotent pul yo'li: guruh `checkoutKey`, buyurtma `checkoutKey`, to'lov dedupe — mavjud mexanizmlar.
- "Ko'pi bilan bitta" qoidalar bazada: `UNIQUE(groupId, restaurantId)`, `leadOrderId` unique, dispatch trigger, mavjud `TaxiDispatch_only_one_active_per_order`.
- Tranzaksiya + qulf: guruh yaratish `PaymentEngineV3.locked` ichida; `settleGroup` guruh qatorini `FOR UPDATE` qiladi; tashqi chaqiruvlar (Telegram) tranzaksiyadan tashqarida.
- Avtorizatsiya: guruh faqat o'z mijoziga; begona/yo'q id bir xil javob; restoran faqat o'z buyurtmasini ko'radi.
- Audit: har o'zgarish `OrderEvent`/`PaymentEvent` bilan.
- Faqat taksi yuborilgani "yetkazildi" degani emas — yetkazildi faqat taksi operatori tasdig'idan keyin (guruhda ham).
- Haqiqiy to'lov darvozasini o'z-o'zidan ochmaymiz.
- **O'chirgich**: `multi_restaurant_enabled` (platforma sozlamasi, standart **o'chiq**), admin botda `/multi` (`/cash`, `/fee` kabi). O'chiq bo'lsa `POST /order-groups` rad etiladi va ilova savatda bitta restoran qoidasini saqlaydi.

## 11. Bosqichlar (har biri alohida commit, alohida tekshiruv)

**M1 — Backend asos** (taksiga tegmaydi, o'chirgich o'chiq)
- migratsiya (`OrderGroup`, `Order.groupId`, cheklovlar), `createGroupCheckout`, `placeOrderGroup`, `/order-groups` endpointlari, guruh ko'rinishi, `/config` bayrog'i, `/multi` o'chirgich.
- Testlar: bir vaqtdagi ikki xil so'rov bitta kalit → bitta guruh; hammasi-yoki-hech-narsa; begona mijoz; cheklov (restoranlar soni, takroriy restoran); mijoz ochiq-to'lanmagan limiti guruhni bittadek sanashi; mavjud 43 + DB testlari o'zgarmagan.

**M2 — Taksi va yetkazish** (eng nozik bosqich: pul/komissiya yo'liga tegadi)
- `settleGroup` + sweeper, `START_PREPARING`da guruh uchun jadvalsiz, dispatch trigger, `completeDelivery`ning guruh bo'yicha yopishi, taksi xabari va taksi API `stops`.
- Testlar: dispatch faqat boshliqqa (boshqasiga trigger rad etadi); parallel `settleGroup` → bitta dispatch; yetkazildi guruhni bir marta yopadi, takroriy chaqiruv no-op; qaytarishi bor a'zo yopilmaydi; komissiya har buyurtmaga aynan bir marta; bekor/muddati o'tgan a'zo bilan; guruhsiz buyurtmalar o'zgarmagan.

**M3 — Mijoz ilovasi**
- ko'p-restoranli savat (v2 xotira, eski savat ko'chirish), savatda bo'limlar va eslatma, checkout, guruh to'lov/kuzatish ekrani, ro'yxatda guruh, xatolar tavsifi.
- Testlar (vitest): savat reducer, ko'chirish, summa hisobi, chegara, xatolarni ko'rsatish.

**M4 — Qolgan qismlar**
- Taksi ilovasi (Kotlin) `stops` ekrani, restoran ilovasida "guruh" izohi, foydalanish shartlariga band, hujjat va qo'lda sinov qatori (`docs/PENDING_MANUAL_TESTS.md`).
- Egasi ikkala (yoki uchala) APK'ni o'zi qayta yig'adi.

Productionga chiqarish: faqat egasi aytganda, o'chirgich **o'chiq** holda; keyin egasi `/multi` bilan yoqadi va avval o'zi 2 restoran bilan kichik haqiqiy sinov qiladi.

## 12. Tekshirilmaydigan / keyin qoladigan narsalar
- Telefon, haqiqiy pul va haqiqiy taksi bilan ishlash — faqat egasi sinab ko'radi (qo'lda test qatori qo'shiladi).
- Restoranlar orasidagi masofani cheklash: hozir restoranlarda faqat matnli manzil bor (`pickupAddress`), koordinata yo'q, shuning uchun masofa cheklovi **yo'q**. Faqat soni cheklanadi. Koordinata qo'shilsa keyin masofa cheklovi qo'shish mumkin.
- Restoranlarga tayyorlash vaqtini moslashtirib berish (sovib qolmasligi uchun) — keyingi bosqich.
- Naqd to'lov, "o'zimiz yetkazamiz", guruhdagi alohida taksi — v1 da yo'q.

## 13. Xavflar
1. **Yetkazildi yo'li** (`completeDelivery`) — komissiya va holatlar shu yerda; eng ko'p test shu yerga. Xavfni kamaytirish: o'chirgich, guruhsiz yo'l kodi o'zgarmaydi, DB triggerlar.
2. **Mijoz uchun murakkablik** — ikki o'tkazma. Aniq matn va har kartochkada alohida holat bilan yumshatiladi.
3. **Ovqat sovishi** — taksi hamma tayyor bo'lgach chaqirilgani uchun. Chegara 3 restoran, keyin vaqtni moslash.
4. **Taksi narxi** — bir necha manzil narxni oshiradi; mijozga sezdirmay eslatiladi, narxni taksi xizmati belgilaydi.
5. **Taksi ilovasi eskirgan bo'lsa** — matnli moslik bor, lekin to'g'ri tajriba uchun yangi APK kerak.

## 14. Egasi hal qiladigan savollar (har birida mening tavsiyam)

1. **Restoranlar soni chegarasi** — tavsiya: **3** (sozlanadi: 2–4).
2. **Alohida o'tkazmalar** — pul har restoran kartasiga alohida boradi (platforma pul ushlamagani uchun boshqa yo'li yo'q). Shu qabul qilinadimi? — tavsiya: **ha**.
3. **Bir restoranga to'lanib, ikkinchisiga to'lanmasa** — (a) to'langani yolg'iz yetkaziladi (tavsiya) yoki (b) butun guruh bekor, to'langani qaytariladi.
4. **Guruhda naqd to'lov va "o'zimiz yetkazamiz"** — tavsiya: **v1 da yo'q** (haydovchi bir necha restoranga naqd to'lashi murakkab).
5. **Xizmat haqi** — har restoran savati bo'yicha alohida (tavsiya) yoki butun guruh yig'indisi bo'yicha. (TIERED rejimda ikkalasi farq qiladi.)
6. **Taksi qachon chaqiriladi** — hamma tayyor bo'lgach (tavsiya) yoki birinchi tayyor bo'lganda.
7. **Foydalanish shartlari bandi matni** — tavsiya: *"Bir nechta restorandan buyurtma berilganda ovqat hamma restoranlar tayyorlab bo'lgach bitta taksi bilan olib ketiladi; yetkazish narxini taksi xizmati belgilaydi va oddiy buyurtmadan yuqori bo'lishi mumkin. Har bir restoran bo'yicha to'lov, bekor qilish va pulni qaytarish alohida ko'rib chiqiladi."* (huquqshunos ko'rib chiqishi kerak, men maslahat bermayman)
8. **Boshlash usuli** — tavsiya: o'chiq holda productionga chiqarish, keyin egasi `/multi` bilan yoqib, 2 restoran bilan o'zi sinaydi.

---

Tasdiqlansa, M1 dan boshlayman. Har bosqich oxirida: o'zgargan fayllar, ishga tushirilgan va ishga tushirilmagan tekshiruvlar, buyruqlar ro'yxati va qolgan xavflar bo'yicha hisobot beraman.
