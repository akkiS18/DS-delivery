package com.dsdelivery.restaurant.ui.screens.orders

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
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
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
import com.dsdelivery.restaurant.ui.theme.WarningOrange

@Composable
fun OrdersScreen(
    viewModel: OrdersViewModel,
    onNavigateToOrderDetail: (orderId: String) -> Unit,
    modifier: Modifier = Modifier
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
        onPrepTime = viewModel::setPrepTime,
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
    onPrepTime: ((orderId: String, minutes: Int) -> Unit)? = null
) {
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
                OrderFilter.entries.forEach { filter ->
                    val badgeCount = when (filter) {
                        OrderFilter.INCOMING -> if (state.incomingOrdersCount > 0) " (${state.incomingOrdersCount})" else ""
                        OrderFilter.IN_PROGRESS -> if (state.inProgressOrdersCount > 0) " (${state.inProgressOrdersCount})" else ""
                        OrderFilter.READY -> if (state.readyOrdersCount > 0) " (${state.readyOrdersCount})" else ""
                        else -> ""
                    }
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

            if (state.attentionOrdersCount > 0) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 2.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(imageVector = Icons.Default.Warning, contentDescription = null, tint = WarningOrange, modifier = Modifier.size(16.dp))
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(
                        text = "${state.attentionOrdersCount} ta buyurtmaga e’tibor kerak",
                        style = MaterialTheme.typography.bodyMedium,
                        color = WarningOrange
                    )
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
                                title = if (state.searchQuery.isNotEmpty()) "Hech narsa topilmadi" else "Buyurtma yo‘q",
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
                                onPrepTime = onPrepTime?.let { f -> { minutes: Int -> f(order.id, minutes) } },
                                prepBusy = state.prepBusyId == order.id
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
                selectedFilter = OrderFilter.ALL
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
