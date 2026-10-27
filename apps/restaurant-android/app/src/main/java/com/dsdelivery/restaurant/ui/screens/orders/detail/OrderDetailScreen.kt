package com.dsdelivery.restaurant.ui.screens.orders.detail

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.AccessTime
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Receipt
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Restaurant
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.Checkbox
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import kotlinx.coroutines.withContext
import kotlinx.coroutines.launch
import kotlinx.coroutines.Dispatchers
import androidx.compose.ui.platform.LocalContext
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.mutableStateOf
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import com.dsdelivery.restaurant.data.model.CancelReason
import com.dsdelivery.restaurant.data.model.Order
import com.dsdelivery.restaurant.data.model.RefundRejectReason
import com.dsdelivery.restaurant.data.model.OrderAction
import com.dsdelivery.restaurant.data.model.RejectReason
import com.dsdelivery.restaurant.data.model.TaxiStage
import com.dsdelivery.restaurant.data.model.OrderStatus
import com.dsdelivery.restaurant.ui.components.ATTENTION_TEXT
import com.dsdelivery.restaurant.ui.components.ActionConfirmDialog
import com.dsdelivery.restaurant.ui.components.PaymentPill
import com.dsdelivery.restaurant.ui.components.rememberNowElapsed
import com.dsdelivery.restaurant.ui.components.taxiStageText
import androidx.compose.runtime.State
import com.dsdelivery.restaurant.data.model.PaymentStatus
import com.dsdelivery.restaurant.data.model.ageText
import com.dsdelivery.restaurant.data.model.display
import com.dsdelivery.restaurant.data.model.formatClock
import com.dsdelivery.restaurant.ui.components.ErrorView
import com.dsdelivery.restaurant.ui.components.LoadingView
import com.dsdelivery.restaurant.ui.components.OrderStatusBadge
import com.dsdelivery.restaurant.ui.components.PaymentStatusBadge
import com.dsdelivery.restaurant.ui.preview.SampleData
import com.dsdelivery.restaurant.ui.theme.BrandDark
import com.dsdelivery.restaurant.ui.theme.BrandMint
import com.dsdelivery.restaurant.ui.theme.BrandPrimary
import com.dsdelivery.restaurant.ui.theme.DSRestaurantTheme
import com.dsdelivery.restaurant.ui.theme.ErrorRed
import com.dsdelivery.restaurant.ui.theme.SuccessGreen
import com.dsdelivery.restaurant.ui.theme.WarningOrange
import android.os.SystemClock
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.setValue
import java.text.NumberFormat
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

@Composable
fun OrderDetailScreen(
    viewModel: OrderDetailViewModel,
    onNavigateBack: () -> Unit,
    modifier: Modifier = Modifier
) {
    val state by viewModel.uiState.collectAsState()

    // Another device or the taxi operator may have moved the order on while this screen was in the background.
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { viewModel.loadOrder() }

    OrderDetailContent(
        state = state,
        callbacks = viewModel,
        onNavigateBack = onNavigateBack,
        modifier = modifier
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OrderDetailContent(
    state: OrderDetailUiState,
    callbacks: OrderDetailCallbacks,
    onNavigateBack: () -> Unit,
    modifier: Modifier = Modifier
) {
    val scrollState = rememberScrollState()
    val order = state.order
    val nowElapsed = rememberNowElapsed(periodMs = if (order?.status == OrderStatus.PREPARING) 1000L else 30_000L)
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(state.actionMessage) {
        val message = state.actionMessage ?: return@LaunchedEffect
        snackbarHostState.showSnackbar(message)
        callbacks.dismissActionMessage()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = if (order != null) "Buyurtma ${order.orderNumberDisplay}" else "Buyurtma tafsiloti",
                        style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold)
                    )
                },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "Ortga",
                            tint = Color.White
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = BrandPrimary,
                    titleContentColor = Color.White,
                    navigationIconContentColor = Color.White
                )
            )
        },
        bottomBar = {
            // Sticky and always visible while the order is being cooked, so the kitchen never has to scroll for it.
            if (order != null && OrderAction.MARK_READY in order.allowedActions) {
                StickyReadyBar(order = order, nowElapsed = nowElapsed, busy = state.isSubmitting, onClick = { callbacks.showReadyConfirm(true) })
            }
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
        modifier = modifier
    ) { innerPadding ->
        when {
            state.isLoading && order == null -> {
                LoadingView(
                    message = "Yuklanmoqda...",
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(innerPadding)
                )
            }
            order == null -> {
                ErrorView(
                    message = state.errorMessage ?: "Buyurtma yuklanmadi.",
                    onRetry = callbacks::loadOrder,
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(innerPadding)
                )
            }
            else -> {
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(innerPadding)
                        .background(MaterialTheme.colorScheme.background)
                        .verticalScroll(scrollState)
                        .padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    SummaryCard(order, nowElapsed)
                    AttentionBanner(order)

                    // Operational actions: only what the server lists in allowedActions.
                    val busy = state.isSubmitting
                    val allowed = order.allowedActions
                    // After the payment: one tap that says the kitchen has seen the order (no preparation time is asked).
                    if (OrderAction.SET_PREP_TIME in allowed && order.needsPrepChoice) {
                        AcknowledgeCard(busy = busy, onConfirm = callbacks::acknowledgeOrder)
                    }
                    if (OrderAction.ACCEPT in allowed || OrderAction.REJECT in allowed) {
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            if (OrderAction.REJECT in allowed) {
                                OutlinedButton(
                                    onClick = { callbacks.showRejectDialog(true) },
                                    enabled = !busy,
                                    modifier = Modifier.weight(1f).height(48.dp),
                                    shape = RoundedCornerShape(10.dp),
                                    colors = ButtonDefaults.outlinedButtonColors(contentColor = ErrorRed)
                                ) {
                                    Icon(imageVector = Icons.Default.Close, contentDescription = null, modifier = Modifier.size(18.dp))
                                    Spacer(modifier = Modifier.width(6.dp))
                                    Text("Rad etish")
                                }
                            }
                            if (OrderAction.ACCEPT in allowed) {
                                ActionButton("Qabul qilish", Icons.Default.Check, !busy, Modifier.weight(1.3f)) { callbacks.showAcceptDialog(true) }
                            }
                        }
                    }
                    if (OrderAction.VERIFY_PAYMENT in allowed) {
                        ActionButton("To‘lovni tasdiqlash", Icons.Default.Check, !busy, Modifier.fillMaxWidth()) { callbacks.showVerifyDialog(true) }
                    }
                    if (OrderAction.START_PREPARING in allowed) {
                        ActionButton("Tayyorlashni boshlash", Icons.Default.Restaurant, !busy, Modifier.fillMaxWidth()) { callbacks.startPreparing() }
                    }
                    if (OrderAction.REFUND_APPROVE in allowed || OrderAction.REFUND_REJECT in allowed) {
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            if (OrderAction.REFUND_REJECT in allowed) {
                                OutlinedButton(
                                    onClick = { callbacks.showRefundRejectDialog(true) },
                                    enabled = !busy,
                                    modifier = Modifier.weight(1f).height(48.dp),
                                    shape = RoundedCornerShape(10.dp),
                                    colors = ButtonDefaults.outlinedButtonColors(contentColor = ErrorRed)
                                ) { Text("Rad etish") }
                            }
                            if (OrderAction.REFUND_APPROVE in allowed) {
                                ActionButton("Bekor qilishga rozi", Icons.Default.Check, !busy, Modifier.weight(1.4f)) { callbacks.showRefundApproveDialog(true) }
                            }
                        }
                    }
                    if (OrderAction.REFUND_SENT in allowed) {
                        ActionButton("Pul qaytarildi (chek yuklash)", Icons.Default.Receipt, !busy, Modifier.fillMaxWidth()) { callbacks.showRefundSentDialog(true) }
                    }
                    if (OrderAction.CANCEL_ORDER in allowed) {
                        OutlinedButton(
                            onClick = { callbacks.showCancelDialog(true) },
                            enabled = !busy,
                            modifier = Modifier.fillMaxWidth().height(44.dp),
                            shape = RoundedCornerShape(10.dp),
                            colors = ButtonDefaults.outlinedButtonColors(contentColor = ErrorRed)
                        ) { Text("Buyurtmani bekor qilish") }
                    }
                    if (busy) {
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                            CircularProgressIndicator(modifier = Modifier.size(24.dp), strokeWidth = 2.dp, color = BrandPrimary)
                        }
                    }

                    TimelineCard(order)

                    // Order Items Card
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
                    ) {
                        Column(modifier = Modifier.padding(16.dp)) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = "Taomlar",
                                    style = MaterialTheme.typography.titleSmall,
                                    fontWeight = FontWeight.SemiBold,
                                    color = MaterialTheme.colorScheme.onSurface
                                )
                                Text(
                                    text = "${order.itemsCount} ta mahsulot",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }

                            Spacer(modifier = Modifier.height(12.dp))

                            order.items.forEachIndexed { index, item ->
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.Top
                                ) {
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(
                                            text = item.name,
                                            style = MaterialTheme.typography.bodyMedium,
                                            fontWeight = FontWeight.Medium,
                                            color = MaterialTheme.colorScheme.onSurface
                                        )
                                        Text(
                                            text = "${item.quantity} x ${item.formattedUnit}",
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant
                                        )
                                    }
                                    Text(
                                        text = item.formattedSubtotal,
                                        style = MaterialTheme.typography.bodyMedium,
                                        fontWeight = FontWeight.SemiBold,
                                        color = MaterialTheme.colorScheme.onSurface
                                    )
                                }
                                if (index < order.items.size - 1) {
                                    HorizontalDivider(
                                        modifier = Modifier.padding(vertical = 10.dp),
                                        color = MaterialTheme.colorScheme.surfaceVariant
                                    )
                                }
                            }

                            HorizontalDivider(
                                modifier = Modifier.padding(vertical = 12.dp),
                                thickness = 1.5.dp,
                                color = MaterialTheme.colorScheme.surfaceVariant
                            )

                            // The platform's service share is inside the customer's payment: the lines above are the restaurant's own prices.
                            if (order.serviceFeeSom > 0) {
                                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                                    Text("Platforma xizmat haqi", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    Text(order.formattedServiceFee, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                                Spacer(modifier = Modifier.height(8.dp))
                            }

                            // Total Sum
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = "Jami",
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.Bold,
                                    color = MaterialTheme.colorScheme.onSurface
                                )
                                Text(
                                    text = order.formattedTotal,
                                    style = MaterialTheme.typography.titleLarge,
                                    fontWeight = FontWeight.Bold,
                                    color = BrandPrimary
                                )
                            }
                        }
                    }

                    CustomerCard(order)

                    PaymentEvidenceCard(order)
                    RefundCard(order)

                    Spacer(modifier = Modifier.height(16.dp))
                }
            }
        }

        // Accept: one yes/no question, no preparation time.
        if (state.showAcceptDialog && order != null) {
            AlertDialog(
                onDismissRequest = { callbacks.showAcceptDialog(false) },
                icon = { Icon(imageVector = Icons.Default.Check, contentDescription = null, tint = BrandPrimary, modifier = Modifier.size(32.dp)) },
                title = { Text("Qabul qilasizmi?", fontWeight = FontWeight.Bold) },
                confirmButton = {
                    Button(onClick = callbacks::confirmAccept, enabled = !state.isSubmitting, colors = ButtonDefaults.buttonColors(containerColor = BrandPrimary)) { Text("Qabul qilish") }
                },
                dismissButton = { TextButton(onClick = { callbacks.showAcceptDialog(false) }) { Text("Yopish") } },
                shape = RoundedCornerShape(16.dp)
            )
        }

        // Reject
        if (state.showRejectDialog) {
            AlertDialog(
                onDismissRequest = { callbacks.showRejectDialog(false) },
                icon = { Icon(imageVector = Icons.Default.Close, contentDescription = null, tint = ErrorRed, modifier = Modifier.size(32.dp)) },
                title = { Text("Rad etish sababi", fontWeight = FontWeight.Bold) },
                text = {
                    Column {
                        Spacer(modifier = Modifier.height(10.dp))
                        RejectReason.entries.forEach { reason ->
                            FilterChip(
                                selected = state.selectedRejectReason == reason,
                                onClick = { callbacks.onRejectReasonSelected(reason) },
                                label = { Text(reason.title) },
                                modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
                                colors = FilterChipDefaults.filterChipColors(selectedContainerColor = ErrorRed, selectedLabelColor = Color.White)
                            )
                        }
                    }
                },
                confirmButton = {
                    Button(onClick = callbacks::confirmReject, enabled = !state.isSubmitting, colors = ButtonDefaults.buttonColors(containerColor = ErrorRed)) { Text("Rad etish") }
                },
                dismissButton = { TextButton(onClick = { callbacks.showRejectDialog(false) }) { Text("Yopish") } },
                shape = RoundedCornerShape(16.dp)
            )
        }

        // Payment verification: the restaurant states that it has seen the money in its OWN bank account.
        if (state.showVerifyDialog && order != null) {
            val ev = order.paymentEvidence
            AlertDialog(
                onDismissRequest = { callbacks.showVerifyDialog(false) },
                icon = { Icon(imageVector = Icons.Default.Check, contentDescription = null, tint = BrandPrimary, modifier = Modifier.size(32.dp)) },
                title = { Text("To‘lovni tasdiqlash", fontWeight = FontWeight.Bold) },
                text = {
                    Column(modifier = Modifier.verticalScroll(rememberScrollState())) {
                        Text("${order.orderNumberDisplay} • ${som(ev?.expectedAmountSom ?: order.paymentAmountSom ?: order.totalSom)}", fontWeight = FontWeight.SemiBold)
                        if (ev?.isTest == true || order.isTest) {
                            Text("Sinov to‘lovi: haqiqiy pul emas.", color = WarningOrange, style = MaterialTheme.typography.bodyMedium)
                        } else {
                            Text("Pul kartangizga tushganini bankda tekshiring.", style = MaterialTheme.typography.bodyMedium)
                        }
                        Spacer(modifier = Modifier.height(8.dp))
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(checked = state.verifyChecked, onCheckedChange = callbacks::onVerifyChecked)
                            Text("Pul tushganini tekshirdim", style = MaterialTheme.typography.bodyLarge)
                        }
                    }
                },
                confirmButton = {
                    Button(
                        onClick = callbacks::confirmVerify,
                        enabled = state.verifyChecked && !state.isSubmitting,
                        colors = ButtonDefaults.buttonColors(containerColor = BrandPrimary)
                    ) { Text("Tasdiqlash") }
                },
                dismissButton = { TextButton(onClick = { callbacks.showVerifyDialog(false) }) { Text("Yopish") } },
                shape = RoundedCornerShape(16.dp)
            )
        }

        // Cancel an already paid order (then the restaurant refunds the money itself)
        if (state.showCancelDialog) {
            AlertDialog(
                onDismissRequest = { callbacks.showCancelDialog(false) },
                title = { Text("Buyurtmani bekor qilish", fontWeight = FontWeight.Bold) },
                text = {
                    Column {
                        Text("Pulni mijozga qaytarishingiz kerak bo‘ladi. Sabab:", style = MaterialTheme.typography.bodyMedium)
                        Spacer(modifier = Modifier.height(10.dp))
                        CancelReason.entries.forEach { reason ->
                            FilterChip(
                                selected = state.selectedCancelReason == reason,
                                onClick = { callbacks.onCancelReasonSelected(reason) },
                                label = { Text(reason.title) },
                                modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
                                colors = FilterChipDefaults.filterChipColors(selectedContainerColor = ErrorRed, selectedLabelColor = Color.White)
                            )
                        }
                    }
                },
                confirmButton = {
                    Button(onClick = callbacks::confirmCancel, enabled = !state.isSubmitting, colors = ButtonDefaults.buttonColors(containerColor = ErrorRed)) { Text("Buyurtmani bekor qilish") }
                },
                dismissButton = { TextButton(onClick = { callbacks.showCancelDialog(false) }) { Text("Yopish") } },
                shape = RoundedCornerShape(16.dp)
            )
        }

        if (state.showRefundApproveDialog) {
            ActionConfirmDialog(
                title = "Bekor qilishga rozimisiz?",
                message = "Pulni qaytarib, chekni yuklashingiz kerak bo‘ladi.",
                confirmText = "Rozi",
                onConfirm = callbacks::confirmRefundApprove,
                onDismiss = { callbacks.showRefundApproveDialog(false) }
            )
        }

        if (state.showRefundRejectDialog) {
            AlertDialog(
                onDismissRequest = { callbacks.showRefundRejectDialog(false) },
                title = { Text("Bekor qilishni rad etish", fontWeight = FontWeight.Bold) },
                text = {
                    Column {
                        Text("Sabab:", style = MaterialTheme.typography.bodyMedium)
                        Spacer(modifier = Modifier.height(10.dp))
                        RefundRejectReason.entries.forEach { reason ->
                            FilterChip(
                                selected = state.selectedRefundRejectReason == reason,
                                onClick = { callbacks.onRefundRejectReasonSelected(reason) },
                                label = { Text(reason.title) },
                                modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
                                colors = FilterChipDefaults.filterChipColors(selectedContainerColor = ErrorRed, selectedLabelColor = Color.White)
                            )
                        }
                    }
                },
                confirmButton = {
                    Button(onClick = callbacks::confirmRefundReject, enabled = !state.isSubmitting, colors = ButtonDefaults.buttonColors(containerColor = ErrorRed)) { Text("Rad etish") }
                },
                dismissButton = { TextButton(onClick = { callbacks.showRefundRejectDialog(false) }) { Text("Yopish") } },
                shape = RoundedCornerShape(16.dp)
            )
        }

        if (state.showRefundSentDialog) {
            RefundReceiptDialog(
                submitting = state.isSubmitting,
                onSend = callbacks::confirmRefundSent,
                onDismiss = { callbacks.showRefundSentDialog(false) }
            )
        }

        // Ready: the restaurant itself confirms the food is really ready (never automatic)
        if (state.showReadyConfirm) {
            ActionConfirmDialog(
                title = "Buyurtma tayyor",
                message = "Taksi operatoriga xabar yuboriladi.",
                confirmText = "Tayyor",
                confirmButtonColor = SuccessGreen,
                onConfirm = callbacks::confirmReady,
                onDismiss = { callbacks.showReadyConfirm(false) }
            )
        }

        // Action failure dialog (server message, e.g. the order was already changed from another device)
        if (state.actionNoticeText != null) {
            AlertDialog(
                onDismissRequest = callbacks::dismissActionNotice,
                icon = { Icon(imageVector = Icons.Default.Info, contentDescription = null, tint = BrandPrimary, modifier = Modifier.size(36.dp)) },
                title = { Text("Bajarilmadi", fontWeight = FontWeight.Bold) },
                text = { Text(text = state.actionNoticeText ?: "", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface) },
                confirmButton = {
                    Button(onClick = callbacks::dismissActionNotice, colors = ButtonDefaults.buttonColors(containerColor = BrandPrimary)) { Text("Yaxshi") }
                },
                shape = RoundedCornerShape(16.dp)
            )
        }
    }
}

private val ATTENTION_FULL = ATTENTION_TEXT

/** A paid order the kitchen has not seen yet: ONE tap, no question. (It used to ask "ready in N minutes"; nobody is told a time any more.) */
@Composable
private fun AcknowledgeCard(busy: Boolean, onConfirm: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = WarningOrange.copy(alpha = 0.10f))
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text("To‘lov qabul qilindi. Buyurtmani tayyorlashni boshlang.", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            Spacer(modifier = Modifier.height(10.dp))
            Button(
                onClick = onConfirm,
                enabled = !busy,
                shape = RoundedCornerShape(10.dp),
                colors = ButtonDefaults.buttonColors(containerColor = BrandPrimary),
                modifier = Modifier.fillMaxWidth().height(52.dp)
            ) {
                Text("Qabul qildim", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
            }
        }
    }
}

/** Everything the kitchen needs first: number, age, status, payment, total and the preparation clock. */
@Composable
private fun SummaryCard(order: Order, nowElapsed: State<Long>) {
    val cooking = order.status == OrderStatus.PREPARING
    Card(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(14.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Top) {
                Column {
                    Text(order.orderNumberDisplay, style = MaterialTheme.typography.displaySmall, fontWeight = FontWeight.ExtraBold)
                    Text(
                        listOfNotNull(order.createdAtMillis?.let { "Berilgan: ${formatClock(it)}" }, ageText(order.createdAtMillis, order.clock, nowElapsed.value)).joinToString(" • "),
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                OrderStatusBadge(status = order.status)
            }
            Spacer(modifier = Modifier.height(10.dp))
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                PaymentPill(order)
                Text(order.formattedTotal, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, color = BrandPrimary)
            }
            if (order.paymentMethod == "CASH") {
                Text(
                    if (order.paymentStatus == PaymentStatus.CASH_PENDING) "Naqd to‘lov: buyurtmani qabul qilsangiz, taksi haydovchisi restoranga ${som(order.cashDueSom ?: order.totalSom)} to‘laydi va mijozdan oladi."
                    else "Naqd to‘lov: taksi haydovchisi olib ketayotganda restoranga ${som(order.cashDueSom ?: order.totalSom)} to‘laydi.",
                    style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, color = BrandDark, modifier = Modifier.padding(top = 6.dp)
                )
            }
            Text("${order.itemsCount} ta mahsulot", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
            if (order.isTest) {
                Text("Sinov buyurtmasi", style = MaterialTheme.typography.bodySmall, color = ErrorRed, modifier = Modifier.padding(top = 4.dp))
            }
            if (!order.rejectReason.isNullOrBlank()) {
                Text("Rad etish sababi: ${RejectReason.entries.firstOrNull { it.code == order.rejectReason }?.title ?: order.rejectReason}", style = MaterialTheme.typography.bodySmall, color = ErrorRed, modifier = Modifier.padding(top = 4.dp))
            }
            // Ready: the time it was marked. (No preparation time or countdown is shown any more.)
            if (order.status == OrderStatus.READY || order.status == OrderStatus.COMPLETED) {
                HorizontalDivider(modifier = Modifier.padding(vertical = 10.dp), color = MaterialTheme.colorScheme.surfaceVariant)
                Text(
                    "Tayyor" + (order.readyAtMillis?.let { " • ${formatClock(it)}" } ?: ""),
                    style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = SuccessGreen
                )
            }
        }
    }
}

private enum class StepState { DONE, CURRENT, PENDING, FAILED }
private data class Step(val title: String, val state: StepState, val note: String? = null)

/** A short, linear picture of where the order is: placed -> paid -> cooking -> ready -> taxi -> delivered. */
@Composable
private fun TimelineCard(order: Order) {
    val s = order.status
    val ended = s in setOf(OrderStatus.RESTAURANT_REJECTED, OrderStatus.RESTAURANT_EXPIRED, OrderStatus.PAYMENT_EXPIRED, OrderStatus.CUSTOMER_CANCELLED, OrderStatus.CANCELLED, OrderStatus.FAILED)
    val paid = order.paymentStatus == PaymentStatus.CONFIRMED_MANUAL
    val cookedOrLater = s in setOf(OrderStatus.PREPARING, OrderStatus.READY, OrderStatus.COMPLETED, OrderStatus.TAXI_REQUESTED, OrderStatus.DRIVER_ASSIGNED, OrderStatus.DELIVERY_ASSUMED)
    val readyOrLater = s in setOf(OrderStatus.READY, OrderStatus.COMPLETED, OrderStatus.TAXI_REQUESTED, OrderStatus.DRIVER_ASSIGNED, OrderStatus.DELIVERY_ASSUMED) || order.readyAtMillis != null
    val steps = buildList {
        add(Step("Buyurtma berildi", StepState.DONE, order.createdAtMillis?.let { formatClock(it) }))
        add(
            when {
                ended && !paid -> Step("To‘lov", StepState.FAILED, order.paymentStatus?.title)
                paid || cookedOrLater -> Step("To‘langan", StepState.DONE, order.verifiedAtMillis?.let { formatClock(it) })
                order.paymentStatus == PaymentStatus.MATCHED_UNVERIFIED -> Step("To‘lov keldi", StepState.CURRENT, "tasdiqlanmoqda")
                else -> Step("To‘lov", StepState.CURRENT, order.paymentStatus?.title ?: "kutilmoqda")
            }
        )
        if (!ended || cookedOrLater) {
            add(Step("Tayyorlanmoqda", when { readyOrLater -> StepState.DONE; s == OrderStatus.PREPARING -> StepState.CURRENT; else -> StepState.PENDING }, order.prep?.startedAtMillis?.let { formatClock(it) }))
            add(Step("Tayyor", if (readyOrLater) StepState.DONE else StepState.PENDING, order.readyAtMillis?.let { formatClock(it) }))
            val stage = order.taxiStage
            add(
                Step(
                    "Taksi",
                    when (stage) {
                        TaxiStage.DISPATCHED, TaxiStage.DELIVERED -> StepState.DONE
                        TaxiStage.REQUESTED, TaxiStage.ACCEPTED, TaxiStage.SCHEDULED -> StepState.CURRENT
                        TaxiStage.NEEDS_HELP, TaxiStage.CANCELLED -> StepState.FAILED
                        null -> StepState.PENDING
                    },
                    stage?.let { taxiStageText(it) } ?: "o‘zi chaqiriladi"
                )
            )
            add(Step("Yetkazildi", if (s == OrderStatus.COMPLETED) StepState.DONE else StepState.PENDING, null))
        }
        if (ended) add(Step(s.title, StepState.FAILED, null))
    }
    Card(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text("Holati", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            Spacer(modifier = Modifier.height(8.dp))
            steps.forEach { step ->
                val color = when (step.state) {
                    StepState.DONE -> SuccessGreen
                    StepState.CURRENT -> BrandPrimary
                    StepState.FAILED -> ErrorRed
                    StepState.PENDING -> MaterialTheme.colorScheme.outline
                }
                Row(modifier = Modifier.padding(vertical = 4.dp), verticalAlignment = Alignment.Top) {
                    Box(modifier = Modifier.padding(top = 3.dp).size(14.dp), contentAlignment = Alignment.Center) {
                        when (step.state) {
                            StepState.DONE -> Icon(Icons.Default.Check, contentDescription = null, tint = color, modifier = Modifier.size(14.dp))
                            StepState.FAILED -> Icon(Icons.Default.Close, contentDescription = null, tint = color, modifier = Modifier.size(14.dp))
                            StepState.CURRENT -> Box(modifier = Modifier.size(10.dp).background(color, RoundedCornerShape(5.dp)))
                            StepState.PENDING -> Box(modifier = Modifier.size(8.dp).background(color.copy(alpha = 0.5f), RoundedCornerShape(4.dp)))
                        }
                    }
                    Spacer(modifier = Modifier.width(10.dp))
                    Column {
                        Text(step.title, style = MaterialTheme.typography.bodyMedium, fontWeight = if (step.state == StepState.CURRENT || step.state == StepState.FAILED) FontWeight.Bold else FontWeight.Normal, color = if (step.state == StepState.PENDING) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface)
                        step.note?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = if (step.state == StepState.FAILED) ErrorRed else MaterialTheme.colorScheme.onSurfaceVariant) }
                    }
                }
            }
        }
    }
}

@Composable
private fun CustomerCard(order: Order) {
    Card(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text("Mijoz", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            Spacer(modifier = Modifier.height(10.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.Person, contentDescription = null, tint = BrandPrimary, modifier = Modifier.size(18.dp))
                Spacer(modifier = Modifier.width(8.dp))
                Text(order.customerName ?: "Telegram mijoz", style = MaterialTheme.typography.bodyMedium)
            }
            Spacer(modifier = Modifier.height(6.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.Phone, contentDescription = null, tint = BrandPrimary, modifier = Modifier.size(18.dp))
                Spacer(modifier = Modifier.width(8.dp))
                Text(order.customerPhone ?: "Telefon raqami kiritilmagan", style = MaterialTheme.typography.bodyMedium)
            }
            Spacer(modifier = Modifier.height(6.dp))
            Row(verticalAlignment = Alignment.Top) {
                Icon(Icons.Default.LocationOn, contentDescription = null, tint = BrandPrimary, modifier = Modifier.size(18.dp))
                Spacer(modifier = Modifier.width(8.dp))
                Text(order.addressText ?: "Manzil ko‘rsatilmagan", style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}

/** Large, full-width, pinned to the bottom. While a request is in flight it is disabled and shows progress (no double submit). */
@Composable
private fun StickyReadyBar(order: Order, nowElapsed: State<Long>, busy: Boolean, onClick: () -> Unit) {
    Surface(color = MaterialTheme.colorScheme.surface, shadowElevation = 12.dp) {
        Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp)) {
            Button(
                onClick = onClick,
                enabled = !busy,
                modifier = Modifier.fillMaxWidth().height(60.dp),
                shape = RoundedCornerShape(14.dp),
                colors = ButtonDefaults.buttonColors(containerColor = SuccessGreen)
            ) {
                if (busy) {
                    CircularProgressIndicator(modifier = Modifier.size(24.dp), strokeWidth = 2.dp, color = Color.White)
                } else {
                    Icon(imageVector = Icons.Default.Check, contentDescription = null, modifier = Modifier.size(24.dp))
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Tayyor ${order.orderNumberDisplay}", fontSize = 20.sp, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

private fun som(amount: Int): String = "${NumberFormat.getNumberInstance(Locale("uz", "UZ")).format(amount)} so‘m"

@Composable
private fun ActionButton(
    text: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    enabled: Boolean,
    modifier: Modifier = Modifier,
    color: Color = BrandPrimary,
    onClick: () -> Unit
) {
    Button(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.height(48.dp),
        shape = RoundedCornerShape(10.dp),
        colors = ButtonDefaults.buttonColors(containerColor = color)
    ) {
        Icon(imageVector = icon, contentDescription = null, modifier = Modifier.size(18.dp))
        Spacer(modifier = Modifier.width(6.dp))
        Text(text, fontSize = 13.sp)
    }
}

/** Orders that automation cannot or must not decide are called out here instead of being hidden in a status. */
@Composable
private fun AttentionBanner(order: Order) {
    val lines = order.attention.mapNotNull { ATTENTION_TEXT[it] }
    if (lines.isEmpty()) return
    Surface(color = WarningOrange.copy(alpha = 0.14f), shape = RoundedCornerShape(10.dp), modifier = Modifier.fillMaxWidth()) {
        Row(modifier = Modifier.padding(12.dp), verticalAlignment = Alignment.Top) {
            Icon(imageVector = Icons.Default.Warning, contentDescription = null, tint = WarningOrange, modifier = Modifier.size(18.dp))
            Spacer(modifier = Modifier.width(8.dp))
            Column {
                lines.forEach { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface) }
            }
        }
    }
}

/** "Pul qaytarildi": the only proof asked for is ONE photo of the bank receipt. Nothing is typed. */
@Composable
private fun RefundReceiptDialog(submitting: Boolean, onSend: (ByteArray) -> Unit, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var photo by remember { mutableStateOf<ByteArray?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    var reading by remember { mutableStateOf(false) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) {
            reading = true
            scope.launch {
                val bytes = withContext(Dispatchers.IO) { ReceiptImage.compressToJpeg(context, uri) }
                reading = false
                if (bytes == null) problem = "Rasmni o‘qib bo‘lmadi. Boshqa rasm tanlang." else { photo = bytes; problem = null }
            }
        }
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Pul qaytarildi", fontWeight = FontWeight.Bold) },
        text = {
            Column {
                Text("Bank chekining rasmini yuklang.", style = MaterialTheme.typography.bodyMedium)
                Spacer(modifier = Modifier.height(12.dp))
                OutlinedButton(onClick = { picker.launch("image/*") }, enabled = !reading && !submitting, modifier = Modifier.fillMaxWidth()) {
                    Text(if (photo == null) "Chek rasmini tanlash" else "Boshqa rasm tanlash")
                }
                photo?.let { Text("Rasm tayyor (${it.size / 1024} KB)", style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 8.dp)) }
                if (reading) Text("Rasm tayyorlanmoqda...", style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 8.dp))
                problem?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = ErrorRed, modifier = Modifier.padding(top = 8.dp)) }
            }
        },
        confirmButton = {
            Button(
                onClick = { photo?.let(onSend) },
                enabled = photo != null && !reading && !submitting,
                colors = ButtonDefaults.buttonColors(containerColor = BrandPrimary)
            ) { Text("Yuborish") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Yopish") } },
        shape = RoundedCornerShape(16.dp)
    )
}

@Composable
private fun PaymentEvidenceCard(order: Order) {
    val ev = order.paymentEvidence ?: return
    if (ev.status != "MATCHED_UNVERIFIED" && ev.status != "CONFIRMED_MANUAL") return
    Card(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text("To‘lov", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurface)
            Spacer(modifier = Modifier.height(8.dp))
            Text(som(ev.expectedAmountSom) + (ev.cardLast4?.let { " • karta ***$it" } ?: ""), style = MaterialTheme.typography.bodyLarge)
            ev.matchedAt?.let { Text("Pul keldi: $it", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            ev.verifiedAt?.let { Text("Tasdiqlandi: $it", style = MaterialTheme.typography.bodyMedium, color = SuccessGreen) }
        }
    }
}

@Composable
private fun RefundCard(order: Order) {
    val r = order.refund ?: return
    Card(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text("Bekor qilish so‘rovi", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            Spacer(modifier = Modifier.height(6.dp))
            val statusText = when (r.status) {
                "REQUESTED" -> "Mijoz bekor qilmoqchi. Qaror kerak."
                "APPROVED" -> "Pulni qaytaring va chekni yuklang."
                "SENT" -> "Qaytarildi. Mijoz tasdig‘i kutilmoqda."
                "DISPUTED" -> "Mijoz pul kelmadi, deydi. Tekshirib, chekni qayta yuklang."
                "CONFIRMED" -> "Qaytarish tasdiqlandi."
                "REJECTED" -> "Rad etilgan"
                else -> r.status
            }
            Text(statusText, style = MaterialTheme.typography.bodyMedium)
            Text("To‘langan: ${som(r.paidAmountSom)}" + (r.approvedAmountSom?.let { " • qaytariladi: ${som(it)}" } ?: ""), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (r.hasReceipt) Text("Chek yuklangan", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            else r.bankReference?.let { Text("Chek raqami: $it", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
    }
}

/**
 * Real taxi progress from the backend: requested -> operator accepted -> taxi dispatched -> delivery completed.
 * Only the operator-confirmed last step means delivery; "needs help" is shown separately and never hides what was reached.
 */
@Composable
private fun TaxiProgressCard(order: Order) {
    val stage = order.taxiStage ?: return
    val reachedRequested = stage != TaxiStage.SCHEDULED
    val reachedAccepted = order.taxiAcceptedAt != null || stage == TaxiStage.ACCEPTED || stage == TaxiStage.DISPATCHED || stage == TaxiStage.DELIVERED
    val reachedDispatched = order.taxiDispatchedAt != null || stage == TaxiStage.DISPATCHED || stage == TaxiStage.DELIVERED
    val reachedDelivered = order.taxiDeliveredAt != null || stage == TaxiStage.DELIVERED
    val steps = listOf(
        Triple("Taksi so‘raldi", reachedRequested, if (stage == TaxiStage.SCHEDULED) "“Tayyor” bosilgach avtomatik yuboriladi" else null),
        Triple("Operator qabul qildi", reachedAccepted, null),
        Triple("Taksi yuborildi", reachedDispatched, null),
        Triple("Yetkazish tugallandi", reachedDelivered, if (reachedDelivered) "Taksi operatori tasdiqladi" else null)
    )
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(
                text = "Taksi holati" + (order.taxiCompanyName?.let { " • $it" } ?: ""),
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurface
            )
            Spacer(modifier = Modifier.height(10.dp))
            steps.forEach { (title, done, note) ->
                Row(verticalAlignment = Alignment.Top, modifier = Modifier.padding(vertical = 3.dp)) {
                    if (done) {
                        Icon(imageVector = Icons.Default.Check, contentDescription = null, tint = SuccessGreen, modifier = Modifier.size(18.dp))
                    } else {
                        Box(modifier = Modifier.size(18.dp), contentAlignment = Alignment.Center) {
                            Box(modifier = Modifier.size(8.dp).background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(4.dp)))
                        }
                    }
                    Spacer(modifier = Modifier.width(8.dp))
                    Column {
                        Text(
                            text = title,
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = if (done) FontWeight.SemiBold else FontWeight.Normal,
                            color = if (done) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        if (note != null) {
                            Text(text = note, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
            if (stage == TaxiStage.NEEDS_HELP) {
                Spacer(modifier = Modifier.height(8.dp))
                Surface(color = ErrorRed.copy(alpha = 0.1f), shape = RoundedCornerShape(8.dp), modifier = Modifier.fillMaxWidth()) {
                    Text(
                        text = "Taksi bo‘yicha yordam kerak: operator javob bermadi, rad etdi yoki holat noaniq. DS Delivery administratori taksi bosqichini ko‘rib chiqadi; restoran taksi chaqirishi shart emas.",
                        style = MaterialTheme.typography.bodySmall,
                        color = ErrorRed,
                        modifier = Modifier.padding(8.dp)
                    )
                }
            }
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun OrderDetailScreenPreview() {
    DSRestaurantTheme {
        OrderDetailContent(
            state = OrderDetailUiState(
                orderId = "order_1042",
                order = SampleData.sampleOrders.first()
            ),
            callbacks = object : OrderDetailCallbacks {},
            onNavigateBack = {}
        )
    }
}
