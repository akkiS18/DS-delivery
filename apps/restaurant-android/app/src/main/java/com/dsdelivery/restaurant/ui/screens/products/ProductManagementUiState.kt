package com.dsdelivery.restaurant.ui.screens.products

import com.dsdelivery.restaurant.data.model.Category
import com.dsdelivery.restaurant.data.model.Product
import com.dsdelivery.restaurant.data.model.Restaurant

data class ProductManagementUiState(
    val slug: String,
    val isLoading: Boolean = true,
    val isActionLoading: Boolean = false,
    val restaurant: Restaurant? = null,
    val categories: List<Category> = emptyList(),
    val products: List<Product> = emptyList(),
    val selectedCategoryId: String? = null,
    val searchQuery: String = "",
    val showCategoryDialog: Boolean = false,
    val categoryErrorMessage: String? = null,
    val productToDelete: Product? = null,
    val versionConflictProduct: Product? = null,
    val errorMessage: String? = null,
    val infoMessage: String? = null
) {
    val filteredProducts: List<Product>
        get() = products
            .filter { product ->
                val matchesCategory = selectedCategoryId == null || product.categoryId == selectedCategoryId
                val matchesSearch = searchQuery.isBlank() || product.name.contains(searchQuery, ignoreCase = true) || (product.description?.contains(searchQuery, ignoreCase = true) == true)
                matchesCategory && matchesSearch
            }
}
