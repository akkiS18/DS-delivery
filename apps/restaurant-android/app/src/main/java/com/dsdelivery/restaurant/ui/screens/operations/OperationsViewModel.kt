package com.dsdelivery.restaurant.ui.screens.operations

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dsdelivery.restaurant.data.api.ApiConfig
import com.dsdelivery.restaurant.data.model.CardNumber
import com.dsdelivery.restaurant.data.model.PayeeCard
import com.dsdelivery.restaurant.data.model.PayeeCardStatus
import com.dsdelivery.restaurant.data.model.Resource
import com.dsdelivery.restaurant.data.model.WorkingDay
import com.dsdelivery.restaurant.data.repository.RestaurantRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

class OperationsViewModel(
    private val repository: RestaurantRepository,
    private val apiConfig: ApiConfig
) : ViewModel() {

    private val _uiState = MutableStateFlow(OperationsUiState(currentBaseUrl = apiConfig.baseUrl))
    val uiState: StateFlow<OperationsUiState> = _uiState.asStateFlow()

    init {
        loadOperations()
        loadCards()
    }

    // --- Stage 8B: payee cards ---

    fun loadCards() {
        _uiState.update { it.copy(cardsLoading = true, cardsError = null) }
        viewModelScope.launch {
            when (val result = repository.getCards()) {
                is Resource.Success -> _uiState.update { it.copy(cards = result.data, cardsLoading = false) }
                is Resource.Error -> _uiState.update { it.copy(cardsLoading = false, cardsError = result.message) }
                Resource.Loading -> {}
            }
        }
    }

    fun showAddCard(show: Boolean) {
        _uiState.update { it.copy(showAddCardDialog = show, addCardError = null, addCardBusy = false) }
    }

    /** The number and password go to the server once; nothing about them is kept in the UI state. */
    fun submitCard(digits: String, password: String) {
        val number = CardNumber.digits(digits)
        if (!CardNumber.isValid(number)) {
            _uiState.update { it.copy(addCardError = "Karta raqami noto‘g‘ri.") }
            return
        }
        if (_uiState.value.addCardBusy) return
        _uiState.update { it.copy(addCardBusy = true, addCardError = null) }
        viewModelScope.launch {
            when (val result = repository.addCard(number, password)) {
                is Resource.Success -> {
                    _uiState.update {
                        it.copy(
                            showAddCardDialog = false, addCardBusy = false,
                            infoMessage = "Karta yuborildi. Administrator tasdiqlagach faollashadi."
                        )
                    }
                    loadCards()
                }
                is Resource.Error -> _uiState.update { it.copy(addCardBusy = false, addCardError = result.message) }
                Resource.Loading -> {}
            }
        }
    }

    fun toggleCard(card: PayeeCard) {
        if (_uiState.value.busyCardId != null) return
        val enable = card.status == PayeeCardStatus.DISABLED
        _uiState.update { it.copy(busyCardId = card.id) }
        viewModelScope.launch {
            when (val result = repository.setCardActive(card.id, enable)) {
                is Resource.Success -> {
                    _uiState.update { s ->
                        s.copy(busyCardId = null, cards = s.cards.map { c -> if (c.id == card.id) result.data else c })
                    }
                }
                is Resource.Error -> _uiState.update { it.copy(busyCardId = null, backendNotice = result.message) }
                Resource.Loading -> {}
            }
        }
    }

    fun loadOperations() {
        val restaurant = repository.getSessionRestaurant()
        _uiState.update {
            it.copy(
                restaurantName = restaurant?.name ?: "",
                restaurantSlug = restaurant?.slug ?: "",
                isPaused = restaurant?.isPaused ?: false
            )
        }

        viewModelScope.launch {
            when (val result = repository.getOperationsConfig()) {
                is Resource.Success -> {
                    _uiState.update {
                        it.copy(
                            isPaused = result.data.isPaused,
                            defaultPrepMinutes = result.data.defaultPrepMinutes,
                            workingDays = result.data.workingDays
                        )
                    }
                }
                is Resource.Error -> {
                    _uiState.update { it.copy(errorMessage = result.message) }
                }
                Resource.Loading -> {}
            }
        }
    }

    fun requestTogglePause(newPaused: Boolean) {
        _uiState.update {
            it.copy(
                showPauseConfirmDialog = true,
                pendingPauseState = newPaused
            )
        }
    }

    fun confirmTogglePause() {
        val target = _uiState.value.pendingPauseState
        _uiState.update { it.copy(showPauseConfirmDialog = false) }

        viewModelScope.launch {
            when (val result = repository.updateRestaurantStatus(target)) {
                is Resource.Success -> {
                    _uiState.update {
                        it.copy(
                            isPaused = target,
                            infoMessage = if (target) "Restoran vaqtincha to‘xtatildi (Pauza)" else "Restoran faollashtirildi"
                        )
                    }
                }
                is Resource.Error -> {
                    _uiState.update {
                        it.copy(
                            backendNotice = result.message
                        )
                    }
                }
                Resource.Loading -> {}
            }
        }
    }

    fun dismissPauseDialog() {
        _uiState.update { it.copy(showPauseConfirmDialog = false) }
    }

    fun onPrepMinutesChange(minutes: Int) {
        val previous = _uiState.value.defaultPrepMinutes
        _uiState.update { it.copy(defaultPrepMinutes = minutes) }
        viewModelScope.launch {
            when (val result = repository.updateDefaultPrepMinutes(minutes)) {
                is Resource.Success -> {}
                is Resource.Error -> {
                    // Not saved on the server: do not keep showing it as the active setting.
                    _uiState.update { it.copy(defaultPrepMinutes = previous, backendNotice = result.message) }
                }
                Resource.Loading -> {}
            }
        }
    }

    fun onEditWorkingDay(day: WorkingDay) {
        _uiState.update { it.copy(editingWorkingDay = day) }
    }

    fun dismissWorkingDayDialog() {
        _uiState.update { it.copy(editingWorkingDay = null) }
    }

    fun onSaveWorkingDay(updated: WorkingDay) {
        val previousDays = _uiState.value.workingDays
        val currentDays = previousDays.toMutableList()
        val index = currentDays.indexOfFirst { it.dayOfWeek == updated.dayOfWeek }
        if (index >= 0) {
            currentDays[index] = updated
        }
        _uiState.update { it.copy(workingDays = currentDays, editingWorkingDay = null) }

        viewModelScope.launch {
            when (val result = repository.updateWorkingHours(currentDays)) {
                is Resource.Success -> {
                    _uiState.update { it.copy(infoMessage = "Ish vaqti saqlandi") }
                }
                is Resource.Error -> {
                    // Not saved on the server: restore the previous schedule.
                    _uiState.update { it.copy(workingDays = previousDays, backendNotice = result.message) }
                }
                Resource.Loading -> {}
            }
        }
    }

    fun showServerConfig(show: Boolean) {
        _uiState.update { it.copy(showServerConfigDialog = show) }
    }

    fun updateBaseUrl(url: String) {
        val error = ApiConfig.validationError(url)
        if (error != null) {
            _uiState.update { it.copy(showServerConfigDialog = false, errorMessage = error, backendNotice = error) }
            return
        }
        apiConfig.baseUrl = url
        _uiState.update {
            it.copy(
                showServerConfigDialog = false,
                currentBaseUrl = apiConfig.baseUrl,
                infoMessage = "Server URL yangilandi: ${apiConfig.baseUrl}"
            )
        }
    }

    fun showLogoutDialog(show: Boolean) {
        _uiState.update { it.copy(showLogoutConfirmDialog = show) }
    }

    fun logout(onLoggedOut: () -> Unit) {
        viewModelScope.launch {
            repository.logout()
            onLoggedOut()
        }
    }

    fun dismissNotice() {
        _uiState.update { it.copy(backendNotice = null) }
    }

    fun dismissInfo() {
        _uiState.update { it.copy(infoMessage = null) }
    }

    fun dismissError() {
        _uiState.update { it.copy(errorMessage = null) }
    }
}
