package com.dsdelivery.restaurant.ui.components

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
import com.dsdelivery.restaurant.data.model.OrderStatus
import com.dsdelivery.restaurant.data.model.PaymentStatus
import com.dsdelivery.restaurant.data.model.PrepInfo
import com.dsdelivery.restaurant.data.model.TaxiStage
import com.dsdelivery.restaurant.data.model.ageText
import com.dsdelivery.restaurant.data.model.display
import com.dsdelivery.restaurant.data.model.formatClock
import com.dsdelivery.restaurant.ui.theme.BrandDark
import com.dsdelivery.restaurant.ui.theme.BrandMint
import com.dsdelivery.restaurant.ui.theme.BrandPrimary
import com.dsdelivery.restaurant.ui.theme.ErrorRed
import com.dsdelivery.restaurant.ui.theme.SuccessGreen
import com.dsdelivery.restaurant.ui.theme.WarningOrange

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

/** The live preparation line. Reads the ticker State itself, so only this text recomposes every second. */
@Composable
fun LivePrepText(prep: PrepInfo, nowElapsed: State<Long>, modifier: Modifier = Modifier, large: Boolean = false) {
    val d = prep.display(nowElapsed.value) ?: return
    val color = if (d.overdue) ErrorRed else BrandPrimary
    Column(modifier = modifier) {
        Text(
            text = d.text,
            color = color,
            fontWeight = FontWeight.Bold,
            style = if (large) MaterialTheme.typography.titleLarge else MaterialTheme.typography.titleSmall
        )
        d.detail?.let { Text(text = it, color = if (d.overdue) ErrorRed else MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall) }
    }
}

@Composable
fun OrderCard(
    order: Order,
    nowElapsed: State<Long>,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    /** Quick "ready in N minutes" from the list; null hides the picker (previews). */
    onPrepTime: ((Int) -> Unit)? = null,
    prepBusy: Boolean = false
) {
    val cooking = order.status == OrderStatus.PREPARING
    // Computed once per tick only for cooking orders; the stripe is the fastest "which one needs me" cue in a long list.
    val prepNow = if (cooking) order.prep?.display(nowElapsed.value) else null
    val attention = attentionLine(order.attention)
    val stripe = when {
        prepNow?.overdue == true -> ErrorRed
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
                        Text(
                            text = listOfNotNull(at, age).joinToString(" • "),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    OrderStatusBadge(status = order.status)
                }
                Spacer(modifier = Modifier.height(8.dp))

                // 2. payment, always visible
                PaymentPill(order)

                // 3. exception, if any
                if (attention != null) {
                    Spacer(modifier = Modifier.height(8.dp))
                    Row(verticalAlignment = Alignment.Top) {
                        Icon(imageVector = Icons.Default.Warning, contentDescription = null, tint = WarningOrange, modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(attention, style = MaterialTheme.typography.bodySmall, color = WarningOrange, fontWeight = FontWeight.Medium)
                    }
                }

                // 4. preparation: live clock while cooking, the promised time otherwise
                if (cooking && order.prep != null) {
                    Spacer(modifier = Modifier.height(8.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(imageVector = Icons.Default.AccessTime, contentDescription = null, tint = if (prepNow?.overdue == true) ErrorRed else BrandPrimary, modifier = Modifier.size(18.dp))
                        Spacer(modifier = Modifier.width(6.dp))
                        LivePrepText(order.prep, nowElapsed)
                    }
                    // Paid and cooking, but nobody said yet when it will be ready: ask right here, in the list.
                    if (order.needsPrepChoice && onPrepTime != null) {
                        Spacer(modifier = Modifier.height(10.dp))
                        Surface(shape = RoundedCornerShape(10.dp), color = WarningOrange.copy(alpha = 0.10f)) {
                            Column(modifier = Modifier.padding(10.dp)) {
                                Text("To‘lov qabul qilindi. Tayyor bo‘lish vaqtini belgilang.", style = MaterialTheme.typography.bodySmall, color = WarningOrange, fontWeight = FontWeight.Medium)
                                Spacer(modifier = Modifier.height(8.dp))
                                PrepTimePicker(initial = DEFAULT_PREP_CHOICE, busy = prepBusy, onConfirm = onPrepTime)
                            }
                        }
                    }
                } else if (order.status == OrderStatus.READY) {
                    Spacer(modifier = Modifier.height(8.dp))
                    Text("Tayyor" + (order.readyAtMillis?.let { " • ${formatClock(it)}" } ?: ""), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, color = SuccessGreen)
                } else if (order.prep != null && order.prep.minutes > 0 && order.status in setOf(OrderStatus.PAYMENT_PENDING, OrderStatus.PAYMENT_MATCHED_UNVERIFIED, OrderStatus.PAYMENT_CONFIRMED)) {
                    Spacer(modifier = Modifier.height(6.dp))
                    Text("Tayyorlash vaqti: ${order.prep.minutes} daqiqa", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
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

                // 6. what and how much
                Spacer(modifier = Modifier.height(10.dp))
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    val itemsSummary = if (order.items.isNotEmpty()) order.items.joinToString(", ") { "${it.quantity}x ${it.name}" } else "${order.itemsCount} ta mahsulot"
                    Text(itemsSummary, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(order.formattedTotal, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = BrandPrimary)
                    Icon(imageVector = Icons.Default.ChevronRight, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(18.dp))
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
