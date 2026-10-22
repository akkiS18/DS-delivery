package com.dsdelivery.restaurant.ui.screens.login

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dsdelivery.restaurant.data.api.ApiConfig
import com.dsdelivery.restaurant.data.model.Resource
import com.dsdelivery.restaurant.data.model.Restaurant
import com.dsdelivery.restaurant.data.repository.RestaurantRepository
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

class LoginViewModel(
    private val apiConfig: ApiConfig,
    private val repository: RestaurantRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(
        LoginUiState(currentBaseUrl = apiConfig.baseUrl)
    )
    val uiState: StateFlow<LoginUiState> = _uiState.asStateFlow()

    private val _navigationEvents = MutableSharedFlow<Restaurant>()
    val navigationEvents: SharedFlow<Restaurant> = _navigationEvents.asSharedFlow()

    init {
        viewModelScope.launch {
            apiConfig.baseUrlFlow.collect { url ->
                _uiState.update { it.copy(currentBaseUrl = url) }
            }
        }
        checkExistingSession()
    }

    private fun checkExistingSession() {
        viewModelScope.launch {
            _uiState.update { it.copy(isRestoringSession = true) }
            when (val result = repository.restoreSession()) {
                is Resource.Success -> {
                    _uiState.update { it.copy(isRestoringSession = false) }
                    _navigationEvents.emit(result.data)
                }
                is Resource.Error -> {
                    val message = if (repository.isLoggedIn()) {
                        "Sessiya muddati tugagan yoki server tomonidan bekor qilingan."
                    } else null

                    _uiState.update {
                        it.copy(
                            isRestoringSession = false,
                            sessionExpiredNotice = message
                        )
                    }
                }
                Resource.Loading -> {}
            }
        }
    }

    fun onSlugChanged(slug: String) {
        _uiState.update { it.copy(restaurantSlug = slug.trim().lowercase(), errorMessage = null) }
    }

    fun onPasswordChanged(password: String) {
        _uiState.update { it.copy(password = password, errorMessage = null) }
    }

    fun togglePasswordVisibility() {
        _uiState.update { it.copy(isPasswordVisible = !it.isPasswordVisible) }
    }

    fun onLoginClick() {
        val current = _uiState.value
        val slug = current.restaurantSlug.trim().lowercase()
        val password = current.password

        if (slug.length !in 2..40 || !slug.matches(Regex("^[a-z0-9-]+$"))) {
            _uiState.update {
                it.copy(errorMessage = "Restoran slug formati noto‘g‘ri (2-40 kichik lotin harflari, raqamlar va chiziqcha)")
            }
            return
        }

        if (password.isEmpty() || password.length > 200) {
            _uiState.update {
                it.copy(errorMessage = "Xodim parolini kiriting (1-200 belgi)")
            }
            return
        }

        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, errorMessage = null, sessionExpiredNotice = null) }
            when (val result = repository.login(slug, password)) {
                is Resource.Success -> {
                    _uiState.update { it.copy(isLoading = false) }
                    _navigationEvents.emit(result.data)
                }
                is Resource.Error -> {
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            errorMessage = result.message
                        )
                    }
                }
                Resource.Loading -> {}
            }
        }
    }

    fun dismissSessionNotice() {
        _uiState.update { it.copy(sessionExpiredNotice = null) }
    }

    fun showServerConfig(show: Boolean) {
        _uiState.update { it.copy(showServerConfigDialog = show) }
    }

    fun updateBaseUrl(newUrl: String) {
        apiConfig.baseUrl = newUrl
        _uiState.update { it.copy(currentBaseUrl = apiConfig.baseUrl) }
    }
}
