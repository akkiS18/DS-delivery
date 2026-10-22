package com.dsdelivery.restaurant.data.model

import java.text.NumberFormat
import java.util.Locale

enum class OrderStatus(val title: String, val isActionable: Boolean = false) {
    WAITING_RESTAURANT("Yangi buyurtma", isActionable = true),
    WAITING_CUSTOMER_CONSENT("Mijoz roziligi kutilmoqda"),
    CUSTOMER_CANCELLED("Mijoz bekor qilgan"),
    RESTAURANT_REJECTED("Rad etilgan"),
    RESTAURANT_EXPIRED("Vaqti o‘tgan"),
    PAYMENT_PENDING("To‘lov kutilmoqda"),
    PAYMENT_EXPIRED("To‘lov muddati o‘tgan"),
    PAYMENT_MATCHED_UNVERIFIED("To‘lov tekshiruvda"),
    PAYMENT_CONFIRMED("To‘lov tasdiqlangan", isActionable = true),
    ACCEPTED("Qabul qilingan", isActionable = true),
    PREPARING("Tayyorlanmoqda", isActionable = true),
    READY("Olib ketishga tayyor"),
    TAXI_REQUESTED("Yetkazish chaqirilgan"),
    DRIVER_ASSIGNED("Haydovchi biriktirildi"),
    DELIVERY_ASSUMED("Yetkazildi deb hisoblangan"),
    COMPLETED("Yakunlangan"),
    CANCELLATION_REQUESTED("Bekor qilish so‘ralgan"),
    CANCELLED("Bekor qilingan"),
    FAILED("Xatolik"),
    UNKNOWN("Noma'lum");

    companion object {
        fun fromRaw(raw: String?): OrderStatus {
            if (raw == null) return UNKNOWN
            return entries.firstOrNull { it.name.equals(raw, ignoreCase = true) } ?: UNKNOWN
        }
    }
}

// Payment.status is a free String in Prisma (not an enum); these are the values the backend writes.
enum class PaymentStatus(val title: String) {
    QUEUED("Navbatda"),
    AWAITING("To‘lov kutilmoqda"),
    MATCHED_UNVERIFIED("Tekshiruvda"),
    CONFIRMED_MANUAL("Tasdiqlangan"),
    EXPIRED("Muddati o‘tgan"),
    QUEUE_EXPIRED("Navbat muddati o‘tgan"),
    CANCELLED("Bekor qilingan"),
    UNKNOWN("Noma'lum");

    companion object {
        fun fromRaw(raw: String?): PaymentStatus {
            if (raw == null) return UNKNOWN
            return entries.firstOrNull { it.name.equals(raw, ignoreCase = true) } ?: UNKNOWN
        }
    }
}

/** Progress of the latest taxi dispatch, driven by the taxi operator bot. Only DELIVERED means delivery. */
enum class TaxiStage {
    SCHEDULED, REQUESTED, ACCEPTED, DISPATCHED, DELIVERED, NEEDS_HELP, CANCELLED;

    companion object {
        fun fromRaw(raw: String?): TaxiStage? = entries.firstOrNull { it.name == raw }
    }
}

/** Restaurant-side order actions exposed by the backend. The server decides which are currently allowed. */
enum class OrderAction {
    ACCEPT, REJECT, PROPOSE_PRICE, VERIFY_PAYMENT, START_PREPARING, MARK_READY, CANCEL_ORDER, REFUND_APPROVE, REFUND_REJECT, REFUND_SENT;

    companion object {
        fun fromRaw(raw: String?): OrderAction? = entries.firstOrNull { it.name == raw }
    }
}

/** One page of GET /orders plus the tab badge counters. */
data class OrdersPage(
    val orders: List<Order>,
    val nextCursor: Int?,
    val incomingCount: Int,
    val inProgressCount: Int,
    val readyCount: Int,
    /** Orders that need a human decision (unverified payment, cancellation request, taxi trouble, refund to send). */
    val attentionCount: Int = 0
)

/** Reasons the restaurant can give when it cancels an already paid order (the money must then be refunded). */
enum class CancelReason(val code: String, val title: String) {
    OUT_OF_STOCK("OUT_OF_STOCK", "Mahsulot tugagan"),
    CANNOT_FULFIL("CANNOT_FULFIL", "Bajara olmaymiz"),
    CLOSED("CLOSED", "Restoran yopiq"),
    OTHER("OTHER", "Boshqa sabab")
}

/** Reasons for rejecting a customer's cancellation / refund request. */
enum class RefundRejectReason(val code: String, val title: String) {
    MONEY_NOT_RECEIVED("MONEY_NOT_RECEIVED", "Pul kelmagan"),
    ALREADY_PREPARED("ALREADY_PREPARED", "Allaqachon tayyorlangan"),
    POLICY("POLICY", "Qoida bo‘yicha"),
    OTHER("OTHER", "Boshqa sabab")
}

/** What the restaurant checks before confirming real money. A mail signal is NOT proof of a bank credit. */
data class PaymentEvidence(
    val reference: Int,
    val expectedAmountSom: Int,
    val status: String,
    val isTest: Boolean,
    val cardLast4: String?,
    val assignedAt: String?,
    val matchedAt: String?,
    val verifiedAt: String?,
    val signalSource: String?,
    val signalAmountSom: Int?,
    val signalAmountMatches: Boolean?,
    val signalOccurredAt: String?,
    val signalTrusted: Boolean?,
    val notBankProof: Boolean
)

/**
 * Preparation clock from the SERVER. [serverNowMillis] is the server time when the response was built and
 * [receivedAtElapsed] the device's monotonic clock at that moment, so remaining time never depends on the phone's wall clock.
 */
data class PrepInfo(
    val minutes: Int,
    val startedAtMillis: Long?,
    val estimatedReadyAtMillis: Long?,
    val serverNowMillis: Long,
    val receivedAtElapsed: Long
) {
    /** Seconds left (positive) or overdue (negative) at [nowElapsed]; null when no ready time is known. */
    fun remainingSeconds(nowElapsed: Long): Long? {
        val ready = estimatedReadyAtMillis ?: return null
        val serverNow = serverNowMillis + (nowElapsed - receivedAtElapsed)
        val diff = ready - serverNow
        // ceil for the positive side so "0:01" shows until it really expires
        return if (diff >= 0) (diff + 999) / 1000 else -((-diff) / 1000)
    }
}

data class RefundInfo(
    val id: String,
    val number: Int,
    val kind: String,
    val status: String,
    val reasonCode: String,
    val requestedBy: String,
    val paidAmountSom: Int,
    val approvedAmountSom: Int?,
    val bankReference: String?,
    /** The restaurant attached a photo of the bank receipt (the only proof asked for a sent refund). */
    val hasReceipt: Boolean,
    val rejectReason: String?
)

/** Reject reasons accepted by the backend (Telegram uses the same codes). */
enum class RejectReason(val code: String, val title: String) {
    UNAVAILABLE("UNAVAILABLE", "Mahsulot tugagan"),
    PRICE_CHANGED("PRICE_CHANGED", "Narx o‘zgargan"),
    CLOSED("CLOSED", "Restoran yopiq"),
    OTHER("OTHER", "Boshqa sabab")
}

data class OrderItem(
    val name: String,
    val unitSom: Int,
    val quantity: Int,
    val subtotalSom: Int
) {
    val formattedSubtotal: String
        get() {
            val fmt = NumberFormat.getNumberInstance(Locale("uz", "UZ"))
            return "${fmt.format(subtotalSom)} so‘m"
        }

    val formattedUnit: String
        get() {
            val fmt = NumberFormat.getNumberInstance(Locale("uz", "UZ"))
            return "${fmt.format(unitSom)} so‘m"
        }
}

data class Order(
    val id: String,
    val number: Int,
    val status: OrderStatus,
    val totalSom: Int,
    val createdAt: String,
    val estimatedPrepMinutes: Int? = null,
    val items: List<OrderItem> = emptyList(),
    val paymentStatus: PaymentStatus? = null,
    val customerPhone: String? = null,
    val customerName: String? = null,
    val rejectReason: String? = null,
    val addressText: String? = null,
    val isTest: Boolean = false,
    val paymentAmountSom: Int? = null,
    val paymentCardLast4: String? = null,
    val taxiCompanyName: String? = null,
    val taxiStatus: String? = null,
    val taxiStage: TaxiStage? = null,
    val taxiAcceptedAt: String? = null,
    val taxiDispatchedAt: String? = null,
    val taxiDeliveredAt: String? = null,
    val restaurantDeadlineAt: String? = null,
    /** Server-decided; the app only shows buttons for actions listed here. */
    val allowedActions: Set<OrderAction> = emptySet(),
    /** The restaurant staff has not yet confirmed the bank credit (done here, in the app). */
    val awaitingPaymentVerification: Boolean = false,
    /** Restaurant default preparation time; pre-selected so the question is never asked twice. */
    val defaultPrepMinutes: Int? = null,
    val paymentEvidence: PaymentEvidence? = null,
    val prep: PrepInfo? = null,
    /** Server time at the moment of the response (for ages / timestamps); see ServerClock. */
    val clock: ServerClock? = null,
    val createdAtMillis: Long? = null,
    val verifiedAtMillis: Long? = null,
    val readyAtMillis: Long? = null,
    val menuProblems: List<String> = emptyList(),
    val refund: RefundInfo? = null,
    /** Exception states that need a human: VERIFY_PAYMENT, PRICE_CHANGED, AUTO_START_FAILED, TAXI_NEEDS_HELP, ... */
    val attention: List<String> = emptyList()
) {
    val formattedTotal: String
        get() {
            val fmt = NumberFormat.getNumberInstance(Locale("uz", "UZ"))
            return "${fmt.format(totalSom)} so‘m"
        }

    val orderNumberDisplay: String
        get() = "#$number"

    val itemsCount: Int
        get() = items.sumOf { it.quantity }
}
