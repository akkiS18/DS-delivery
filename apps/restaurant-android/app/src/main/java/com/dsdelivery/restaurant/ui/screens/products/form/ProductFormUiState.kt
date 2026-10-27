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
    /** The photo the server holds, as a full address (null = none). */
    val imageUrl: String? = null,
    /** A photo picked while creating a dish: uploaded right after the dish is saved. */
    val pendingImage: ByteArray? = null,
    val imageBusy: Boolean = false,
    val imageNotice: String? = null,
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
