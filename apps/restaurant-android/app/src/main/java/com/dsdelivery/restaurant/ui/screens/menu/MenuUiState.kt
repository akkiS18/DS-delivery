package com.dsdelivery.restaurant.ui.screens.menu

import com.dsdelivery.restaurant.data.model.Category
import com.dsdelivery.restaurant.data.model.Product
import com.dsdelivery.restaurant.data.model.Restaurant

data class MenuUiState(
    val slug: String,
    val isLoading: Boolean = true,
    val isRefreshing: Boolean = false,
    val restaurant: Restaurant? = null,
    val categories: List<Category> = emptyList(),
    val products: List<Product> = emptyList(),
    val selectedCategoryId: String? = null,
    val errorMessage: String? = null,
    val showServerConfigDialog: Boolean = false,
    val currentBaseUrl: String = ""
) {
    val filteredProducts: List<Product>
        get() = if (selectedCategoryId == null) {
            products
        } else {
            products.filter { it.categoryId == selectedCategoryId }
        }
}
