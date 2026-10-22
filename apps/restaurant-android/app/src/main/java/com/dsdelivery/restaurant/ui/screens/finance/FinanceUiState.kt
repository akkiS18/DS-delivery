package com.dsdelivery.restaurant.ui.screens.finance

import com.dsdelivery.restaurant.data.model.FinanceDateFilter
import com.dsdelivery.restaurant.data.model.FinanceSummary

data class FinanceUiState(
    val isLoading: Boolean = false,
    val selectedFilter: FinanceDateFilter = FinanceDateFilter.TODAY,
    /** Data of [selectedFilter] only; cleared while another range loads or after an error. */
    val summary: FinanceSummary? = null,
    val errorMessage: String? = null
)
