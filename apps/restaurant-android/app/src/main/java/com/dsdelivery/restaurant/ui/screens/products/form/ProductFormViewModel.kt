package com.dsdelivery.restaurant.ui.screens.products.form

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dsdelivery.restaurant.data.model.Resource
import com.dsdelivery.restaurant.data.repository.RestaurantRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

class ProductFormViewModel(
    private val slug: String,
    private val productId: String?,
    private val repository: RestaurantRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(
        ProductFormUiState(
            slug = slug,
            productId = productId,
            isEditMode = productId != null
        )
    )
    val uiState: StateFlow<ProductFormUiState> = _uiState.asStateFlow()

    init {
        loadInitialData()
    }

    fun loadInitialData() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoadingProduct = true, errorMessage = null, isVersionConflict = false) }

            // 1. Load categories
            when (val catResult = repository.getCategories()) {
                is Resource.Success -> {
                    _uiState.update { it.copy(categories = catResult.data) }
                }
                is Resource.Error -> {
                    _uiState.update { it.copy(errorMessage = catResult.message) }
                }
                Resource.Loading -> {}
            }

            // 2. If editing, load the product to get latest version
            if (productId != null) {
                when (val prodResult = repository.getProducts(includeArchived = false)) {
                    is Resource.Success -> {
                        val product = prodResult.data.find { it.id == productId }
                        if (product != null) {
                            _uiState.update { current ->
                                current.copy(
                                    isLoadingProduct = false,
                                    name = product.name,
                                    priceInput = product.priceSom.toString(),
                                    description = product.description ?: "",
                                    categoryId = product.categoryId,
                                    isAvailable = product.isAvailable,
                                    imageUrl = product.imageUrl,
                                    version = product.version
                                )
                            }
                        } else {
                            _uiState.update {
                                it.copy(
                                    isLoadingProduct = false,
                                    errorMessage = "Mahsulot serverda topilmadi yoki arxivlangan."
                                )
                            }
                        }
                    }
                    is Resource.Error -> {
                        _uiState.update {
                            it.copy(
                                isLoadingProduct = false,
                                errorMessage = prodResult.message
                            )
                        }
                    }
                    Resource.Loading -> {}
                }
            } else {
                _uiState.update {
                    it.copy(
                        isLoadingProduct = false,
                        categoryId = it.categoryId ?: it.categories.firstOrNull()?.id
                    )
                }
            }
        }
    }

    fun onNameChange(name: String) {
        _uiState.update { it.copy(name = name, nameError = null) }
    }

    fun onPriceChange(price: String) {
        val filtered = price.filter { it.isDigit() }
        _uiState.update { it.copy(priceInput = filtered, priceError = null) }
    }

    fun onDescriptionChange(desc: String) {
        if (desc.length <= 1000) {
            _uiState.update { it.copy(description = desc) }
        }
    }

    fun onCategoryChange(categoryId: String?) {
        _uiState.update { it.copy(categoryId = categoryId) }
    }

    fun onAvailabilityChange(isAvailable: Boolean) {
        _uiState.update { it.copy(isAvailable = isAvailable) }
    }

    private fun validate(): Boolean {
        val current = _uiState.value
        var isValid = true

        val trimmedName = current.name.trim()
        if (trimmedName.length < 2 || trimmedName.length > 100) {
            _uiState.update {
                it.copy(nameError = "Mahsulot nomi 2 tadan 100 tagacha belgidan iborat bo‘lishi shart")
            }
            isValid = false
        }

        val price = current.priceInput.toIntOrNull()
        if (price == null || price < 100 || price > 100_000_000) {
            _uiState.update {
                it.copy(priceError = "Narx 100 dan 100 000 000 so‘mgacha bo‘lishi kerak")
            }
            isValid = false
        }

        return isValid
    }

    // --- Real Stage 5B Server Save ---
    fun saveProduct(onSuccess: () -> Unit) {
        if (!validate()) return

        val current = _uiState.value
        val name = current.name.trim()
        val price = current.priceInput.toInt()
        val description = current.description.trim().ifBlank { null }
        val categoryId = current.categoryId
        val isAvailable = current.isAvailable

        viewModelScope.launch {
            _uiState.update { it.copy(isSubmitting = true, errorMessage = null, isVersionConflict = false) }

            val result = if (current.isEditMode) {
                repository.updateProduct(
                    id = current.productId!!,
                    name = name,
                    priceSom = price,
                    description = description,
                    categoryId = categoryId,
                    version = current.version
                )
            } else {
                repository.createProduct(
                    name = name,
                    priceSom = price,
                    description = description,
                    categoryId = categoryId,
                    isAvailable = isAvailable
                )
            }

            when (result) {
                is Resource.Success -> {
                    _uiState.update { it.copy(isSubmitting = false) }
                    onSuccess()
                }
                is Resource.Error -> {
                    val isConflict = result.message.contains("VERSION_CONFLICT")
                    _uiState.update {
                        it.copy(
                            isSubmitting = false,
                            errorMessage = result.message,
                            isVersionConflict = isConflict
                        )
                    }
                }
                Resource.Loading -> {}
            }
        }
    }

    fun dismissError() {
        _uiState.update { it.copy(errorMessage = null, isVersionConflict = false) }
    }
}
