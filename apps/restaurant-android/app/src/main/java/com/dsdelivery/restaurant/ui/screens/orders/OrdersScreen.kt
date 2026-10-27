package com.dsdelivery.restaurant.ui.screens.orders

import com.dsdelivery.restaurant.ui.components.ReadyChoiceDialog
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.material3.TextButton
import androidx.compose.ui.platform.LocalView
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import com.dsdelivery.restaurant.ui.components.ActionConfirmDialog
import com.dsdelivery.restaurant.ui.components.EmptyView
import com.dsdelivery.restaurant.ui.components.ErrorView
import com.dsdelivery.restaurant.ui.components.LoadingView
import com.dsdelivery.restaurant.ui.components.OrderCard
import com.dsdelivery.restaurant.ui.components.PullRefresh
import com.dsdelivery.restaurant.ui.components.rememberNowElapsed
import com.dsdelivery.restaurant.data.model.OrderStatus
import com.dsdelivery.restaurant.ui.preview.SampleData
import com.dsdelivery.restaurant.ui.theme.BrandDark
import com.dsdelivery.restaurant.ui.theme.BrandMint
import com.dsdelivery.restaurant.ui.theme.BrandPrimary
import com.dsdelivery.restaurant.ui.theme.DSRestaurantTheme
import com.dsdelivery.restaurant.ui.theme.ErrorRed
import com.dsdelivery.restaurant.ui.theme.SuccessGreen
import com.dsdelivery.restaurant.ui.theme.WarningOrange

@Composable
fun OrdersScreen(
    viewModel: OrdersViewModel,
    onNavigateToOrderDetail: (orderId: String) -> Unit,
    modifier: Modifier = Modifier,
    /** The kitchen bell is sounding: a strip with a mute button is shown. */
    alarmRinging: Boolean = false,
    onSilence: () -> Unit = {},
    /** Reception switch in the title bar (Ochiq / Tanaffus); null hides it. */
    isPaused: Boolean = false,
    onSetPaused: ((Boolean) -> Unit)? = null
) {
    val state by viewModel.uiState.collectAsState()

    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { viewModel.loadOrders(isRefresh = true) }

    OrdersContent(
        state = state,
        onRefresh = { viewModel.loadOrders(isRefresh = true) },
        onFilterSelected = viewModel::selectFilter,
        onSearchQueryChange = viewModel::onSearchQueryChange,
        onManualOrderIdChange = viewModel::onManualOrderIdChange,
        onSearchOrderById = { viewModel.searchOrderById(onFound = { onNavigateToOrderDetail(it.id) }) },
        onLoadMore = viewModel::loadMore,
        onDismissNotice = viewModel::dismissNotice,
        onDismissError = viewModel::dismissError,
        onOrderClick = onNavigateToOrderDetail,
        onAcknowledge = viewModel::acknowledgeOrder,
        onMarkReady = viewModel::markReady,
        onSelfDelivered = viewModel::markSelfDelivered,
        alarmRinging = alarmRinging,
        onSilence = onSilence,
        isPaused = isPaused,
        onSetPaused = onSetPaused,
        modifier = modifier
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OrdersContent(
    state: OrdersUiState,
    onRefresh: () -> Unit,
    onFilterSelected: (OrderFilter) -> Unit,
    onSearchQueryChange: (String) -> Unit,
    onManualOrderIdChange: (String) -> Unit,
    onSearchOrderById: () -> Unit,
    onLoadMore: () -> Unit,
    onDismissNotice: () -> Unit,
    onDismissError: () -> Unit,
    onOrderClick: (orderId: String) -> Unit,
    modifier: Modifier = Modifier,
    onAcknowledge: ((orderId: String) -> Unit)? = null,
    onMarkReady: ((orderId: String, selfDelivery: Boolean) -> Unit)? = null,
    onSelfDelivered: ((orderId: String) -> Unit)? = null,
    alarmRinging: Boolean = false,
    onSilence: () -> Unit = {},
    isPaused: Boolean = false,
    onSetPaused: ((Boolean) -> Unit)? = null
) {
    // The kitchen watches this screen: it must not dim or lock while it is open.
    val view = LocalView.current
    DisposableEffect(view) {
        view.keepScreenOn = true
        onDispose { view.keepScreenOn = false }
    }
    var confirmPause by remember { mutableStateOf(false) }
    if (confirmPause && onSetPaused != null) {
        ActionConfirmDialog(
            title = if (!isPaused) "Qabulni to‘xtatasizmi?" else "Qabulni yoqasizmi?",
            message = if (!isPaused) "Yangi buyurtmalar kelmaydi." else "Mijozlar yana buyurtma bera oladi.",
            confirmText = if (!isPaused) "To‘xtatish" else "Yoqish",
            confirmButtonColor = if (!isPaused) WarningOrange else BrandPrimary,
            onConfirm = { confirmPause = false; onSetPaused(!isPaused) },
            onDismiss = { confirmPause = false }
        )
    }
    // "Tayyor" cannot be taken back (the customer is told, the taxi is called), so the list asks once.
    var confirmReadyFor by remember { mutableStateOf<String?>(null) }
    confirmReadyFor?.let { id ->
        val target = state.orders.firstOrNull { it.id == id }
        if (target?.walkOk == true) {
            // The customer allowed walking delivery: the restaurant chooses who brings it.
            ReadyChoiceDialog(
                order = target,
                onSelf = { confirmReadyFor = null; onMarkReady?.invoke(id, true) },
                onTaxi = { confirmReadyFor = null; onMarkReady?.invoke(id, false) },
                onDismiss = { confirmReadyFor = null }
            )
        } else {
            ActionConfirmDialog(
                title = "Buyurtma tayyor",
                message = "Taksi operatoriga xabar yuboriladi.",
                confirmText = "Tayyor",
                confirmButtonColor = SuccessGreen,
                onConfirm = { confirmReadyFor = null; onMarkReady?.invoke(id, false) },
                onDismiss = { confirmReadyFor = null }
            )
        }
    }
    // "Yetkazildi" cannot be taken back either: it completes the order and books the commission.
    var confirmDeliveredFor by remember { mutableStateOf<String?>(null) }
    confirmDeliveredFor?.let { id ->
        ActionConfirmDialog(
            title = "Yetkazildimi?",
            message = "Buyurtma mijozga yetkazilganini tasdiqlaysiz. Bu qaytarilmaydi.",
            confirmText = "Yetkazildi",
            confirmButtonColor = SuccessGreen,
            onConfirm = { confirmDeliveredFor = null; onSelfDelivered?.invoke(id) },
            onDismiss = { confirmDeliveredFor = null }
        )
    }
    // One ticker for the whole list: every second while something is being cooked (live countdowns), otherwise every 30 s (order ages).
    val cooking = state.orders.any { it.status == OrderStatus.PREPARING }
    val nowElapsed = rememberNowElapsed(periodMs = if (cooking) 1000L else 30_000L)

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = "Buyurtmalar",
                        style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold)
                    )
                },
                actions = {
                    if (onSetPaused != null) {
                        Surface(
                            onClick = { confirmPause = true },
                            shape = RoundedCornerShape(20.dp),
                            color = if (isPaused) WarningOrange else SuccessGreen,
                            modifier = Modifier.padding(end = 12.dp)
                        ) {
                            Text(
                                text = if (isPaused) "Tanaffus" else "Ochiq",
                                color = Color.White,
                                fontWeight = FontWeight.Bold,
                                style = MaterialTheme.typography.labelLarge,
                                modifier = Modifier.padding(horizontal = 14.dp, vertical = 7.dp)
                            )
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = BrandPrimary,
                    titleContentColor = Color.White,
                    actionIconContentColor = Color.White
                )
            )
        },
        modifier = modifier
    ) { innerPadding ->
        PullRefresh(
            isRefreshing = state.isRefreshing,
            onRefresh = onRefresh,
            modifier = Modifier.fillMaxSize().padding(innerPadding).background(MaterialTheme.colorScheme.background)
        ) {
        Column(modifier = Modifier.fillMaxSize()) {
            // Filter Chips Row
            val filterScrollState = rememberScrollState()
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(filterScrollState)
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                OrderFilter.entries.filter { it != OrderFilter.ATTENTION }.forEach { filter ->
                    val count = when (filter) {
                        OrderFilter.NEW -> state.newOrdersCount
                        OrderFilter.COOKING -> state.cookingOrdersCount
                        OrderFilter.READY -> state.readyOrdersCount
                        OrderFilter.WAITING -> state.waitingOrdersCount
                        OrderFilter.HISTORY, OrderFilter.ATTENTION -> 0
                    }
                    val badgeCount = if (count > 0) " ($count)" else ""
                    FilterChip(
                        selected = state.selectedFilter == filter,
                        onClick = { onFilterSelected(filter) },
                        label = { Text("${filter.title}$badgeCount") },
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = BrandPrimary,
                            selectedLabelColor = Color.White
                        )
                    )
                }
            }

            if (alarmRinging) {
                Surface(
                    color = ErrorRed,
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp)
                ) {
                    Row(modifier = Modifier.padding(start = 14.dp, end = 6.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("Yangi buyurtma kutmoqda!", color = Color.White, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                        TextButton(onClick = onSilence) { Text("Ovozni o‘chirish", color = Color.White, fontWeight = FontWeight.Bold) }
                    }
                }
            }
            if (state.selectedFilter == OrderFilter.ATTENTION) {
                Surface(
                    color = WarningOrange.copy(alpha = 0.15f),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp)
                ) {
                    Row(modifier = Modifier.padding(start = 14.dp, end = 6.dp, top = 4.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("E‘tibor kerak buyurtmalar", color = WarningOrange, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                        TextButton(onClick = { onFilterSelected(OrderFilter.NEW) }) { Text("Orqaga") }
                    }
                }
            } else if (state.attentionOrdersCount > 0) {
                Surface(
                    onClick = { onFilterSelected(OrderFilter.ATTENTION) },
                    color = WarningOrange.copy(alpha = 0.15f),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp)
                ) {
                    Row(modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(imageVector = Icons.Default.Warning, contentDescription = null, tint = WarningOrange, modifier = Modifier.size(18.dp))
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = "${state.attentionOrdersCount} ta buyurtmaga e’tibor kerak",
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.Bold,
                            color = WarningOrange,
                            modifier = Modifier.weight(1f)
                        )
                        Text("Ko‘rish", color = WarningOrange, style = MaterialTheme.typography.labelLarge)
                    }
                }
            }
            if (state.pollFailed) {
                Text(
                    text = "Internet yo‘q. Qayta urinilmoqda...",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 2.dp)
                )
            }

            // Search Bar
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 4.dp)
            ) {
                OutlinedTextField(
                    value = state.searchQuery,
                    onValueChange = onSearchQueryChange,
                    placeholder = { Text("Qidirish") },
                    leadingIcon = {
                        Icon(
                            imageVector = Icons.Default.Search,
                            contentDescription = null,
                            tint = BrandPrimary
                        )
                    },
                    trailingIcon = {
                        if (state.searchQuery.isNotEmpty()) {
                            IconButton(onClick = { onSearchQueryChange("") }) {
                                Icon(imageVector = Icons.Default.Clear, contentDescription = "Tozalash")
                            }
                        }
                    },
                    singleLine = true,
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth()
                )
            }

            // Error Banner (if any)
            if (state.errorMessage != null && state.orders.isNotEmpty()) {
                Surface(
                    color = ErrorRed.copy(alpha = 0.1f),
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 4.dp)
                ) {
                    Row(
                        modifier = Modifier.padding(10.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            imageVector = Icons.Default.Warning,
                            contentDescription = null,
                            tint = ErrorRed,
                            modifier = Modifier.size(16.dp)
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = state.errorMessage,
                            style = MaterialTheme.typography.bodySmall,
                            color = ErrorRed,
                            modifier = Modifier.weight(1f)
                        )
                        IconButton(onClick = onDismissError, modifier = Modifier.size(20.dp)) {
                            Icon(imageVector = Icons.Default.Clear, contentDescription = "Yopish", tint = ErrorRed, modifier = Modifier.size(14.dp))
                        }
                    }
                }
            }

            // Main Content: Loading / Empty / Orders List
            when {
                state.isLoading -> {
                    LoadingView(message = "Yuklanmoqda...")
                }
                state.errorMessage != null && state.orders.isEmpty() -> {
                    ErrorView(message = state.errorMessage, onRetry = onRefresh)
                }
                state.filteredOrders.isEmpty() -> {
                    // A scrollable (empty) list, so the pull-down gesture also works when there is nothing to show yet.
                    LazyColumn(modifier = Modifier.fillMaxSize()) {
                        item {
                            EmptyView(
                                title = when {
                                    state.searchQuery.isNotEmpty() -> "Hech narsa topilmadi"
                                    state.selectedFilter == OrderFilter.NEW -> "Yangi buyurtma yo‘q"
                                    state.selectedFilter == OrderFilter.COOKING -> "Tayyorlanayotgan buyurtma yo‘q"
                                    state.selectedFilter == OrderFilter.READY -> "Tayyor buyurtma yo‘q"
                                    state.selectedFilter == OrderFilter.WAITING -> "Kutilayotgan buyurtma yo‘q"
                                    else -> "Buyurtma yo‘q"
                                },
                                subtitle = null,
                                modifier = Modifier.fillParentMaxSize()
                            )
                        }
                    }
                }
                else -> {
                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 6.dp, bottom = 80.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        items(
                            items = state.filteredOrders,
                            key = { it.id }
                        ) { order ->
                            OrderCard(
                                order = order,
                                nowElapsed = nowElapsed,
                                onClick = { onOrderClick(order.id) },
                                onAcknowledge = onAcknowledge?.let { f -> { f(order.id) } },
                                prepBusy = state.prepBusyId == order.id,
                                onReady = if (onMarkReady != null) ({ confirmReadyFor = order.id }) else null,
                                readyBusy = state.readyBusyId == order.id,
                                onSelfDelivered = if (onSelfDelivered != null) ({ confirmDeliveredFor = order.id }) else null
                            )
                        }
                        if (state.hasMore && state.searchQuery.isBlank()) {
                            item(key = "load-more") {
                                OutlinedButton(
                                    onClick = onLoadMore,
                                    enabled = !state.isLoadingMore,
                                    modifier = Modifier.fillMaxWidth(),
                                    shape = RoundedCornerShape(10.dp)
                                ) {
                                    if (state.isLoadingMore) {
                                        CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                                    } else {
                                        Text("Yana ko‘rsatish")
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun OrdersScreenPreview() {
    DSRestaurantTheme {
        OrdersContent(
            state = OrdersUiState(
                orders = SampleData.sampleOrders,
                selectedFilter = OrderFilter.NEW
            ),
            onRefresh = {},
            onFilterSelected = {},
            onSearchQueryChange = {},
            onManualOrderIdChange = {},
            onSearchOrderById = {},
            onLoadMore = {},
            onDismissNotice = {},
            onDismissError = {},
            onOrderClick = {}
        )
    }
}
