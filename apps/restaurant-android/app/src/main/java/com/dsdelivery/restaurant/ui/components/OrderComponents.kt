package com.dsdelivery.restaurant.ui.components

import androidx.compose.material.icons.automirrored.filled.DirectionsWalk
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccessTime
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.LocalTaxi
import androidx.compose.material.icons.filled.CreditCard
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.dsdelivery.restaurant.data.model.Order
import com.dsdelivery.restaurant.data.model.OrderAction
import com.dsdelivery.restaurant.data.model.OrderStatus
import com.dsdelivery.restaurant.data.model.PaymentStatus
import com.dsdelivery.restaurant.data.model.PrepInfo
import com.dsdelivery.restaurant.data.model.TaxiStage
import com.dsdelivery.restaurant.data.model.Urgency
import com.dsdelivery.restaurant.data.model.ageMinutes
import com.dsdelivery.restaurant.data.model.ageText
import com.dsdelivery.restaurant.data.model.display
import com.dsdelivery.restaurant.data.model.formatClock
import com.dsdelivery.restaurant.data.model.urgencyOf
import com.dsdelivery.restaurant.ui.theme.BrandDark
import com.dsdelivery.restaurant.ui.theme.BrandMint
import com.dsdelivery.restaurant.ui.theme.BrandPrimary
import com.dsdelivery.restaurant.ui.theme.ErrorRed
import com.dsdelivery.restaurant.ui.theme.SuccessGreen
import com.dsdelivery.restaurant.ui.theme.WarningOrange
import java.text.NumberFormat
import java.util.Locale

@Composable
fun OrderStatusBadge(
    status: OrderStatus,
    modifier: Modifier = Modifier
) {
    val (bgColor, textColor) = when (status) {
        OrderStatus.WAITING_RESTAURANT -> Pair(BrandPrimary.copy(alpha = 0.15f), BrandPrimary)
        OrderStatus.PREPARING -> Pair(BrandMint.copy(alpha = 0.4f), BrandDark)
        OrderStatus.READY -> Pair(SuccessGreen.copy(alpha = 0.15f), SuccessGreen)
        OrderStatus.PAYMENT_PENDING,
        OrderStatus.WAITING_CUSTOMER_CONSENT -> Pair(WarningOrange.copy(alpha = 0.15f), WarningOrange)
        OrderStatus.PAYMENT_MATCHED_UNVERIFIED -> Pair(BrandMint.copy(alpha = 0.3f), BrandDark)
        OrderStatus.PAYMENT_CONFIRMED,
        OrderStatus.ACCEPTED -> Pair(BrandPrimary.copy(alpha = 0.12f), BrandPrimary)
        OrderStatus.COMPLETED -> Pair(BrandDark.copy(alpha = 0.1f), BrandDark)
        OrderStatus.RESTAURANT_REJECTED,
        OrderStatus.RESTAURANT_EXPIRED,
        OrderStatus.PAYMENT_EXPIRED,
        OrderStatus.CUSTOMER_CANCELLED,
        OrderStatus.CANCELLATION_REQUESTED,
        OrderStatus.CANCELLED,
        OrderStatus.FAILED -> Pair(ErrorRed.copy(alpha = 0.12f), ErrorRed)
        OrderStatus.TAXI_REQUESTED,
        OrderStatus.DRIVER_ASSIGNED,
        OrderStatus.DELIVERY_ASSUMED -> Pair(BrandPrimary.copy(alpha = 0.12f), BrandPrimary)
        OrderStatus.UNKNOWN -> Pair(Color.Gray.copy(alpha = 0.15f), Color.Gray)
    }

    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(8.dp),
        color = bgColor
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier
                    .size(6.dp)
                    .clip(CircleShape)
                    .background(textColor)
            )
            Spacer(modifier = Modifier.width(6.dp))
            Text(
                text = status.title,
                color = textColor,
                fontSize = 11.sp,
                fontWeight = FontWeight.SemiBold
            )
        }
    }
}

@Composable
fun PaymentStatusBadge(
    status: PaymentStatus?,
    modifier: Modifier = Modifier
) {
    if (status == null) return

    val (bgColor, textColor) = when (status) {
        PaymentStatus.CONFIRMED_MANUAL -> Pair(SuccessGreen.copy(alpha = 0.12f), SuccessGreen)
        PaymentStatus.QUEUED,
        PaymentStatus.AWAITING -> Pair(WarningOrange.copy(alpha = 0.12f), WarningOrange)
        PaymentStatus.MATCHED_UNVERIFIED -> Pair(BrandMint.copy(alpha = 0.35f), BrandDark)
        PaymentStatus.CASH_PENDING -> Pair(WarningOrange.copy(alpha = 0.12f), WarningOrange)
        PaymentStatus.CASH_ACCEPTED -> Pair(BrandMint.copy(alpha = 0.35f), BrandDark)
        PaymentStatus.CANCELLED,
        PaymentStatus.QUEUE_EXPIRED,
        PaymentStatus.EXPIRED -> Pair(ErrorRed.copy(alpha = 0.12f), ErrorRed)
        PaymentStatus.UNKNOWN -> Pair(Color.Gray.copy(alpha = 0.12f), Color.Gray)
    }

    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(6.dp),
        color = bgColor
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = Icons.Default.CreditCard,
                contentDescription = null,
                tint = textColor,
                modifier = Modifier.size(12.dp)
            )
            Spacer(modifier = Modifier.width(4.dp))
            Text(
                text = status.title,
                color = textColor,
                fontSize = 10.sp,
                fontWeight = FontWeight.Medium
            )
        }
    }
}

/** Payment state as a pill that is readable at arm's length (the small badge is kept for dense places). */
@Composable
fun PaymentPill(order: Order, modifier: Modifier = Modifier) {
    val status = order.paymentStatus ?: return
    val (bg, fg) = when (status) {
        PaymentStatus.CONFIRMED_MANUAL -> SuccessGreen.copy(alpha = 0.14f) to SuccessGreen
        PaymentStatus.QUEUED, PaymentStatus.AWAITING -> WarningOrange.copy(alpha = 0.14f) to WarningOrange
        PaymentStatus.MATCHED_UNVERIFIED -> BrandMint.copy(alpha = 0.45f) to BrandDark
        PaymentStatus.CASH_PENDING -> WarningOrange.copy(alpha = 0.14f) to WarningOrange
        PaymentStatus.CASH_ACCEPTED -> BrandMint.copy(alpha = 0.45f) to BrandDark
        PaymentStatus.CANCELLED, PaymentStatus.QUEUE_EXPIRED, PaymentStatus.EXPIRED -> ErrorRed.copy(alpha = 0.12f) to ErrorRed
        PaymentStatus.UNKNOWN -> Color.Gray.copy(alpha = 0.12f) to Color.Gray
    }
    Surface(modifier = modifier, shape = RoundedCornerShape(8.dp), color = bg) {
        Row(modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(imageVector = Icons.Default.CreditCard, contentDescription = null, tint = fg, modifier = Modifier.size(14.dp))
            Spacer(modifier = Modifier.width(5.dp))
            Text(text = status.title, color = fg, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}

/** Cash orders only: how much the taxi driver pays the restaurant at pickup (the driver collects it from the customer). */
@Composable
fun CashDueLine(order: Order, modifier: Modifier = Modifier) {
    val due = order.cashDueSom ?: return
    if (order.paymentMethod != "CASH") return
    val amount = NumberFormat.getNumberInstance(Locale("uz", "UZ")).format(due)
    Text(
        text = if (order.selfDelivery) "Mijozdan $amount so‘m naqd oling" else "Haydovchi restoranga $amount so‘m to‘laydi",
        modifier = modifier.padding(top = 6.dp),
        style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold, color = BrandDark
    )
}

/** The one-line, human reason an order needs attention (most important first). Shared by the list and the detail screen. */
fun attentionLine(codes: List<String>): String? = codes.firstNotNullOfOrNull { ATTENTION_TEXT[it] }
val ATTENTION_TEXT: Map<String, String> = mapOf(
    "VERIFY_PAYMENT" to "To‘lov hali tasdiqlanmadi. Tekshirib tasdiqlang.",
    "CANCELLATION_REQUESTED" to "Mijoz bekor qilmoqchi. Qaror kerak.",
    "REFUND_PENDING" to "Pulni qaytaring va chekni yuklang.",
    "AUTO_START_FAILED" to "Tayyorlash boshlanmadi. Qo‘lda boshlang.",
    "MENU_PROBLEM" to "Menyudagi taom mavjud emas.",
    "PRICE_CHANGED" to "Narx o‘zgargan. Buyurtmani rad eting.",
    "TAXI_NEEDS_HELP" to "Taksi muammosi. Administrator hal qiladi."
)

fun taxiStageText(stage: TaxiStage): String = when (stage) {
    TaxiStage.SCHEDULED -> "kutilmoqda"
    TaxiStage.REQUESTED -> "chaqirildi"
    TaxiStage.ACCEPTED -> "qabul qilindi"
    TaxiStage.DISPATCHED -> "yo‘lda"
    TaxiStage.DELIVERED -> "yetkazildi"
    TaxiStage.NEEDS_HELP -> "yordam kerak"
    TaxiStage.CANCELLED -> "bekor qilingan"
}

/** "Mijoz piyoda olib borishga rozi" / "O'zimiz yetkazamiz", with the address the restaurant would walk to. */
@Composable
fun WalkLine(order: Order, modifier: Modifier = Modifier) {
    if (!order.walkOk) return
    Surface(shape = RoundedCornerShape(8.dp), color = BrandMint.copy(alpha = 0.25f), modifier = modifier) {
        Column(modifier = Modifier.padding(horizontal = 8.dp, vertical = 6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(imageVector = Icons.AutoMirrored.Filled.DirectionsWalk, contentDescription = null, tint = BrandDark, modifier = Modifier.size(16.dp))
                Spacer(modifier = Modifier.width(6.dp))
                Text(
                    text = if (order.selfDelivery) "O‘zimiz yetkazamiz" else "Mijoz piyoda olib borishga rozi",
                    style = MaterialTheme.typography.bodySmall, color = BrandDark, fontWeight = FontWeight.SemiBold
                )
            }
            order.addressText?.takeIf { it.isNotBlank() }?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = BrandDark, modifier = Modifier.padding(top = 2.dp))
            }
        }
    }
}

/**
 * "Tayyor" for an order whose customer allowed walking delivery: the restaurant decides who brings it. Taxi is the default
 * outcome of closing the dialog without choosing: nothing is sent until one of the two buttons is tapped.
 */
@Composable
fun ReadyChoiceDialog(order: Order, onSelf: () -> Unit, onTaxi: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Buyurtma tayyor", style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold)) },
        text = {
            Column {
                Text("Mijoz uyi yaqin, piyoda olib borsangiz ham bo‘ladi, deb belgilagan. Kim yetkazadi?", style = MaterialTheme.typography.bodyMedium)
                order.addressText?.takeIf { it.isNotBlank() }?.let {
                    Spacer(modifier = Modifier.height(8.dp))
                    Text("Manzil: $it", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
                }
                Spacer(modifier = Modifier.height(6.dp))
                Text("“O‘zimiz yetkazamiz” bosilsa taksi chaqirilmaydi; yetkazgach “Yetkazildi” tugmasini bosasiz.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        },
        confirmButton = {
            Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = onSelf, colors = ButtonDefaults.buttonColors(containerColor = SuccessGreen)) { Text("O‘zimiz yetkazamiz") }
                Button(onClick = onTaxi, colors = ButtonDefaults.buttonColors(containerColor = BrandPrimary)) { Text("Taksi chaqirish") }
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Yopish") } },
        shape = RoundedCornerShape(16.dp)
    )
}

/**
 * The part of an order the kitchen reads first: every dish with its quantity (large, on a green panel) and the total sum underneath.
 * Shared by the list card; the detail screen has its own, longer version with unit prices.
 */
@Composable
fun OrderItemsAndTotal(order: Order) {
    Surface(shape = RoundedCornerShape(12.dp), color = BrandPrimary.copy(alpha = 0.10f), modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp)) {
            if (order.items.isEmpty()) {
                Text("${order.itemsCount} ta mahsulot", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)
            } else {
                order.items.forEachIndexed { index, item ->
                    if (index > 0) Spacer(modifier = Modifier.height(8.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Surface(shape = RoundedCornerShape(8.dp), color = BrandPrimary) {
                            Text(
                                text = "${item.quantity}×",
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.ExtraBold,
                                color = Color.White,
                                modifier = Modifier.padding(horizontal = 9.dp, vertical = 3.dp)
                            )
                        }
                        Spacer(modifier = Modifier.width(10.dp))
                        Text(
                            text = item.name,
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.onSurface,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f)
                        )
                    }
                }
            }
            Spacer(modifier = Modifier.height(10.dp))
            Box(modifier = Modifier.fillMaxWidth().height(1.dp).background(BrandPrimary.copy(alpha = 0.25f)))
            Spacer(modifier = Modifier.height(8.dp))
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text("Jami", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(order.formattedTotal, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.ExtraBold, color = BrandPrimary)
            }
        }
    }
}

@Composable
fun OrderCard(
    order: Order,
    nowElapsed: State<Long>,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    /** "Qabul qildim" from the list; null hides the button (previews). */
    onAcknowledge: (() -> Unit)? = null,
    prepBusy: Boolean = false,
    /** "Tayyor" from the list (the caller asks for confirmation); null hides the button. */
    onReady: (() -> Unit)? = null,
    readyBusy: Boolean = false,
    /** Walking delivery: "Yetkazildi" from the list (the caller asks for confirmation); null hides the button. */
    onSelfDelivered: (() -> Unit)? = null
) {
    val cooking = order.status == OrderStatus.PREPARING
    val attention = attentionLine(order.attention)
    val stripe = when {
        attention != null -> WarningOrange
        order.status == OrderStatus.READY -> SuccessGreen
        cooking -> BrandPrimary
        order.status == OrderStatus.COMPLETED -> BrandDark.copy(alpha = 0.4f)
        else -> BrandMint
    }
    Card(
        modifier = modifier.fillMaxWidth().clickable(onClick = onClick),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Row(modifier = Modifier.height(IntrinsicSize.Min)) {
            Box(modifier = Modifier.width(6.dp).fillMaxHeight().background(stripe))
            Column(modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp).weight(1f)) {
                // 1. number, age, status
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Top) {
                    Column {
                        Text(order.orderNumberDisplay, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.ExtraBold, color = MaterialTheme.colorScheme.onSurface)
                        val age = ageText(order.createdAtMillis, order.clock, nowElapsed.value)
                        val at = order.createdAtMillis?.let { formatClock(it) }
                        // An order that waits for the kitchen gets a stronger age line the longer it waits.
                        val waitingForKitchen = order.needsPrepChoice || attention != null
                        val urgency = if (waitingForKitchen) urgencyOf(ageMinutes(order.createdAtMillis, order.clock, nowElapsed.value)) else Urgency.CALM
                        Text(
                            text = listOfNotNull(at, age).joinToString(" • "),
                            style = MaterialTheme.typography.bodySmall,
                            fontWeight = if (urgency == Urgency.CALM) null else FontWeight.Bold,
                            color = when (urgency) {
                                Urgency.CALM -> MaterialTheme.colorScheme.onSurfaceVariant
                                Urgency.SOON -> WarningOrange
                                Urgency.LATE -> ErrorRed
                            }
                        )
                    }
                    OrderStatusBadge(status = order.status)
                }
                Spacer(modifier = Modifier.height(10.dp))

                // 1b. what to cook and how much it costs: the first thing the kitchen needs, so it is big and green
                OrderItemsAndTotal(order)
                Spacer(modifier = Modifier.height(10.dp))

                // 2. payment, always visible
                PaymentPill(order)
                CashDueLine(order)

                // 3. exception, if any
                if (attention != null) {
                    Spacer(modifier = Modifier.height(8.dp))
                    Row(verticalAlignment = Alignment.Top) {
                        Icon(imageVector = Icons.Default.Warning, contentDescription = null, tint = WarningOrange, modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(attention, style = MaterialTheme.typography.bodySmall, color = WarningOrange, fontWeight = FontWeight.Medium)
                    }
                }

                // 4. paid and not yet seen by the kitchen: one tap, no questions (this also silences the bell); no preparation time is asked or shown
                if (cooking && order.needsPrepChoice && onAcknowledge != null) {
                    Spacer(modifier = Modifier.height(10.dp))
                    Surface(shape = RoundedCornerShape(10.dp), color = WarningOrange.copy(alpha = 0.10f)) {
                        Column(modifier = Modifier.padding(10.dp)) {
                            Text("To‘lov qabul qilindi. Buyurtmani qabul qiling — shundan keyin mijoz uni bekor qila olmaydi. Tayyorlashni boshlang.", style = MaterialTheme.typography.bodySmall, color = WarningOrange, fontWeight = FontWeight.Medium)
                            Spacer(modifier = Modifier.height(8.dp))
                            Button(
                                onClick = onAcknowledge,
                                enabled = !prepBusy,
                                shape = RoundedCornerShape(10.dp),
                                colors = ButtonDefaults.buttonColors(containerColor = BrandPrimary),
                                modifier = Modifier.fillMaxWidth().height(48.dp)
                            ) {
                                Text("Qabul qildim", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
                            }
                        }
                    }
                } else if (order.status == OrderStatus.READY) {
                    Spacer(modifier = Modifier.height(8.dp))
                    Text("Tayyor" + (order.readyAtMillis?.let { " • ${formatClock(it)}" } ?: ""), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, color = SuccessGreen)
                }

                // 4b. walking delivery: who brings it, and where to
                if (order.walkOk && order.status in setOf(OrderStatus.PREPARING, OrderStatus.READY)) {
                    Spacer(modifier = Modifier.height(8.dp))
                    WalkLine(order)
                }

                // 5. taxi, visually separate from the food/payment state
                order.taxiStage?.let { stage ->
                    Spacer(modifier = Modifier.height(8.dp))
                    Surface(shape = RoundedCornerShape(8.dp), color = if (stage == TaxiStage.NEEDS_HELP) ErrorRed.copy(alpha = 0.10f) else BrandMint.copy(alpha = 0.25f)) {
                        Row(modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(imageVector = Icons.Default.LocalTaxi, contentDescription = null, tint = if (stage == TaxiStage.NEEDS_HELP) ErrorRed else BrandDark, modifier = Modifier.size(14.dp))
                            Spacer(modifier = Modifier.width(6.dp))
                            Text(
                                text = "Taksi: ${taxiStageText(stage)}" + (order.taxiCompanyName?.let { " • $it" } ?: ""),
                                style = MaterialTheme.typography.bodySmall, color = if (stage == TaxiStage.NEEDS_HELP) ErrorRed else BrandDark, fontWeight = FontWeight.Medium,
                                maxLines = 1, overflow = TextOverflow.Ellipsis
                            )
                        }
                    }
                }

                // 7. the one next step, right here: cooked and the time is chosen -> "Tayyor"
                if (onReady != null && cooking && !order.needsPrepChoice && OrderAction.MARK_READY in order.allowedActions) {
                    Spacer(modifier = Modifier.height(12.dp))
                    Button(
                        onClick = onReady,
                        enabled = !readyBusy,
                        shape = RoundedCornerShape(10.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = SuccessGreen),
                        modifier = Modifier.fillMaxWidth().height(52.dp)
                    ) {
                        Text("Tayyor", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
                    }
                }

                // 8. walking delivery: nobody else can confirm it, so the restaurant does
                if (onSelfDelivered != null && OrderAction.SELF_DELIVERED in order.allowedActions) {
                    Spacer(modifier = Modifier.height(12.dp))
                    Button(
                        onClick = onSelfDelivered,
                        enabled = !readyBusy,
                        shape = RoundedCornerShape(10.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = SuccessGreen),
                        modifier = Modifier.fillMaxWidth().height(52.dp)
                    ) {
                        Text("Yetkazildi", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
                    }
                }
            }
        }
    }
}

@Composable
fun ActionConfirmDialog(
    title: String,
    message: String,
    confirmText: String = "Tasdiqlash",
    cancelText: String = "Yopish",
    confirmButtonColor: Color = BrandPrimary,
    warningNote: String? = null,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text(
                text = title,
                style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold)
            )
        },
        text = {
            Column {
                Text(
                    text = message,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurface
                )
                if (warningNote != null) {
                    Spacer(modifier = Modifier.height(10.dp))
                    Surface(
                        color = WarningOrange.copy(alpha = 0.12f),
                        shape = RoundedCornerShape(8.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Row(
                            modifier = Modifier.padding(8.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(
                                imageVector = Icons.Default.Warning,
                                contentDescription = null,
                                tint = WarningOrange,
                                modifier = Modifier.size(16.dp)
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(
                                text = warningNote,
                                style = MaterialTheme.typography.bodySmall,
                                fontSize = 11.sp,
                                color = BrandDark
                            )
                        }
                    }
                }
            }
        },
        confirmButton = {
            Button(
                onClick = onConfirm,
                colors = ButtonDefaults.buttonColors(containerColor = confirmButtonColor)
            ) {
                Text(confirmText)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text(cancelText)
            }
        },
        shape = RoundedCornerShape(16.dp)
    )
}
