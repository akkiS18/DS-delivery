package com.dsdelivery.restaurant.ui.screens.orders

import com.dsdelivery.restaurant.data.model.Order

/** [apiValue] is the `filter` query value of GET /api/v1/restaurant/orders; the server does the bucketing. */
enum class OrderFilter(val title: String, val apiValue: String) {
    ALL("Barchasi", "all"),
    INCOMING("Yangi", "incoming"),
    IN_PROGRESS("Jarayonda", "inProgress"),
    READY("Tayyor", "ready"),
    HISTORY("Tarix", "history")
}

data class OrdersUiState(
    val isLoading: Boolean = false,
    val isRefreshing: Boolean = false,
    val isLoadingMore: Boolean = false,
    val orders: List<Order> = emptyList(),
    /** Present while more pages exist for the selected filter. */
    val nextCursor: Int? = null,
    val selectedFilter: OrderFilter = OrderFilter.ALL,
    val searchQuery: String = "",
    val manualOrderIdInput: String = "",
    val isLoadingManualOrder: Boolean = false,
    val errorMessage: String? = null,
    val backendNotice: String? = null,
    val incomingOrdersCount: Int = 0,
    val inProgressOrdersCount: Int = 0,
    val readyOrdersCount: Int = 0,
    /** Orders needing a human decision (unverified payment, cancellation request, taxi trouble, refund to send). */
    val attentionOrdersCount: Int = 0,
    /** The last background check failed (offline / server down); shown as a small hint, never as fake data. */
    val pollFailed: Boolean = false
) {
    /** `orders` is already filtered by the server; this only applies the local search box. */
    val filteredOrders: List<Order>
        get() {
            if (searchQuery.isBlank()) return orders
            val q = searchQuery.trim().lowercase()
            return orders.filter { order ->
                order.number.toString().contains(q) ||
                    (order.customerPhone?.lowercase()?.contains(q) == true) ||
                    (order.customerName?.lowercase()?.contains(q) == true) ||
                    order.items.any { it.name.lowercase().contains(q) }
            }
        }

    val hasMore: Boolean get() = nextCursor != null
}
