package com.dsdelivery.restaurant.ui.screens.ratings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dsdelivery.restaurant.data.model.RatingsReport
import com.dsdelivery.restaurant.data.model.Resource
import com.dsdelivery.restaurant.data.repository.RestaurantRepository
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class RatingsUiState(
    val isLoading: Boolean = false,
    /** Backend data only; cleared after an error so no stale numbers are shown as current. */
    val report: RatingsReport? = null,
    val errorMessage: String? = null
)

class RatingsViewModel(
    private val repository: RestaurantRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(RatingsUiState())
    val uiState: StateFlow<RatingsUiState> = _uiState.asStateFlow()

    private var loadJob: Job? = null

    init {
        refresh()
    }

    fun refresh() {
        loadJob?.cancel()
        _uiState.update { it.copy(isLoading = true, errorMessage = null) }
        loadJob = viewModelScope.launch {
            when (val result = repository.getRatings()) {
                is Resource.Success -> _uiState.update { it.copy(isLoading = false, report = result.data, errorMessage = null) }
                is Resource.Error -> _uiState.update { it.copy(isLoading = false, report = null, errorMessage = result.message) }
                Resource.Loading -> {}
            }
        }
    }
}
