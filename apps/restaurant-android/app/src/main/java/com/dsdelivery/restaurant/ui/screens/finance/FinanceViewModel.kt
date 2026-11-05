package com.dsdelivery.restaurant.ui.screens.finance

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dsdelivery.restaurant.data.api.dto.LedgerDto
import com.dsdelivery.restaurant.data.model.FinanceUnlock
import com.dsdelivery.restaurant.data.model.Resource
import com.dsdelivery.restaurant.data.model.isFinanceLocked
import com.dsdelivery.restaurant.data.repository.RestaurantRepository
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * The Moliya tab (owner decision 2026-11-05): a 4-digit code first, then the card money, then the "Jami" history. The code is checked by the server;
 * this class only walks the screens. Money is hidden again whenever the tab is left or the app goes to the background ([lock]).
 */
class FinanceViewModel(
    private val repository: RestaurantRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(FinanceUiState())
    val uiState: StateFlow<FinanceUiState> = _uiState.asStateFlow()

    private var loadJob: Job? = null
    private var historyJob: Job? = null

    init {
        refresh()
    }

    /** Asks the server whether the code is already entered on this login and loads the numbers if so. Cheap: called on resume and tab switch. */
    fun refresh() {
        val s = _uiState.value
        if (s.pinBusy) return
        loadJob?.cancel()
        loadJob = viewModelScope.launch {
            if (s.phase == FinancePhase.OPEN) { loadOverviewNow(); return@launch }
            _uiState.update { it.copy(isLoading = true, errorMessage = null) }
            when (val r = repository.getFinanceState()) {
                is Resource.Success -> when {
                    !r.data.hasPin -> _uiState.update { it.copy(phase = FinancePhase.NO_PIN, isLoading = false, overview = null) }
                    r.data.unlocked -> { _uiState.update { it.copy(phase = FinancePhase.OPEN) }; loadOverviewNow() }
                    else -> _uiState.update { it.copy(phase = FinancePhase.LOCKED, isLoading = false, overview = null, errorMessage = null) }
                }
                is Resource.Error -> _uiState.update {
                    // The code screen shows the reason (no connection ...); typing the code retries.
                    it.copy(phase = FinancePhase.LOCKED, isLoading = false, errorMessage = r.message)
                }
                Resource.Loading -> {}
            }
        }
    }

    private suspend fun loadOverviewNow() {
        _uiState.update { it.copy(isLoading = true) }
        val r = repository.getFinanceOverview()
        // A cancelled (superseded) request must not flash an error over the newer one.
        currentCoroutineContext().ensureActive()
        when (r) {
            is Resource.Success -> _uiState.update { it.copy(phase = FinancePhase.OPEN, isLoading = false, overview = r.data, errorMessage = null) }
            is Resource.Error ->
                if (isFinanceLocked(r)) _uiState.update { FinanceUiState(phase = FinancePhase.LOCKED) }
                else _uiState.update { it.copy(isLoading = false, errorMessage = r.message) }
            Resource.Loading -> {}
        }
    }

    // ---- the code pad
    fun onDigit(d: Char) {
        val s = _uiState.value
        if (s.pinBusy || s.phase != FinancePhase.LOCKED || s.pin.length >= PIN_LENGTH || !d.isDigit()) return
        val next = s.pin + d
        _uiState.update { it.copy(pin = next, pinError = null) }
        if (next.length == PIN_LENGTH) submit(next)
    }

    fun onBackspace() {
        if (_uiState.value.pinBusy) return
        _uiState.update { it.copy(pin = it.pin.dropLast(1), pinError = null) }
    }

    private fun submit(pin: String) {
        _uiState.update { it.copy(pinBusy = true, pinError = null) }
        viewModelScope.launch {
            when (val r = repository.unlockFinance(pin)) {
                FinanceUnlock.Opened -> {
                    _uiState.update { it.copy(pin = "", pinBusy = false, phase = FinancePhase.OPEN, errorMessage = null) }
                    loadOverviewNow()
                }
                is FinanceUnlock.Wrong -> fail(
                    if (r.attemptsLeft != null) "Kod noto‘g‘ri. Yana ${r.attemptsLeft} marta urinish mumkin." else "Kod noto‘g‘ri."
                )
                is FinanceUnlock.Blocked -> fail("Juda ko‘p xato kiritildi. ${minutes(r.retryAfterSeconds)}dan keyin urinib ko‘ring.")
                FinanceUnlock.NoPin -> _uiState.update { it.copy(pin = "", pinBusy = false, phase = FinancePhase.NO_PIN) }
                is FinanceUnlock.Failed -> fail(r.message)
            }
        }
    }

    private fun fail(message: String) = _uiState.update { it.copy(pin = "", pinBusy = false, pinError = message) }

    private fun minutes(seconds: Int): String = "${(seconds + 59) / 60} daqiqa"

    // ---- leaving: hide the money at once and close the window on the server
    fun lock() {
        val s = _uiState.value
        loadJob?.cancel()
        historyJob?.cancel()
        // Wiped before the server answers: nothing may be visible when the tab is shown again.
        _uiState.value = FinanceUiState(phase = if (s.phase == FinancePhase.NO_PIN) FinancePhase.NO_PIN else FinancePhase.LOCKED)
        if (s.phase == FinancePhase.OPEN) viewModelScope.launch { repository.lockFinance() }
    }

    // ---- "Jami" history
    fun openHistory() {
        _uiState.update { it.copy(historyOpen = true) }
        if (!_uiState.value.history.loaded) loadHistory()
    }

    fun closeHistory() {
        historyJob?.cancel()
        _uiState.update { it.copy(historyOpen = false, history = it.history.copy(isLoading = false, isLoadingMore = false)) }
    }

    fun setPeriod(p: HistoryPeriod) {
        if (_uiState.value.history.period == p) return
        _uiState.update { it.copy(history = it.history.copy(period = p)) }
        loadHistory()
    }

    fun setSource(src: HistorySource) {
        if (_uiState.value.history.source == src) return
        _uiState.update { it.copy(history = it.history.copy(source = src)) }
        loadHistory()
    }

    fun reloadHistory() = loadHistory()

    private fun loadHistory() {
        historyJob?.cancel()
        val h0 = _uiState.value.history
        val (from, to) = h0.period.range()
        _uiState.update { it.copy(history = it.history.copy(isLoading = true, isLoadingMore = false, errorMessage = null, items = emptyList(), nextCursor = null, loaded = false)) }
        historyJob = viewModelScope.launch {
            val r = repository.getFinanceLedger(h0.source.query, from, to, null)
            ensureActive()
            applyHistory(r, append = false)
        }
    }

    fun loadMoreHistory() {
        val h = _uiState.value.history
        val cursor = h.nextCursor ?: return
        if (h.isLoading || h.isLoadingMore) return
        val (from, to) = h.period.range()
        _uiState.update { it.copy(history = it.history.copy(isLoadingMore = true, errorMessage = null)) }
        historyJob = viewModelScope.launch {
            val r = repository.getFinanceLedger(h.source.query, from, to, cursor)
            ensureActive()
            applyHistory(r, append = true)
        }
    }

    private fun applyHistory(r: Resource<LedgerDto>, append: Boolean) {
        when (r) {
            is Resource.Success -> _uiState.update {
                val h = it.history
                it.copy(history = h.copy(
                    items = if (append) h.items + r.data.items else r.data.items,
                    totals = r.data.totals, nextCursor = r.data.nextCursor,
                    loaded = true, isLoading = false, isLoadingMore = false, errorMessage = null
                ))
            }
            is Resource.Error ->
                if (isFinanceLocked(r)) _uiState.value = FinanceUiState(phase = FinancePhase.LOCKED)
                else _uiState.update { it.copy(history = it.history.copy(isLoading = false, isLoadingMore = false, errorMessage = r.message)) }
            Resource.Loading -> {}
        }
    }

    private companion object {
        const val PIN_LENGTH = 4
    }
}
