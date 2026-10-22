package com.dsdelivery.restaurant.ui.screens.products.form

import com.dsdelivery.restaurant.data.model.Category

data class ProductFormUiState(
    val slug: String,
    val productId: String? = null,
    val isEditMode: Boolean = false,
    val version: Int = 1,
    val name: String = "",
    val priceInput: String = "",
    val description: String = "",
    val categoryId: String? = null,
    val isAvailable: Boolean = true,
    val imageUrl: String? = null,
    val categories: List<Category> = emptyList(),
    val nameError: String? = null,
    val priceError: String? = null,
    val isSubmitting: Boolean = false,
    val isLoadingProduct: Boolean = false,
    val isVersionConflict: Boolean = false,
    val errorMessage: String? = null
) {
    val isFormValid: Boolean
        get() = name.trim().length in 2..100 &&
                (priceInput.toIntOrNull() ?: -1) in 100..100_000_000
}
