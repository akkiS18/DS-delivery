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
    HISTORY("Tarix", "history"),
    /** Not a tab: opened from the "N ta buyurtmaga e‘tibor kerak" bar (cancellation asked, taxi trouble, refund to send). */
    ATTENTION("E‘tibor kerak", "attention")
}

/** The tabs a sideways swipe moves between, in chip order (owner 2026-11-24, "like Telegram"). ATTENTION is opened from its bar only. */
val SWIPE_TABS: List<OrderFilter> = OrderFilter.entries.filter { it != OrderFilter.ATTENTION }

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
    /** Wall-clock time of the last successful check, for "Oxirgi yangilanish: 14:32" while offline. */
    val lastUpdatedAtMillis: Long? = null,
    /** The order whose "ready in N minutes" is being saved (one at a time). */
    val prepBusyId: String? = null,
    /** The order being marked "Tayyor" from the list (one at a time). */
    val readyBusyId: String? = null,
    /** The last first page of each tab, so a swipe shows the next tab at once; it is refreshed silently when the swipe settles. */
    val ordersByFilter: Map<OrderFilter, List<Order>> = emptyMap(),
    /** Tarix opens only with the finance code (owner 2026-11-24): the server answered 423, or the code was closed again. */
    val historyLocked: Boolean = false
) {
    /** `orders` is already filtered by the server; this only applies the local search box. */
    val filteredOrders: List<Order>
        get() = applySearch(orders)

    /** The local search box over any list (the swiped-to tab uses its cached page). */
    fun applySearch(list: List<Order>): List<Order> {
        if (searchQuery.isBlank()) return list
        val q = searchQuery.trim().lowercase()
        return list.filter { order ->
            order.code.lowercase().contains(q) ||
                (order.customerPhone?.lowercase()?.contains(q) == true) ||
                (order.customerName?.lowercase()?.contains(q) == true) ||
                order.items.any { it.name.lowercase().contains(q) }
        }
    }

    val hasMore: Boolean get() = nextCursor != null
}
