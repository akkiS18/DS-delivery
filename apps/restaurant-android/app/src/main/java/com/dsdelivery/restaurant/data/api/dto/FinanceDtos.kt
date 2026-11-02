package com.dsdelivery.restaurant.data.api.dto

import com.dsdelivery.restaurant.data.model.FinanceCountSom
import com.dsdelivery.restaurant.data.model.FinancePayout
import com.dsdelivery.restaurant.data.model.FinanceRefundAmount
import com.dsdelivery.restaurant.data.model.FinanceSummary
import com.google.gson.annotations.SerializedName

// Stage 6B: GET /api/v1/restaurant/finance/summary
// Gson bypasses Kotlin null-safety, so every field is nullable and normalised in toDomain().

data class FinanceCountSomDto(
    @SerializedName("count") val count: Int? = null,
    @SerializedName("som") val som: Long? = null,
    @SerializedName("totalSom") val totalSom: Long? = null
)

data class FinanceRefundAmountDto(
    @SerializedName("count") val count: Int? = null,
    @SerializedName("amountTiyin") val amountTiyin: String? = null,
    @SerializedName("amountSom") val amountSom: Long? = null
)

data class FinanceOrdersDto(
    @SerializedName("completed") val completed: FinanceCountSomDto? = null,
    @SerializedName("cancelled") val cancelled: FinanceCountSomDto? = null,
    @SerializedName("inProgress") val inProgress: FinanceCountSomDto? = null
)

data class FinancePaymentsDto(
    @SerializedName("verifiedReceived") val verifiedReceived: FinanceCountSomDto? = null,
    @SerializedName("pendingUnverified") val pendingUnverified: FinanceCountSomDto? = null,
    @SerializedName("awaitingPayment") val awaitingPayment: FinanceCountSomDto? = null
)

data class FinanceRefundsPeriodDto(
    @SerializedName("requested") val requested: FinanceRefundAmountDto? = null,
    @SerializedName("approvedAwaitingSend") val approvedAwaitingSend: FinanceRefundAmountDto? = null,
    @SerializedName("sentUnconfirmed") val sentUnconfirmed: FinanceRefundAmountDto? = null,
    @SerializedName("confirmedByCustomer") val confirmedByCustomer: FinanceRefundAmountDto? = null,
    @SerializedName("confirmedByAdmin") val confirmedByAdmin: FinanceRefundAmountDto? = null,
    @SerializedName("disputed") val disputed: FinanceRefundAmountDto? = null,
    @SerializedName("rejected") val rejected: FinanceRefundAmountDto? = null
)

data class FinanceRefundsOpenNowDto(
    @SerializedName("total") val total: FinanceRefundAmountDto? = null
)

data class FinanceRefundsDto(
    @SerializedName("period") val period: FinanceRefundsPeriodDto? = null,
    @SerializedName("openNow") val openNow: FinanceRefundsOpenNowDto? = null,
    @SerializedName("bankVerified") val bankVerified: Boolean? = null
)

data class FinanceCommissionDto(
    @SerializedName("ruleCode") val ruleCode: String? = null,
    @SerializedName("currentFlatSom") val currentFlatSom: Long? = null,
    @SerializedName("accruedInPeriod") val accruedInPeriod: FinanceCountSomDto? = null,
    @SerializedName("outstandingLiability") val outstandingLiability: FinanceCountSomDto? = null,
    @SerializedName("settlementTracking") val settlementTracking: String? = null
)

data class FinanceUnresolvedDto(
    @SerializedName("refundsDisputed") val refundsDisputed: Int? = null,
    @SerializedName("completedOrdersWithoutCommission") val completedOrdersWithoutCommission: Int? = null,
    @SerializedName("commissionedOrdersWithRefund") val commissionedOrdersWithRefund: Int? = null
)

data class FinancePayoutPeriodDto(
    @SerializedName("orders") val orders: Int? = null,
    @SerializedName("collectedSom") val collectedSom: Long? = null,
    @SerializedName("commissionSom") val commissionSom: Long? = null,
    @SerializedName("refundsSom") val refundsSom: Long? = null,
    @SerializedName("payableSom") val payableSom: Long? = null
)

data class FinancePayoutUnpaidDto(
    @SerializedName("days") val days: Int? = null,
    @SerializedName("payableSom") val payableSom: Long? = null,
    @SerializedName("oldestDay") val oldestDay: String? = null,
    @SerializedName("windowDays") val windowDays: Int? = null
)

data class FinancePayoutInProgressDto(
    @SerializedName("orders") val orders: Int? = null,
    @SerializedName("amountSom") val amountSom: Long? = null
)

// What the platform owes the restaurant for money collected on the platform's own cards.
data class FinancePayoutDto(
    @SerializedName("collectsToPlatform") val collectsToPlatform: Boolean? = null,
    @SerializedName("shown") val shown: Boolean? = null,
    @SerializedName("period") val period: FinancePayoutPeriodDto? = null,
    @SerializedName("paidInPeriodSom") val paidInPeriodSom: Long? = null,
    @SerializedName("unpaid") val unpaid: FinancePayoutUnpaidDto? = null,
    @SerializedName("inProgress") val inProgress: FinancePayoutInProgressDto? = null
)

data class FinanceSummaryDto(
    @SerializedName("payout") val payout: FinancePayoutDto? = null,
    @SerializedName("currency") val currency: String? = null,
    @SerializedName("deliveryConfirmation") val deliveryConfirmation: String? = null,
    @SerializedName("orders") val orders: FinanceOrdersDto? = null,
    @SerializedName("payments") val payments: FinancePaymentsDto? = null,
    @SerializedName("refunds") val refunds: FinanceRefundsDto? = null,
    @SerializedName("commission") val commission: FinanceCommissionDto? = null,
    @SerializedName("unresolved") val unresolved: FinanceUnresolvedDto? = null
)

private fun FinanceCountSomDto?.toCountSom() = FinanceCountSom(
    count = this?.count ?: 0,
    som = this?.som ?: this?.totalSom ?: 0L
)

private fun FinanceRefundAmountDto?.toRefundAmount() = FinanceRefundAmount(
    count = this?.count ?: 0,
    amountSom = this?.amountSom ?: 0L
)

private fun FinancePayoutDto.toPayout(): FinancePayout = FinancePayout(
    collectsToPlatform = collectsToPlatform == true,
    shown = shown == true,
    orders = period?.orders ?: 0,
    collectedSom = period?.collectedSom ?: 0L,
    commissionSom = period?.commissionSom ?: 0L,
    refundsSom = period?.refundsSom ?: 0L,
    payableSom = period?.payableSom ?: 0L,
    paidInPeriodSom = paidInPeriodSom ?: 0L,
    unpaidDays = unpaid?.days ?: 0,
    unpaidSom = unpaid?.payableSom ?: 0L,
    unpaidOldestDay = unpaid?.oldestDay,
    unpaidWindowDays = unpaid?.windowDays ?: 31,
    inProgressOrders = inProgress?.orders ?: 0,
    inProgressSom = inProgress?.amountSom ?: 0L
)

fun FinanceSummaryDto.toDomain(): FinanceSummary {
    val period = refunds?.period
    return FinanceSummary(
        payout = payout?.toPayout(),
        deliveryConfirmationImplemented =
            deliveryConfirmation != null && deliveryConfirmation != "NOT_IMPLEMENTED",
        ordersCompleted = orders?.completed.toCountSom(),
        ordersCancelled = orders?.cancelled.toCountSom(),
        ordersInProgress = orders?.inProgress.toCountSom(),
        verifiedReceived = payments?.verifiedReceived.toCountSom(),
        pendingUnverified = payments?.pendingUnverified.toCountSom(),
        awaitingPayment = payments?.awaitingPayment.toCountSom(),
        refundsRequested = period?.requested.toRefundAmount(),
        refundsApprovedAwaitingSend = period?.approvedAwaitingSend.toRefundAmount(),
        refundsSentUnconfirmed = period?.sentUnconfirmed.toRefundAmount(),
        refundsConfirmedByCustomer = period?.confirmedByCustomer.toRefundAmount(),
        refundsConfirmedByAdmin = period?.confirmedByAdmin.toRefundAmount(),
        refundsDisputed = period?.disputed.toRefundAmount(),
        refundsRejected = period?.rejected.toRefundAmount(),
        refundsOpenNow = refunds?.openNow?.total.toRefundAmount(),
        refundsBankVerified = refunds?.bankVerified == true,
        commissionFlatSom = commission?.currentFlatSom,
        commissionAccruedInPeriod = commission?.accruedInPeriod.toCountSom(),
        commissionOutstanding = commission?.outstandingLiability.toCountSom(),
        settlementTrackingImplemented = commission?.settlementTracking != null &&
            commission.settlementTracking != "NOT_IMPLEMENTED",
        completedOrdersWithoutCommission = unresolved?.completedOrdersWithoutCommission ?: 0,
        commissionedOrdersWithRefund = unresolved?.commissionedOrdersWithRefund ?: 0,
        refundsDisputedOpen = unresolved?.refundsDisputed ?: 0
    )
}
