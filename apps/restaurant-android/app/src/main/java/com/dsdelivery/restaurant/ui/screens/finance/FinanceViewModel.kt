package com.dsdelivery.restaurant.ui.screens.finance

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dsdelivery.restaurant.data.model.FinanceDateFilter
import com.dsdelivery.restaurant.data.model.Resource
import com.dsdelivery.restaurant.data.repository.RestaurantRepository
import kotlinx.coroutines.Job
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

class FinanceViewModel(
    private val repository: RestaurantRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(FinanceUiState())
    val uiState: StateFlow<FinanceUiState> = _uiState.asStateFlow()

    private var loadJob: Job? = null

    init {
        loadFinance(FinanceDateFilter.TODAY)
    }

    fun loadFinance(filter: FinanceDateFilter) {
        // A newer request supersedes the old one so a slow response for a previous
        // range can never overwrite the numbers of the selected range.
        loadJob?.cancel()
        _uiState.update {
            it.copy(
                selectedFilter = filter,
                isLoading = true,
                errorMessage = null,
                summary = if (it.selectedFilter == filter) it.summary else null
            )
        }

        loadJob = viewModelScope.launch {
            // Only backend data is ever shown. On failure there are no numbers, just the error.
            val result = repository.getFinanceSummary(filter)
            // The repository turns a cancellation into Resource.Error; a superseded request must not flash an error over the newer one.
            ensureActive()
            when (result) {
                is Resource.Success -> {
                    _uiState.update {
                        it.copy(isLoading = false, summary = result.data, errorMessage = null)
                    }
                }
                is Resource.Error -> {
                    _uiState.update {
                        it.copy(isLoading = false, summary = null, errorMessage = result.message)
                    }
                }
                Resource.Loading -> {}
            }
        }
    }

    fun refresh() = loadFinance(_uiState.value.selectedFilter)
}
