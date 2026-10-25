package com.dsdelivery.restaurant.ui.screens.orders

import com.dsdelivery.restaurant.data.model.Order

/** [apiValue] is the `filter` query value of GET /api/v1/restaurant/orders; the server does the bucketing. */
enum class OrderFilter(val title: String, val apiValue: String) {
    /** Needs the kitchen now: a payment to verify, or a paid order whose "ready in N minutes" nobody chose yet. The app opens here. */
    NEW("Yangi", "new"),
    COOKING("Tayyorlanmoqda", "cooking"),
    READY("Tayyor", "ready"),
    /** Not for the kitchen (yet): unpaid, taxi on its way, cancellation asked. Visible, never announced. */
    WAITING("Kutilmoqda", "waiting"),
    HISTORY("Tarix", "history")
}

data class OrdersUiState(
    val isLoading: Boolean = false,
    val isRefreshing: Boolean = false,
    val isLoadingMore: Boolean = false,
    val orders: List<Order> = emptyList(),
    /** Present while more pages exist for the selected filter. */
    val nextCursor: String? = null,
    val selectedFilter: OrderFilter = OrderFilter.NEW,
    val searchQuery: String = "",
    val manualOrderIdInput: String = "",
    val isLoadingManualOrder: Boolean = false,
    val errorMessage: String? = null,
    val backendNotice: String? = null,
    val newOrdersCount: Int = 0,
    val cookingOrdersCount: Int = 0,
    val readyOrdersCount: Int = 0,
    val waitingOrdersCount: Int = 0,
    /** Orders needing a human decision (unverified payment, cancellation request, taxi trouble, refund to send). */
    val attentionOrdersCount: Int = 0,
    /** The last background check failed (offline / server down); shown as a small hint, never as fake data. */
    val pollFailed: Boolean = false,
    /** The order whose "ready in N minutes" is being saved (one at a time). */
    val prepBusyId: String? = null,
    /** The order being marked "Tayyor" from the list (one at a time). */
    val readyBusyId: String? = null
) {
    /** `orders` is already filtered by the server; this only applies the local search box. */
    val filteredOrders: List<Order>
        get() {
            if (searchQuery.isBlank()) return orders
            val q = searchQuery.trim().lowercase()
            return orders.filter { order ->
                order.code.lowercase().contains(q) ||
                    (order.customerPhone?.lowercase()?.contains(q) == true) ||
                    (order.customerName?.lowercase()?.contains(q) == true) ||
                    order.items.any { it.name.lowercase().contains(q) }
            }
        }

    val hasMore: Boolean get() = nextCursor != null
}
