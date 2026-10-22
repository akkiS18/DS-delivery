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
import com.dsdelivery.restaurant.ui.components.LivePrepText
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
                    message = "Buyurtma ma'lumotlari yuklanmoqda...",
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(innerPadding)
                )
            }
            order == null -> {
                ErrorView(
                    message = state.errorMessage ?: "Buyurtma topilmadi yoki yuklashda xatolik yuz berdi.",
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
                    PriceProposalBanner(order)

                    // Operational actions: only what the server lists in allowedActions.
                    val busy = state.isSubmitting
                    val allowed = order.allowedActions
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
                                ActionButton("Bekor qilishni qabul qilish", Icons.Default.Check, !busy, Modifier.weight(1.4f)) { callbacks.showRefundApproveDialog(true) }
                            }
                        }
                    }
                    if (OrderAction.REFUND_SENT in allowed) {
                        ActionButton("Pul qaytarildi — ma’lumotnomani kiritish", Icons.Default.Receipt, !busy, Modifier.fillMaxWidth()) { callbacks.showRefundSentDialog(true) }
                    }
                    if (OrderAction.CANCEL_ORDER in allowed) {
                        OutlinedButton(
                            onClick = { callbacks.showCancelDialog(true) },
                            enabled = !busy,
                            modifier = Modifier.fillMaxWidth().height(44.dp),
                            shape = RoundedCornerShape(10.dp),
                            colors = ButtonDefaults.outlinedButtonColors(contentColor = ErrorRed)
                        ) { Text("Buyurtmani bekor qilish / pulni qaytarish") }
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
                                    text = "Buyurtma tarkibi",
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

                            // Total Sum
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = "Jami summa:",
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

                    // Taxi progress (automatic dispatch; the restaurant never requests a taxi)
                    if (order.taxiStage != null) {
                        TaxiProgressCard(order)
                    }

                    Spacer(modifier = Modifier.height(16.dp))
                }
            }
        }

        val defaultPrep = order?.defaultPrepMinutes ?: 25

        // Accept: ONE question. The restaurant default is applied; changing it is optional.
        if (state.showAcceptDialog && order != null) {
            val minutes = state.prepOverride ?: defaultPrep
            AlertDialog(
                onDismissRequest = { callbacks.showAcceptDialog(false) },
                icon = { Icon(imageVector = Icons.Default.AccessTime, contentDescription = null, tint = BrandPrimary, modifier = Modifier.size(32.dp)) },
                title = { Text("Buyurtmani qabul qilish", fontWeight = FontWeight.Bold) },
                text = {
                    Column {
                        Text("Mijozga to‘lov rekvizitlari yuboriladi. Tayyorlash vaqti restoran sozlamasidan olinadi:", style = MaterialTheme.typography.bodyMedium)
                        Spacer(modifier = Modifier.height(12.dp))
                        Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                            IconButton(onClick = { callbacks.onPrepOverride(minutes - 5) }) { Icon(Icons.Default.Remove, contentDescription = "Kamaytirish") }
                            Text("$minutes daqiqa", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = BrandPrimary)
                            IconButton(onClick = { callbacks.onPrepOverride(minutes + 5) }) { Icon(Icons.Default.Add, contentDescription = "Ko‘paytirish") }
                        }
                        if (state.prepOverride != null) {
                            TextButton(onClick = { callbacks.onPrepOverride(null) }) { Text("Sozlamadagi vaqtga qaytish ($defaultPrep daq)") }
                        }
                    }
                },
                confirmButton = {
                    Button(onClick = callbacks::confirmAccept, enabled = !state.isSubmitting, colors = ButtonDefaults.buttonColors(containerColor = BrandPrimary)) { Text("Qabul qilish") }
                },
                dismissButton = { TextButton(onClick = { callbacks.showAcceptDialog(false) }) { Text("Bekor qilish") } },
                shape = RoundedCornerShape(16.dp)
            )
        }

        // Reject
        if (state.showRejectDialog) {
            AlertDialog(
                onDismissRequest = { callbacks.showRejectDialog(false) },
                icon = { Icon(imageVector = Icons.Default.Close, contentDescription = null, tint = ErrorRed, modifier = Modifier.size(32.dp)) },
                title = { Text("Buyurtmani rad etish", fontWeight = FontWeight.Bold) },
                text = {
                    Column {
                        Text("Rad etish sababini tanlang. Mijozga buyurtma qabul qilinmagani haqida xabar yuboriladi; to‘lov ochilmaydi.", style = MaterialTheme.typography.bodyMedium)
                        Spacer(modifier = Modifier.height(10.dp))
                        RejectReason.entries.forEach { reason ->
                            FilterChip(
                                selected = state.selectedRejectReason == reason,
                                onClick = { callbacks.onRejectReasonSelected(reason) },
                                label = { Text(reason.title, fontSize = 12.sp) },
                                modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
                                colors = FilterChipDefaults.filterChipColors(selectedContainerColor = ErrorRed, selectedLabelColor = Color.White)
                            )
                        }
                    }
                },
                confirmButton = {
                    Button(onClick = callbacks::confirmReject, enabled = !state.isSubmitting, colors = ButtonDefaults.buttonColors(containerColor = ErrorRed)) { Text("Rad etishni tasdiqlash") }
                },
                dismissButton = { TextButton(onClick = { callbacks.showRejectDialog(false) }) { Text("Bekor qilish") } },
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
                        Text("Buyurtma ${order.orderNumberDisplay}", fontWeight = FontWeight.SemiBold)
                        Text("Kutilgan summa: ${som(ev?.expectedAmountSom ?: order.paymentAmountSom ?: order.totalSom)}", style = MaterialTheme.typography.bodyMedium)
                        if (ev != null) {
                            Text("To‘lov raqami: #${ev.reference}" + (ev.cardLast4?.let { " • karta ***$it" } ?: ""), style = MaterialTheme.typography.bodySmall)
                            ev.signalSource?.let {
                                Text(
                                    "Xabar manbasi: $it" + (ev.signalAmountSom?.let { a -> " • ${som(a)}" } ?: "") +
                                        (if (ev.signalAmountMatches == false) " • SUMMA MOS EMAS" else ""),
                                    style = MaterialTheme.typography.bodySmall
                                )
                                ev.signalOccurredAt?.let { t -> Text("Xabar vaqti: $t", style = MaterialTheme.typography.bodySmall) }
                            }
                        }
                        Spacer(modifier = Modifier.height(8.dp))
                        if (ev?.isTest == true || order.isTest) {
                            Text("Sinov (MOCK) to‘lov — haqiqiy pul emas.", color = WarningOrange, style = MaterialTheme.typography.bodySmall)
                        } else {
                            Surface(color = WarningOrange.copy(alpha = 0.12f), shape = RoundedCornerShape(8.dp)) {
                                Text(
                                    "E-pochta xabari faqat signal: bu bank tasdig‘i emas. Pul restoran bank hisobiga HAQIQATAN tushganini o‘zingiz tekshiring. Skrinshot yoki xabar yetarli emas.",
                                    style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(8.dp)
                                )
                            }
                        }
                        Spacer(modifier = Modifier.height(8.dp))
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(checked = state.verifyChecked, onCheckedChange = callbacks::onVerifyChecked)
                            Text("Pul bank hisobimizga tushganini o‘zim tekshirdim", style = MaterialTheme.typography.bodyMedium)
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
                dismissButton = { TextButton(onClick = { callbacks.showVerifyDialog(false) }) { Text("Bekor qilish") } },
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
                        Text("To‘langan buyurtma bekor qilinadi. Pulni o‘z hisobingizdan mijozga qaytarishingiz va bank ma’lumotnomasini kiritishingiz kerak. Taksi so‘rovi to‘xtatiladi.", style = MaterialTheme.typography.bodyMedium)
                        Spacer(modifier = Modifier.height(10.dp))
                        CancelReason.entries.forEach { reason ->
                            FilterChip(
                                selected = state.selectedCancelReason == reason,
                                onClick = { callbacks.onCancelReasonSelected(reason) },
                                label = { Text(reason.title, fontSize = 12.sp) },
                                modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
                                colors = FilterChipDefaults.filterChipColors(selectedContainerColor = ErrorRed, selectedLabelColor = Color.White)
                            )
                        }
                    }
                },
                confirmButton = {
                    Button(onClick = callbacks::confirmCancel, enabled = !state.isSubmitting, colors = ButtonDefaults.buttonColors(containerColor = ErrorRed)) { Text("Bekor qilish") }
                },
                dismissButton = { TextButton(onClick = { callbacks.showCancelDialog(false) }) { Text("Ortga") } },
                shape = RoundedCornerShape(16.dp)
            )
        }

        if (state.showRefundApproveDialog) {
            ActionConfirmDialog(
                title = "Bekor qilishni qabul qilish",
                message = "Buyurtma bekor qilinadi. Pulni o‘z hisobingizdan qaytarib, bank ma’lumotnomasini kiritishingiz kerak bo‘ladi.",
                confirmText = "Qabul qilish",
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
                        Text("Buyurtma davom etadi. Rad etish sababi:", style = MaterialTheme.typography.bodyMedium)
                        Spacer(modifier = Modifier.height(10.dp))
                        RefundRejectReason.entries.forEach { reason ->
                            FilterChip(
                                selected = state.selectedRefundRejectReason == reason,
                                onClick = { callbacks.onRefundRejectReasonSelected(reason) },
                                label = { Text(reason.title, fontSize = 12.sp) },
                                modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
                                colors = FilterChipDefaults.filterChipColors(selectedContainerColor = ErrorRed, selectedLabelColor = Color.White)
                            )
                        }
                    }
                },
                confirmButton = {
                    Button(onClick = callbacks::confirmRefundReject, enabled = !state.isSubmitting, colors = ButtonDefaults.buttonColors(containerColor = ErrorRed)) { Text("Rad etish") }
                },
                dismissButton = { TextButton(onClick = { callbacks.showRefundRejectDialog(false) }) { Text("Ortga") } },
                shape = RoundedCornerShape(16.dp)
            )
        }

        if (state.showRefundSentDialog) {
            AlertDialog(
                onDismissRequest = { callbacks.showRefundSentDialog(false) },
                title = { Text("Pul qaytarildi", fontWeight = FontWeight.Bold) },
                text = {
                    Column {
                        Text("Bank o‘tkazmasining ma’lumotnoma (reference) raqamini kiriting. Bu sizning bayonotingiz: to‘liq tasdiq mijoz yoki administrator tomonidan qilinadi.", style = MaterialTheme.typography.bodySmall)
                        Spacer(modifier = Modifier.height(8.dp))
                        OutlinedTextField(
                            value = state.bankReference,
                            onValueChange = callbacks::onBankReferenceChange,
                            label = { Text("Ma’lumotnoma raqami") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth()
                        )
                    }
                },
                confirmButton = {
                    Button(
                        onClick = callbacks::confirmRefundSent,
                        enabled = state.bankReference.trim().length >= 4 && !state.isSubmitting,
                        colors = ButtonDefaults.buttonColors(containerColor = BrandPrimary)
                    ) { Text("Saqlash") }
                },
                dismissButton = { TextButton(onClick = { callbacks.showRefundSentDialog(false) }) { Text("Bekor qilish") } },
                shape = RoundedCornerShape(16.dp)
            )
        }

        // Ready: the restaurant itself confirms the food is really ready (never automatic)
        if (state.showReadyConfirm) {
            ActionConfirmDialog(
                title = "Buyurtma tayyor",
                message = "Taom to‘liq tayyor bo‘ldimi? Taksi operatoriga tayyor ekani ko‘rinadi.",
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
                title = { Text("Amal bajarilmadi", fontWeight = FontWeight.Bold) },
                text = { Text(text = state.actionNoticeText ?: "", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface) },
                confirmButton = {
                    Button(onClick = callbacks::dismissActionNotice, colors = ButtonDefaults.buttonColors(containerColor = BrandPrimary)) { Text("Tushunarli") }
                },
                shape = RoundedCornerShape(16.dp)
            )
        }
    }
}

private val ATTENTION_FULL = ATTENTION_TEXT

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
            Text("${order.itemsCount} ta mahsulot", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
            if (order.isTest) {
                Text("Sinov (MOCK) buyurtma — haqiqiy pul emas", style = MaterialTheme.typography.bodySmall, color = ErrorRed, modifier = Modifier.padding(top = 4.dp))
            }
            if (!order.rejectReason.isNullOrBlank()) {
                Text("Rad etish sababi: ${RejectReason.entries.firstOrNull { it.code == order.rejectReason }?.title ?: order.rejectReason}", style = MaterialTheme.typography.bodySmall, color = ErrorRed, modifier = Modifier.padding(top = 4.dp))
            }
            // Preparation: the countdown / overdue time is the second most important thing after the number.
            val prep = order.prep
            if (prep != null && (cooking || order.status == OrderStatus.READY || order.status == OrderStatus.COMPLETED)) {
                HorizontalDivider(modifier = Modifier.padding(vertical = 10.dp), color = MaterialTheme.colorScheme.surfaceVariant)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.AccessTime, contentDescription = null, tint = BrandPrimary, modifier = Modifier.size(26.dp))
                    Spacer(modifier = Modifier.width(10.dp))
                    when {
                        cooking -> LivePrepText(prep, nowElapsed, large = true)
                        else -> Text(
                            "Tayyor" + (order.readyAtMillis?.let { " • ${formatClock(it)}" } ?: ""),
                            style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = SuccessGreen
                        )
                    }
                }
                if (cooking) {
                    Text("Tayyorlash vaqti ${prep.minutes} daqiqa • tayyor bo‘lgach pastdagi „Tayyor“ tugmasini bosing", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
                }
            } else if (prep != null && prep.minutes > 0) {
                Text("Tayyorlash vaqti: ${prep.minutes} daqiqa", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 6.dp))
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
                paid || cookedOrLater -> Step("To‘lov tasdiqlandi", StepState.DONE, order.verifiedAtMillis?.let { formatClock(it) })
                order.paymentStatus == PaymentStatus.MATCHED_UNVERIFIED -> Step("To‘lov tekshiruvda", StepState.CURRENT, "bank hisobingizni tekshiring")
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
                    stage?.let { taxiStageText(it) } ?: "tayyorlash boshlangach avtomatik so‘raladi"
                )
            )
            add(Step("Yetkazildi", if (s == OrderStatus.COMPLETED) StepState.DONE else StepState.PENDING, if (s == OrderStatus.COMPLETED) "taksi operatori tasdiqladi" else null))
        }
        if (ended) add(Step(s.title, StepState.FAILED, null))
    }
    Card(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text("Buyurtma bosqichlari", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
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
            Text("Mijoz va yetkazish manzili", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
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
            Text("Yetkazish narxini taksi xizmati belgilaydi; u taomlar summasiga kirmaydi.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 8.dp))
        }
    }
}

/** Large, full-width, pinned to the bottom. While a request is in flight it is disabled and shows progress (no double submit). */
@Composable
private fun StickyReadyBar(order: Order, nowElapsed: State<Long>, busy: Boolean, onClick: () -> Unit) {
    Surface(color = MaterialTheme.colorScheme.surface, shadowElevation = 12.dp) {
        Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp)) {
            order.prep?.let { prep ->
                // reads the ticker State here, so only this small block recomposes each second
                val d = prep.display(nowElapsed.value)
                if (d != null) {
                    Text(d.text, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold, color = if (d.overdue) ErrorRed else MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(modifier = Modifier.height(4.dp))
                }
            }
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
                Text("E’tibor talab qiladi", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold, color = WarningOrange)
                lines.forEach { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurface) }
            }
        }
    }
}

@Composable
private fun PriceProposalBanner(order: Order) {
    val p = order.priceProposal ?: return
    Surface(color = BrandMint.copy(alpha = 0.35f), shape = RoundedCornerShape(10.dp), modifier = Modifier.fillMaxWidth()) {
        Text(
            "Mijoz roziligi kutilmoqda: ${som(p.oldTotalSom)} → ${som(p.newTotalSom)}. Mijoz rozilik bermaguncha to‘lov ochilmaydi.",
            style = MaterialTheme.typography.bodySmall, color = BrandDark, modifier = Modifier.padding(12.dp)
        )
    }
}

@Composable
private fun PaymentEvidenceCard(order: Order) {
    val ev = order.paymentEvidence ?: return
    if (ev.status != "MATCHED_UNVERIFIED" && ev.status != "CONFIRMED_MANUAL") return
    Card(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text("To‘lov tekshiruvi", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurface)
            Spacer(modifier = Modifier.height(8.dp))
            Text("Kutilgan summa: ${som(ev.expectedAmountSom)}", style = MaterialTheme.typography.bodyMedium)
            Text("To‘lov raqami: #${ev.reference}" + (ev.cardLast4?.let { " • karta ***$it" } ?: ""), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            ev.signalSource?.let {
                Text(
                    "Xabar: $it" + (ev.signalAmountSom?.let { a -> " • ${som(a)}" } ?: "") + (if (ev.signalAmountMatches == false) " • summa mos emas" else ""),
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            ev.matchedAt?.let { Text("Mos kelgan vaqt: $it", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            ev.verifiedAt?.let { Text("Restoran tasdiqlagan: $it", style = MaterialTheme.typography.bodySmall, color = SuccessGreen) }
            if (ev.notBankProof && ev.verifiedAt == null) {
                Spacer(modifier = Modifier.height(6.dp))
                Text("Bu faqat signal — bank tasdig‘i emas.", style = MaterialTheme.typography.bodySmall, color = WarningOrange)
            }
        }
    }
}

@Composable
private fun RefundCard(order: Order) {
    val r = order.refund ?: return
    Card(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text("Bekor qilish / pulni qaytarish #${r.number}", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            Spacer(modifier = Modifier.height(6.dp))
            val statusText = when (r.status) {
                "REQUESTED" -> "Mijoz bekor qilishni so‘radi — qaror kutilmoqda"
                "APPROVED" -> "Qabul qilingan — pulni qaytaring va ma’lumotnomani kiriting"
                "SENT" -> "Qaytarildi (restoran bayoni) — mijoz tasdig‘i kutilmoqda"
                "DISPUTED" -> "Mijoz pul kelmadi dedi — tekshirib, qayta kiriting"
                "CONFIRMED" -> "Mijoz/administrator tasdiqladi"
                "REJECTED" -> "Rad etilgan"
                else -> r.status
            }
            Text(statusText, style = MaterialTheme.typography.bodyMedium)
            Text("To‘langan: ${som(r.paidAmountSom)}" + (r.approvedAmountSom?.let { " • qaytariladi: ${som(it)}" } ?: ""), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            r.bankReference?.let { Text("Ma’lumotnoma: $it", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
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
        Triple("Taksi so‘raldi", reachedRequested, if (stage == TaxiStage.SCHEDULED) "Tayyorlash vaqtiga qarab avtomatik yuboriladi" else null),
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
