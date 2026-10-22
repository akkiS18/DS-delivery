package com.dsdelivery.restaurant.ui.screens.menu

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dsdelivery.restaurant.data.api.ApiConfig
import com.dsdelivery.restaurant.data.model.Resource
import com.dsdelivery.restaurant.data.repository.RestaurantRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

class MenuViewModel(
    private val slug: String,
    private val repository: RestaurantRepository,
    private val apiConfig: ApiConfig
) : ViewModel() {

    private val _uiState = MutableStateFlow(
        MenuUiState(slug = slug, currentBaseUrl = apiConfig.baseUrl)
    )
    val uiState: StateFlow<MenuUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            apiConfig.baseUrlFlow.collect { url ->
                _uiState.update { it.copy(currentBaseUrl = url) }
            }
        }
        loadMenu(isRefresh = false)
    }

    fun loadMenu(isRefresh: Boolean = false) {
        viewModelScope.launch {
            if (isRefresh) {
                _uiState.update { it.copy(isRefreshing = true, errorMessage = null) }
            } else {
                _uiState.update { it.copy(isLoading = true, errorMessage = null) }
            }

            when (val result = repository.getPublicMenu(slug)) {
                is Resource.Success -> {
                    val menu = result.data
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            isRefreshing = false,
                            restaurant = menu.restaurant,
                            categories = menu.categories,
                            products = menu.products,
                            errorMessage = null
                        )
                    }
                }
                is Resource.Error -> {
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            isRefreshing = false,
                            errorMessage = result.message
                        )
                    }
                }
                Resource.Loading -> {
                    // Handled above
                }
            }
        }
    }

    fun selectCategory(categoryId: String?) {
        _uiState.update { it.copy(selectedCategoryId = categoryId) }
    }

    fun showServerConfig(show: Boolean) {
        _uiState.update { it.copy(showServerConfigDialog = show) }
    }

    fun updateBaseUrl(newUrl: String) {
        apiConfig.baseUrl = newUrl
        loadMenu(isRefresh = true)
    }
}
