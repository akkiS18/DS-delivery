package com.dsdelivery.restaurant.ui.screens.login

import com.dsdelivery.restaurant.data.model.Restaurant

data class LoginUiState(
    val restaurantSlug: String = "demo-restoran",
    val password: String = "",
    val isPasswordVisible: Boolean = false,
    val isLoading: Boolean = false,
    val isRestoringSession: Boolean = true,
    val showServerConfigDialog: Boolean = false,
    val currentBaseUrl: String = "",
    val errorMessage: String? = null,
    val sessionExpiredNotice: String? = null
)
