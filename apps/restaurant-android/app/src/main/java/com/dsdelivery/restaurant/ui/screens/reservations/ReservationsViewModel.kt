package com.dsdelivery.restaurant.ui.screens.reservations

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dsdelivery.restaurant.data.model.Reservation
import com.dsdelivery.restaurant.data.model.ReservationSettings
import com.dsdelivery.restaurant.data.model.ReservationsReport
import com.dsdelivery.restaurant.data.model.Resource
import com.dsdelivery.restaurant.data.repository.RestaurantRepository
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class ReservationsUiState(
    val isLoading: Boolean = false,
    /** Backend data only. Kept across a failed refresh so a lost connection does not blank a list the kitchen is working from. */
    val report: ReservationsReport? = null,
    val errorMessage: String? = null,
    /** Reservations that were new when the list was opened; they keep their "Yangi" marker until the screen is left. */
    val freshIds: Set<String> = emptySet(),
    val busyId: String? = null,
    val infoMessage: String? = null,
    val settingsBusy: Boolean = false,
    val settingsError: String? = null
) {
    val unseenCount: Int get() = report?.unseenCount ?: 0
    val awaitingCount: Int get() = report?.upcoming?.count { it.awaitingConfirm } ?: 0
    val settings: ReservationSettings? get() = report?.settings
}

class ReservationsViewModel(
    private val repository: RestaurantRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(ReservationsUiState())
    val uiState: StateFlow<ReservationsUiState> = _uiState.asStateFlow()

    private var loadJob: Job? = null

    init {
        refresh()
    }

    /** [silent] = a background refresh: no spinner, and a failure keeps what is on screen. */
    fun refresh(silent: Boolean = false) {
        loadJob?.cancel()
        if (!silent) _uiState.update { it.copy(isLoading = true, errorMessage = null) }
        loadJob = viewModelScope.launch {
            when (val result = repository.getReservations()) {
                is Resource.Success -> _uiState.update { it.copy(isLoading = false, report = result.data, errorMessage = null) }
                is Resource.Error -> _uiState.update { it.copy(isLoading = false, errorMessage = if (silent && it.report != null) it.errorMessage else result.message) }
                Resource.Loading -> {}
            }
        }
    }

    /** The list is on screen: tell the server the new reservations were seen (this silences the notification) and remember which ones were new. */
    fun markSeen() {
        // Each reservation is reported once per visit to the tab, so a server that keeps refusing cannot turn this into a request loop.
        val unseen = _uiState.value.report?.upcoming.orEmpty().filter { !it.seen && !it.cancelled && it.id !in _uiState.value.freshIds }
        if (unseen.isEmpty()) return
        _uiState.update { it.copy(freshIds = it.freshIds + unseen.map(Reservation::id)) }
        viewModelScope.launch {
            unseen.forEach { repository.markReservationSeen(it.id) }
            refresh(silent = true)
        }
    }

    fun clearFresh() {
        _uiState.update { it.copy(freshIds = emptySet()) }
    }

    fun confirmPayment(id: String) = act(id, "Joy band qilindi.") { repository.confirmReservationPayment(id) }

    fun cancel(id: String) = act(id, "Bron bekor qilindi. Mijozga qo‘ng‘iroq qilib pulni qaytaring.") { repository.cancelReservation(id, null) }

    private fun act(id: String, done: String, call: suspend () -> Resource<Unit>) {
        if (_uiState.value.busyId != null) return
        _uiState.update { it.copy(busyId = id) }
        viewModelScope.launch {
            when (val result = call()) {
                is Resource.Success -> _uiState.update { it.copy(busyId = null, infoMessage = done) }
                is Resource.Error -> _uiState.update { it.copy(busyId = null, infoMessage = result.message) }
                Resource.Loading -> {}
            }
            refresh(silent = true)
        }
    }

    fun dismissInfo() {
        _uiState.update { it.copy(infoMessage = null) }
    }

    fun saveSettings(enabled: Boolean, depositSom: Int) {
        if (_uiState.value.settingsBusy) return
        _uiState.update { it.copy(settingsBusy = true, settingsError = null) }
        viewModelScope.launch {
            when (val result = repository.updateReservationSettings(enabled, depositSom)) {
                is Resource.Success -> _uiState.update { it.copy(settingsBusy = false) }
                is Resource.Error -> _uiState.update { it.copy(settingsBusy = false, settingsError = result.message) }
                Resource.Loading -> {}
            }
            refresh(silent = true)
        }
    }

    fun dismissSettingsError() {
        _uiState.update { it.copy(settingsError = null) }
    }
}
