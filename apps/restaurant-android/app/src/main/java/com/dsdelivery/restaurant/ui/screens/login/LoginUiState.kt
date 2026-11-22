package com.dsdelivery.restaurant.ui.screens.login

import com.dsdelivery.restaurant.data.model.Restaurant

data class LoginUiState(
    /** Empty: staff type their own restaurant code (no pre-filled demo code). */
    val restaurantSlug: String = "",
    val password: String = "",
    val isPasswordVisible: Boolean = false,
    val isLoading: Boolean = false,
    val isRestoringSession: Boolean = true,
    val showServerConfigDialog: Boolean = false,
    val currentBaseUrl: String = "",
    val errorMessage: String? = null,
    val sessionExpiredNotice: String? = null
)
