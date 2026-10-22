package com.dsdelivery.restaurant.ui.screens.orders

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dsdelivery.restaurant.data.model.Order
import com.dsdelivery.restaurant.data.model.Resource
import com.dsdelivery.restaurant.data.notify.AppForeground
import com.dsdelivery.restaurant.data.repository.RestaurantRepository
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import retrofit2.HttpException

class OrdersViewModel(
    private val repository: RestaurantRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(OrdersUiState())
    val uiState: StateFlow<OrdersUiState> = _uiState.asStateFlow()

    /** Orders that appeared since the last poll. Emitted once per order id for the lifetime of this ViewModel. */
    private val _newOrders = MutableSharedFlow<List<Order>>(extraBufferCapacity = 8)
    val newOrders: SharedFlow<List<Order>> = _newOrders.asSharedFlow()

    private var loadJob: Job? = null
    private var pollJob: Job? = null
    private val knownIncoming = LinkedHashSet<String>()
    private var baselineDone = false

    init {
        loadOrders(isRefresh = false)
        observeForeground()
    }

    /** Foreground polling only: it stops with the UI and when the session is gone. Background push is NOT implemented. */
    private fun observeForeground() {
        viewModelScope.launch {
            AppForeground.isForeground.collect { foreground ->
                if (foreground) startPolling() else stopPolling()
            }
        }
    }

    private fun startPolling() {
        if (pollJob?.isActive == true) return
        pollJob = viewModelScope.launch {
            while (isActive) {
                if (!pollOnce()) break
                delay(POLL_INTERVAL_MS)
            }
        }
    }

    private fun stopPolling() {
        pollJob?.cancel()
        pollJob = null
    }

    /** @return false when polling must stop (expired session: the app navigates to login by itself). */
    private suspend fun pollOnce(): Boolean {
        when (val result = repository.getOrders("toCook", null)) {
            is Resource.Success -> {
                val page = result.data
                val fresh = if (baselineDone) page.orders.filter { it.id !in knownIncoming } else emptyList()
                knownIncoming.addAll(page.orders.map { it.id })
                while (knownIncoming.size > MAX_KNOWN) knownIncoming.remove(knownIncoming.first())
                baselineDone = true
                _uiState.update {
                    it.copy(
                        incomingOrdersCount = page.incomingCount,
                        inProgressOrdersCount = page.inProgressCount,
                        readyOrdersCount = page.readyCount,
                        attentionOrdersCount = page.attentionCount,
                        pollFailed = false
                    )
                }
                if (fresh.isNotEmpty()) _newOrders.tryEmit(fresh)
                // Keep the visible list current (no spinner) so status changes made elsewhere show up.
                loadOrders(isRefresh = true, silent = true)
            }
            is Resource.Error -> {
                if ((result.cause as? HttpException)?.code() == 401) return false
                _uiState.update { it.copy(pollFailed = true) }
            }
            Resource.Loading -> {}
        }
        return true
    }

    /** Reloads the first page of the selected filter. A newer call cancels an older one so results never interleave. */
    fun loadOrders(isRefresh: Boolean = false, silent: Boolean = false) {
        loadJob?.cancel()
        loadJob = viewModelScope.launch {
            // Silent refreshes (resume, pull) keep the current list visible instead of flashing a spinner.
            if (!silent) {
                _uiState.update {
                    if (isRefresh || it.orders.isNotEmpty()) it.copy(isRefreshing = true, errorMessage = null)
                    else it.copy(isLoading = true, errorMessage = null)
                }
            }

            when (val result = repository.getOrders(_uiState.value.selectedFilter.apiValue, null)) {
                is Resource.Success -> {
                    val page = result.data
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            isRefreshing = false,
                            orders = page.orders,
                            nextCursor = page.nextCursor,
                            incomingOrdersCount = page.incomingCount,
                            inProgressOrdersCount = page.inProgressCount,
                            readyOrdersCount = page.readyCount,
                            attentionOrdersCount = page.attentionCount,
                            errorMessage = null,
                            backendNotice = null
                        )
                    }
                }
                is Resource.Error -> {
                    // Never fall back to sample data: a failed request keeps whatever real orders were loaded.
                    _uiState.update {
                        it.copy(isLoading = false, isRefreshing = false, errorMessage = if (silent) it.errorMessage else result.message)
                    }
                }
                Resource.Loading -> {}
            }
        }
    }

    fun loadMore() {
        val state = _uiState.value
        val cursor = state.nextCursor ?: return
        if (state.isLoadingMore || state.isLoading || state.isRefreshing) return

        viewModelScope.launch {
            _uiState.update { it.copy(isLoadingMore = true) }
            val filter = state.selectedFilter
            when (val result = repository.getOrders(filter.apiValue, cursor)) {
                is Resource.Success -> {
                    _uiState.update {
                        // The user may have switched tabs while this page was in flight.
                        if (it.selectedFilter != filter) it.copy(isLoadingMore = false)
                        else {
                            val known = it.orders.map { o -> o.id }.toSet()
                            it.copy(
                                isLoadingMore = false,
                                orders = it.orders + result.data.orders.filter { o -> o.id !in known },
                                nextCursor = result.data.nextCursor
                            )
                        }
                    }
                }
                is Resource.Error -> {
                    _uiState.update { it.copy(isLoadingMore = false, errorMessage = result.message) }
                }
                Resource.Loading -> {}
            }
        }
    }

    fun onSearchQueryChange(query: String) {
        _uiState.update { it.copy(searchQuery = query) }
    }

    fun onManualOrderIdChange(id: String) {
        _uiState.update { it.copy(manualOrderIdInput = id) }
    }

    fun searchOrderById(onFound: (Order) -> Unit) {
        val orderId = _uiState.value.manualOrderIdInput.trim()
        if (orderId.isBlank() || _uiState.value.isLoadingManualOrder) return

        viewModelScope.launch {
            _uiState.update { it.copy(isLoadingManualOrder = true, errorMessage = null) }
            when (val result = repository.getOrder(orderId)) {
                is Resource.Success -> {
                    _uiState.update { it.copy(isLoadingManualOrder = false, manualOrderIdInput = "") }
                    onFound(result.data)
                }
                is Resource.Error -> {
                    _uiState.update { it.copy(isLoadingManualOrder = false, errorMessage = result.message) }
                }
                Resource.Loading -> {}
            }
        }
    }

    fun selectFilter(filter: OrderFilter) {
        if (filter == _uiState.value.selectedFilter) return
        _uiState.update { it.copy(selectedFilter = filter, orders = emptyList(), nextCursor = null) }
        loadOrders(isRefresh = false)
    }

    fun dismissNotice() {
        _uiState.update { it.copy(backendNotice = null) }
    }

    fun dismissError() {
        _uiState.update { it.copy(errorMessage = null) }
    }

    private companion object {
        const val POLL_INTERVAL_MS = 15_000L
        const val MAX_KNOWN = 500
    }
}
