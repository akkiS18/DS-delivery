package com.dsdelivery.admin.ui

import com.dsdelivery.admin.AdminApp
import com.dsdelivery.admin.data.ApiResult

/** The Uzbek sentence for a refused call. Codes are the ones the backend (src/modules/admin-money) sends. */
fun failText(f: ApiResult.Failed): String = when (f.error) {
    "NOTE_INVALID" -> "Izoh 10–300 belgi bölsin."
    "ACTION_INVALID" -> "Amal notöğri."
    "CARD_NUMBER_INVALID" -> "Karta raqami notöğri (16 xona, tekşiruv raqami mos kelmadi)."
    "HOLDER_INVALID" -> "Karta egasining ismi notöğri."
    "CARD_TAKEN" -> "Bu karta tizimda allaqaçon bor."
    "ALREADY_DECIDED" -> "Bu karta allaqaçon hal qilingan. Röyxatni yangilang."
    "NO_POOL_CARD" -> "Faol, tasdiqlangan platforma kartasi yöq. Avval karta qöşib, tasdiqlang."
    "OPEN_PAYMENTS" -> "Hozir tölanmagan ${f.count ?: "bir nechta"} ta karta tölovi bor. Ular tugagaç (taxminan 10 daqiqa) qayta urining."
    "NOT_FOUND" -> "Topilmadi. Röyxatni yangilang."
    "BLOCKED" -> "Yoqib bölmadi: " + f.blockers.orEmpty().joinToString(" ") { "• $it" }
    "CHANGED" ->
        if (f.count == null && f.amountSom != null) "Summa özgargan (hozir ${somText(f.amountSom)}). Heç narsa belgilanmadi. Ekranni yangilab, qayta tekşiring."
        else if (f.count == null && f.amountSom == null) "Holat özgargan. Heç narsa qilinmadi. Röyxatni yangilab, qayta tekşiring."
        else "Ma’lumot özgargan (hozir ${f.count ?: 0} ta, ${somText(f.amountSom ?: 0)}). Heç narsa yozilmadi. Röyxatni yangilab, qayta tekşiring."
    "ALREADY_CLAIMED" -> "Bu murojaatni allaqaçon ${f.detail ?: "boshqa administrator"} oldi."
    "ALREADY_RESOLVED" -> "Murojaat allaqaçon hal qilingan."
    "NOT_CLAIMED" -> "Avval «Men oldim» tugmasini bosing."
    "NOT_YOURS" -> "Bu murojaat ${f.detail ?: "boshqa administrator"} da. Faqat egasi boşqara oladi."
    "NOT_ACTIVE" -> "Murojaat jarayonda emas."
    "NOT_RESOLVED" -> "Murojaat hal qilinmagan."
    "SAME_ADMIN" -> "Murojaat allaqaçon şu administratorda."
    "NOT_ALLOWED" -> "Murojaatni faqat egasi boşqaga ötkaza oladi (yoki siz özingizga olişingiz mumkin)."
    "INVALID_TARGET" -> "Notöğri administrator."
    "ALREADY_ACTIVE" -> "Bu buyurtma böyiça #${f.detail ?: "?"} murojaat hali oçiq."
    "TEXT_INVALID" -> "Xabar 1–1000 belgi bölsin."
    "NO_COMPANY" -> "Mos faol kompaniya topilmadi (kompaniyada ilova logini bölişi va u faol bölişi kerak)."
    "COMPANY_EXISTS" -> "Bunday nomli taksi kompaniyasi allaqaçon bor."
    "NAME_INVALID" -> "Nom juda qisqa."
    "ADDRESS_INVALID" -> "Manzil juda qisqa."
    "PHONE_INVALID" -> "Telefon raqami notöğri (9–15 raqam, + bilan boşlanişi mumkin)."
    "IMAGE_INVALID" -> "Rasm yaroqsiz (JPG, PNG yoki WebP, 3 MB gaça)."
    "TELEGRAM_ID_INVALID" -> "Telegram ID faqat raqamlardan iborat bölsin."
    "TELEGRAM_TAKEN" -> "Bu Telegram akkaunti allaqaçon boşqa restoranga ulangan (${f.detail ?: "?"})."
    "REMOVAL_BLOCKED" -> "Hozir olib bölmaydi: " + when (f.detail) {
        "OPEN_ORDERS" -> "tugallanmagan buyurtma bor (${f.count ?: "?"} ta)."
        "OPEN_REFUNDS" -> "hal qilinmagan qaytariş sörovi bor (${f.count ?: "?"} ta)."
        "OPEN_DISPATCHES" -> "taksi buyurtmasi tugamagan (${f.count ?: "?"} ta)."
        else -> "tugallanmagan iş bor."
    }
    "ORDER_INVALID" -> "Bu buyurtma raqami şu mijozniki emas yoki notöğri yozilgan."
    "ALREADY_STRUCK" -> "Bu buyurtma uçun strike allaqaçon berilgan."
    "REFERENCE_INVALID" -> "Bank ma’lumoti notöğri (4–64 belgi, raqam bölsin)."
    "REFERENCE_USED" -> "Bu bank ma’lumoti boşqa qaytarişga yozilgan. Har ötkazma bitta qaytarişni isbotlaydi."
    "NOT_POOL" -> "Bu pul restoranda: qaytarişni restoran yuboradi, siz emas."
    "NOTHING_TO_PAY" -> "Bu kun uçun berilişi kerak summa yöq."
    "ALREADY_PAID" -> "Bu kun uçun ötkazma allaqaçon belgilangan. Ekranni yangilang."
    "FUTURE_DAY" -> "Kelajak kuni uçun belgilab bölmaydi."
    "NOTHING_DUE" -> "Tölanişi kerak komissiya qolmagan."
    "DISH_INVALID" -> "Tanlangan taom şu restoranda topilmadi. Ekranni yangilang."
    "PROMO_NO_DISHES" -> "Avval aksiya taomlarini tanlang."
    "NUMBER_INVALID" -> "Son 1 dan 100 gaça bölsin."
    "BANNER_NO_IMAGE" -> "Avval slaydga rasm qöying."
    "KIND_INVALID" -> "Joyning turini tanlang."
    "OUT_OF_AREA" -> "Bu nuqta xarita hududidan taşqarida. Kenglik va uzunlik almaşib qolmadimi? Ziyovuddin uçun taxminan 40.03, 65.67."
    "LANDMARK_EXISTS" -> "Şu nomli joy yaqin atrofda (150 m içida) allaqaçon bor."
    "LANDMARK_LIMIT" -> "Joylar soni çegaraga yetdi (1000 ta)."
    "PERCENT_INVALID" ->"Foiz 1 dan 25 gaça bölsin (ikki xonagaça kasr)."
    else -> if (f.code in 500..599) "Server xatosi. Birozdan keyin qayta urinib köring." else "Bajarilmadi."
}

/**
 * Turns an answer into its data, or null after telling the administrator why not (a signed-out session sends the phone back to the sign-in
 * screen). Used by the screens that load or change data on demand.
 */
fun <T> unwrap(r: ApiResult<T>, say: (String) -> Unit): T? = when (r) {
    is ApiResult.Ok -> r.data
    is ApiResult.Unauthorized -> { AdminApp.instance.watcher.signOutLocally(); null }
    is ApiResult.Offline -> { say("Internet yöq. Qayta urinib köring."); null }
    is ApiResult.Locked -> { say("Biroz kuting."); null }
    is ApiResult.Failed -> { say(failText(r)); null }
}
