package com.dsdelivery.admin.ui

import com.dsdelivery.admin.AdminApp
import com.dsdelivery.admin.data.ApiResult

/** The Uzbek sentence for a refused call. Codes are the ones the backend (src/modules/admin-money) sends. */
fun failText(f: ApiResult.Failed): String = when (f.error) {
    "NOTE_INVALID" -> "Izoh 10–300 belgi bo‘lsin."
    "ACTION_INVALID" -> "Amal noto‘g‘ri."
    "CARD_NUMBER_INVALID" -> "Karta raqami noto‘g‘ri (16 xona, tekshiruv raqami mos kelmadi)."
    "HOLDER_INVALID" -> "Karta egasining ismi noto‘g‘ri."
    "CARD_TAKEN" -> "Bu karta tizimda allaqachon bor."
    "ALREADY_DECIDED" -> "Bu karta allaqachon hal qilingan. Ro‘yxatni yangilang."
    "NO_POOL_CARD" -> "Faol, tasdiqlangan platforma kartasi yo‘q. Avval karta qo‘shib, tasdiqlang."
    "OPEN_PAYMENTS" -> "Hozir to‘lanmagan ${f.count ?: "bir nechta"} ta karta to‘lovi bor. Ular tugagach (taxminan 10 daqiqa) qayta urining."
    "NOT_FOUND" -> "Topilmadi. Ro‘yxatni yangilang."
    "BLOCKED" -> "Yoqib bo‘lmadi: " + f.blockers.orEmpty().joinToString(" ") { "• $it" }
    "CHANGED" ->
        if (f.count == null && f.amountSom == null) "Holat o‘zgargan. Hech narsa qilinmadi. Ro‘yxatni yangilab, qayta tekshiring."
        else "Ma’lumot o‘zgargan (hozir ${f.count ?: 0} ta, ${somText(f.amountSom ?: 0)}). Hech narsa yozilmadi. Ro‘yxatni yangilab, qayta tekshiring."
    "ALREADY_CLAIMED" -> "Bu murojaatni allaqachon ${f.detail ?: "boshqa administrator"} oldi."
    "ALREADY_RESOLVED" -> "Murojaat allaqachon hal qilingan."
    "NOT_CLAIMED" -> "Avval «Men oldim» tugmasini bosing."
    "NOT_YOURS" -> "Bu murojaat ${f.detail ?: "boshqa administrator"} da. Faqat egasi boshqara oladi."
    "NOT_ACTIVE" -> "Murojaat jarayonda emas."
    "NOT_RESOLVED" -> "Murojaat hal qilinmagan."
    "SAME_ADMIN" -> "Murojaat allaqachon shu administratorda."
    "NOT_ALLOWED" -> "Murojaatni faqat egasi boshqaga o‘tkaza oladi (yoki siz o‘zingizga olishingiz mumkin)."
    "INVALID_TARGET" -> "Noto‘g‘ri administrator."
    "ALREADY_ACTIVE" -> "Bu buyurtma bo‘yicha #${f.detail ?: "?"} murojaat hali ochiq."
    "TEXT_INVALID" -> "Xabar 1–1000 belgi bo‘lsin."
    "NO_COMPANY" -> "Mos faol kompaniya topilmadi (kompaniyada ilova logini bo‘lishi va u faol bo‘lishi kerak)."
    "COMPANY_EXISTS" -> "Bunday nomli taksi kompaniyasi allaqachon bor."
    "NAME_INVALID" -> "Nom juda qisqa."
    "ADDRESS_INVALID" -> "Manzil juda qisqa."
    "PHONE_INVALID" -> "Telefon raqami noto‘g‘ri (9–15 raqam, + bilan boshlanishi mumkin)."
    "IMAGE_INVALID" -> "Rasm yaroqsiz (JPG, PNG yoki WebP, 3 MB gacha)."
    "TELEGRAM_ID_INVALID" -> "Telegram ID faqat raqamlardan iborat bo‘lsin."
    "TELEGRAM_TAKEN" -> "Bu Telegram akkaunti allaqachon boshqa restoranga ulangan (${f.detail ?: "?"})."
    "REMOVAL_BLOCKED" -> "Hozir olib bo‘lmaydi: " + when (f.detail) {
        "OPEN_ORDERS" -> "tugallanmagan buyurtma bor (${f.count ?: "?"} ta)."
        "OPEN_REFUNDS" -> "hal qilinmagan qaytarish so‘rovi bor (${f.count ?: "?"} ta)."
        "OPEN_DISPATCHES" -> "taksi buyurtmasi tugamagan (${f.count ?: "?"} ta)."
        else -> "tugallanmagan ish bor."
    }
    "NOTHING_DUE" -> "To‘lanishi kerak komissiya qolmagan."
    "PERCENT_INVALID" -> "Foiz 1 dan 25 gacha bo‘lsin (ikki xonagacha kasr)."
    else -> if (f.code in 500..599) "Server xatosi. Birozdan keyin qayta urinib ko‘ring." else "Bajarilmadi."
}

/**
 * Turns an answer into its data, or null after telling the administrator why not (a signed-out session sends the phone back to the sign-in
 * screen). Used by the screens that load or change data on demand.
 */
fun <T> unwrap(r: ApiResult<T>, say: (String) -> Unit): T? = when (r) {
    is ApiResult.Ok -> r.data
    is ApiResult.Unauthorized -> { AdminApp.instance.watcher.signOutLocally(); null }
    is ApiResult.Offline -> { say("Internet yo‘q. Qayta urinib ko‘ring."); null }
    is ApiResult.Locked -> { say("Biroz kuting."); null }
    is ApiResult.Failed -> { say(failText(r)); null }
}
