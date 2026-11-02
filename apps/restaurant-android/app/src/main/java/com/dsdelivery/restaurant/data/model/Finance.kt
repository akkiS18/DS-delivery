package com.dsdelivery.restaurant.data.model

import java.text.NumberFormat
import java.time.LocalDate
import java.time.ZoneId
import java.util.Locale

enum class FinanceDateFilter(val title: String) {
    TODAY("Bugun"),
    YESTERDAY("Kecha"),
    LAST_7_DAYS("Oxirgi 7 kun"),
    THIS_MONTH("Shu oy");

    /**
     * Inclusive day range (YYYY-MM-DD, Asia/Tashkent) for the Stage 6B `from`/`to` query
     * parameters. A date-only `to` includes that whole day.
     */
    fun dateRange(today: LocalDate = LocalDate.now(TASHKENT)): Pair<String, String> {
        val (from, to) = when (this) {
            TODAY -> today to today
            YESTERDAY -> today.minusDays(1) to today.minusDays(1)
            LAST_7_DAYS -> today.minusDays(6) to today
            THIS_MONTH -> today.withDayOfMonth(1) to today
        }
        return from.toString() to to.toString()
    }

    companion object {
        val TASHKENT: ZoneId = ZoneId.of("Asia/Tashkent")
    }
}

data class FinanceCountSom(val count: Int = 0, val som: Long = 0L)

data class FinanceRefundAmount(val count: Int = 0, val amountSom: Long = 0L)

/**
 * What the platform owes the restaurant for money customers paid onto the PLATFORM's cards (period figures follow the selected filter; the unpaid
 * balance looks back [unpaidWindowDays] days and ignores the filter). Backend values only.
 */
data class FinancePayout(
    val collectsToPlatform: Boolean = false,
    val shown: Boolean = false,
    val orders: Int = 0,
    val collectedSom: Long = 0L,
    val commissionSom: Long = 0L,
    val refundsSom: Long = 0L,
    val payableSom: Long = 0L,
    val paidInPeriodSom: Long = 0L,
    val unpaidDays: Int = 0,
    val unpaidSom: Long = 0L,
    val unpaidOldestDay: String? = null,
    val unpaidWindowDays: Int = 31,
    val inProgressOrders: Int = 0,
    val inProgressSom: Long = 0L
)

/** Mirrors GET /api/v1/restaurant/finance/summary (Stage 6B). Every amount is a backend value. */
data class FinanceSummary(
    /** Null when an older server does not send it. */
    val payout: FinancePayout? = null,
    val deliveryConfirmationImplemented: Boolean = false,
    val ordersCompleted: FinanceCountSom = FinanceCountSom(),
    val ordersCancelled: FinanceCountSom = FinanceCountSom(),
    val ordersInProgress: FinanceCountSom = FinanceCountSom(),
    val verifiedReceived: FinanceCountSom = FinanceCountSom(),
    val pendingUnverified: FinanceCountSom = FinanceCountSom(),
    val awaitingPayment: FinanceCountSom = FinanceCountSom(),
    val refundsRequested: FinanceRefundAmount = FinanceRefundAmount(),
    val refundsApprovedAwaitingSend: FinanceRefundAmount = FinanceRefundAmount(),
    val refundsSentUnconfirmed: FinanceRefundAmount = FinanceRefundAmount(),
    val refundsConfirmedByCustomer: FinanceRefundAmount = FinanceRefundAmount(),
    val refundsConfirmedByAdmin: FinanceRefundAmount = FinanceRefundAmount(),
    val refundsDisputed: FinanceRefundAmount = FinanceRefundAmount(),
    val refundsRejected: FinanceRefundAmount = FinanceRefundAmount(),
    val refundsOpenNow: FinanceRefundAmount = FinanceRefundAmount(),
    val refundsBankVerified: Boolean = false,
    /** Null when the backend flat-fee configuration is invalid; never defaulted client-side. */
    val commissionFlatSom: Long? = null,
    val commissionAccruedInPeriod: FinanceCountSom = FinanceCountSom(),
    val commissionOutstanding: FinanceCountSom = FinanceCountSom(),
    val settlementTrackingImplemented: Boolean = false,
    val completedOrdersWithoutCommission: Int = 0,
    val commissionedOrdersWithRefund: Int = 0,
    val refundsDisputedOpen: Int = 0
) {
    val refundsConfirmedCount: Int
        get() = refundsConfirmedByCustomer.count + refundsConfirmedByAdmin.count

    val refundsConfirmedSom: Long
        get() = refundsConfirmedByCustomer.amountSom + refundsConfirmedByAdmin.amountSom

    companion object {
        fun formatSom(amount: Long): String {
            val fmt = NumberFormat.getNumberInstance(Locale("uz", "UZ"))
            return "${fmt.format(amount)} so‘m"
        }
    }
}
