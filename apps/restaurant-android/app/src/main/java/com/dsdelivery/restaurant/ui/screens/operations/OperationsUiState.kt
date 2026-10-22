package com.dsdelivery.restaurant.ui.screens.operations

import com.dsdelivery.restaurant.data.model.RestaurantOperationsConfig
import com.dsdelivery.restaurant.data.model.WorkingDay

data class OperationsUiState(
    val isLoading: Boolean = false,
    val restaurantName: String = "",
    val restaurantSlug: String = "",
    val currentBaseUrl: String = "",
    val pickupAddress: String? = null,
    val pickupPhone: String? = null,
    val isPaused: Boolean = false,
    val defaultPrepMinutes: Int = 25,
    val workingDays: List<WorkingDay> = RestaurantOperationsConfig.defaultWorkingDays(),
    val showPauseConfirmDialog: Boolean = false,
    val pendingPauseState: Boolean = false,
    val editingWorkingDay: WorkingDay? = null,
    val showServerConfigDialog: Boolean = false,
    val showLogoutConfirmDialog: Boolean = false,
    val infoMessage: String? = null,
    val errorMessage: String? = null,
    val backendNotice: String? = null
)
