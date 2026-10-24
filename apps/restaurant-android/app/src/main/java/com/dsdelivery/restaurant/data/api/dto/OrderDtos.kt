package com.dsdelivery.restaurant.data.api.dto

import com.dsdelivery.restaurant.data.model.Order
import com.dsdelivery.restaurant.data.model.PaymentEvidence
import com.dsdelivery.restaurant.data.model.PrepInfo
import com.dsdelivery.restaurant.data.model.ServerClock
import com.dsdelivery.restaurant.data.model.parseIsoMillis
import com.dsdelivery.restaurant.data.model.RefundInfo
import com.dsdelivery.restaurant.data.model.OrderAction
import com.dsdelivery.restaurant.data.model.OrderItem
import com.dsdelivery.restaurant.data.model.OrderStatus
import com.dsdelivery.restaurant.data.model.OrdersPage
import com.dsdelivery.restaurant.data.model.PaymentStatus
import com.dsdelivery.restaurant.data.model.TaxiStage
import com.google.gson.annotations.SerializedName
import android.os.SystemClock
import java.time.Instant

// Stage 6C: GET /api/v1/restaurant/orders, GET /orders/{id}, POST /orders/{id}/{accept|reject|preparing|ready}

data class OrderItemDto(
    @SerializedName("name") val name: String,
    @SerializedName("unitSom") val unitSom: Int,
    @SerializedName("quantity") val quantity: Int,
    @SerializedName("subtotalSom") val subtotalSom: Int
)

data class OrderPaymentDto(
    @SerializedName("status") val status: String,
    @SerializedName("isTest") val isTest: Boolean? = null,
    @SerializedName("amountSom") val amountSom: Int? = null,
    @SerializedName("cardLast4") val cardLast4: String? = null
)

data class PaymentSignalDto(
    @SerializedName("source") val source: String? = null,
    @SerializedName("amountSom") val amountSom: Int? = null,
    @SerializedName("occurredAt") val occurredAt: String? = null,
    @SerializedName("trustedSender") val trustedSender: Boolean? = null,
    @SerializedName("amountMatches") val amountMatches: Boolean? = null
)

data class PaymentEvidenceDto(
    @SerializedName("expectedAmountSom") val expectedAmountSom: Int = 0,
    @SerializedName("status") val status: String = "",
    @SerializedName("isTest") val isTest: Boolean = false,
    @SerializedName("cardLast4") val cardLast4: String? = null,
    @SerializedName("assignedAt") val assignedAt: String? = null,
    @SerializedName("matchedAt") val matchedAt: String? = null,
    @SerializedName("verifiedAt") val verifiedAt: String? = null,
    @SerializedName("signal") val signal: PaymentSignalDto? = null,
    @SerializedName("notBankProof") val notBankProof: Boolean = true
)

data class PrepDto(
    @SerializedName("minutes") val minutes: Int? = null,
    @SerializedName("startedAt") val startedAt: String? = null,
    @SerializedName("estimatedReadyAt") val estimatedReadyAt: String? = null,
    @SerializedName("chosenMinutes") val chosenMinutes: Int? = null
)

data class MenuProblemDto(
    @SerializedName("kind") val kind: String = "",
    @SerializedName("name") val name: String = ""
)

data class RefundDto(
    @SerializedName("id") val id: String = "",
    @SerializedName("kind") val kind: String = "",
    @SerializedName("status") val status: String = "",
    @SerializedName("reasonCode") val reasonCode: String = "",
    @SerializedName("requestedBy") val requestedBy: String = "",
    @SerializedName("paidAmountSom") val paidAmountSom: Int = 0,
    @SerializedName("approvedAmountSom") val approvedAmountSom: Int? = null,
    @SerializedName("bankReference") val bankReference: String? = null,
    @SerializedName("hasReceipt") val hasReceipt: Boolean = false,
    @SerializedName("rejectReason") val rejectReason: String? = null
)

data class OrderTaxiDto(
    @SerializedName("status") val status: String,
    @SerializedName("stage") val stage: String? = null,
    @SerializedName("attemptNo") val attemptNo: Int? = null,
    @SerializedName("companyName") val companyName: String? = null,
    @SerializedName("acceptedAt") val acceptedAt: String? = null,
    @SerializedName("dispatchedAt") val dispatchedAt: String? = null,
    @SerializedName("deliveredAt") val deliveredAt: String? = null
)

data class OrderDto(
    @SerializedName("id") val id: String,
    @SerializedName("code") val code: String = "",
    @SerializedName("status") val status: String,
    @SerializedName("totalSom") val totalSom: Int,
    @SerializedName("createdAt") val createdAt: String,
    @SerializedName("estimatedPrepMinutes") val estimatedPrepMinutes: Int? = null,
    @SerializedName("items") val items: List<OrderItemDto>? = null,
    @SerializedName("payment") val payment: OrderPaymentDto? = null,
    @SerializedName("taxi") val taxi: OrderTaxiDto? = null,
    @SerializedName("taxiCompanyName") val taxiCompanyName: String? = null,
    @SerializedName("customerName") val customerName: String? = null,
    @SerializedName("customerPhone") val customerPhone: String? = null,
    @SerializedName("addressText") val addressText: String? = null,
    @SerializedName("isTest") val isTest: Boolean? = null,
    @SerializedName("rejectReason") val rejectReason: String? = null,
    @SerializedName("restaurantDeadlineAt") val restaurantDeadlineAt: String? = null,
    @SerializedName("allowedActions") val allowedActions: List<String>? = null,
    @SerializedName("awaitingPaymentVerification") val awaitingPaymentVerification: Boolean? = null,
    @SerializedName("defaultPrepMinutes") val defaultPrepMinutes: Int? = null,
    @SerializedName("paymentEvidence") val paymentEvidence: PaymentEvidenceDto? = null,
    @SerializedName("menuProblems") val menuProblems: List<MenuProblemDto>? = null,
    @SerializedName("refund") val refund: RefundDto? = null,
    @SerializedName("attention") val attention: List<String>? = null,
    @SerializedName("serverNow") val serverNow: String? = null,
    @SerializedName("prep") val prep: PrepDto? = null,
    @SerializedName("paymentVerifiedAt") val paymentVerifiedAt: String? = null,
    @SerializedName("readyAt") val readyAt: String? = null
)

data class OrderCountsDto(
    @SerializedName("incoming") val incoming: Int = 0,
    @SerializedName("inProgress") val inProgress: Int = 0,
    @SerializedName("ready") val ready: Int = 0,
    @SerializedName("attention") val attention: Int = 0
)

data class OrdersResponseDto(
    @SerializedName("orders") val orders: List<OrderDto> = emptyList(),
    @SerializedName("nextCursor") val nextCursor: String? = null,
    @SerializedName("counts") val counts: OrderCountsDto? = null
)

/** `expectedStatus` makes a stale tap fail with 409 instead of acting on a state the user did not see. */
data class AcceptOrderRequestDto(
    @SerializedName("prepMinutes") val prepMinutes: Int? = null,
    @SerializedName("expectedStatus") val expectedStatus: String? = null
)

data class RejectOrderRequestDto(
    @SerializedName("reason") val reason: String,
    @SerializedName("expectedStatus") val expectedStatus: String? = null
)

data class PreparingOrderRequestDto(
    @SerializedName("prepMinutes") val prepMinutes: Int? = null,
    @SerializedName("expectedStatus") val expectedStatus: String? = null
)

/** The explicit statement that the money is really on the restaurant's bank account. */
data class VerifyPaymentRequestDto(
    @SerializedName("confirmReceived") val confirmReceived: Boolean,
    @SerializedName("expectedStatus") val expectedStatus: String? = null
)

data class CancelOrderRequestDto(
    @SerializedName("reason") val reason: String,
    @SerializedName("expectedStatus") val expectedStatus: String? = null
)

data class RefundDecisionRequestDto(
    @SerializedName("rejectReason") val rejectReason: String? = null,
    @SerializedName("expectedStatus") val expectedStatus: String? = null
)

/** "Ready in N minutes" (5..60) chosen after the payment, while the food is already cooking. */
data class PrepTimeRequestDto(
    @SerializedName("minutes") val minutes: Int,
    @SerializedName("expectedStatus") val expectedStatus: String? = null
)

data class ReadyOrderRequestDto(
    @SerializedName("expectedStatus") val expectedStatus: String? = null
)

fun OrderDto.toDomain(): Order {
    return Order(
        id = id,
        code = code,
        status = OrderStatus.fromRaw(status),
        totalSom = totalSom,
        createdAt = createdAt,
        estimatedPrepMinutes = estimatedPrepMinutes,
        items = items?.map { it.toDomain() } ?: emptyList(),
        paymentStatus = payment?.status?.let { PaymentStatus.fromRaw(it) },
        customerPhone = customerPhone,
        customerName = customerName,
        rejectReason = rejectReason,
        addressText = addressText,
        isTest = isTest ?: false,
        paymentAmountSom = payment?.amountSom,
        paymentCardLast4 = payment?.cardLast4,
        taxiCompanyName = taxiCompanyName,
        taxiStatus = taxi?.status,
        taxiStage = TaxiStage.fromRaw(taxi?.stage),
        taxiAcceptedAt = taxi?.acceptedAt,
        taxiDispatchedAt = taxi?.dispatchedAt,
        taxiDeliveredAt = taxi?.deliveredAt,
        restaurantDeadlineAt = restaurantDeadlineAt,
        allowedActions = allowedActions.orEmpty().mapNotNull { OrderAction.fromRaw(it) }.toSet(),
        awaitingPaymentVerification = awaitingPaymentVerification ?: false,
        defaultPrepMinutes = defaultPrepMinutes,
        paymentEvidence = paymentEvidence?.let {
            PaymentEvidence(
                expectedAmountSom = it.expectedAmountSom, status = it.status, isTest = it.isTest,
                cardLast4 = it.cardLast4, assignedAt = it.assignedAt, matchedAt = it.matchedAt, verifiedAt = it.verifiedAt,
                signalSource = it.signal?.source, signalAmountSom = it.signal?.amountSom, signalAmountMatches = it.signal?.amountMatches,
                signalOccurredAt = it.signal?.occurredAt, signalTrusted = it.signal?.trustedSender, notBankProof = it.notBankProof
            )
        },
        menuProblems = menuProblems.orEmpty().map { it.name },
        refund = refund?.let {
            RefundInfo(it.id, it.kind, it.status, it.reasonCode, it.requestedBy, it.paidAmountSom, it.approvedAmountSom, it.bankReference, it.hasReceipt, it.rejectReason)
        },
        attention = attention.orEmpty(),
        clock = serverNow?.let { parseIsoMillis(it) }?.let { ServerClock(it, SystemClock.elapsedRealtime()) },
        createdAtMillis = parseIsoMillis(createdAt),
        verifiedAtMillis = parseIsoMillis(paymentVerifiedAt),
        readyAtMillis = parseIsoMillis(readyAt),
        prep = prep?.let { p ->
            // The server's own clock is the reference; the phone only contributes elapsed time since the response arrived.
            val serverNow = serverNow?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() }
            if (serverNow == null) null else PrepInfo(
                minutes = p.minutes ?: 0,
                startedAtMillis = p.startedAt?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() },
                estimatedReadyAtMillis = p.estimatedReadyAt?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() },
                serverNowMillis = serverNow,
                receivedAtElapsed = SystemClock.elapsedRealtime(),
                chosenMinutes = p.chosenMinutes
            )
        }
    )
}

fun OrdersResponseDto.toDomain(): OrdersPage = OrdersPage(
    orders = orders.map { it.toDomain() },
    nextCursor = nextCursor,
    incomingCount = counts?.incoming ?: 0,
    inProgressCount = counts?.inProgress ?: 0,
    readyCount = counts?.ready ?: 0,
    attentionCount = counts?.attention ?: 0
)

fun OrderItemDto.toDomain(): OrderItem {
    return OrderItem(
        name = name,
        unitSom = unitSom,
        quantity = quantity,
        subtotalSom = subtotalSom
    )
}
