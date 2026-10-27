package com.dsdelivery.restaurant.ui.screens.products

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dsdelivery.restaurant.data.model.Category
import com.dsdelivery.restaurant.data.model.Product
import com.dsdelivery.restaurant.data.model.Resource
import com.dsdelivery.restaurant.data.repository.RestaurantRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

class ProductManagementViewModel(
    private val slug: String,
    private val repository: RestaurantRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(
        ProductManagementUiState(
            slug = slug,
            restaurant = repository.getSessionRestaurant()
        )
    )
    val uiState: StateFlow<ProductManagementUiState> = _uiState.asStateFlow()

    init {
        loadData()
    }

    /** `silent` (pull-down, returning to the app) keeps the current list on screen instead of replacing it with a spinner. */
    fun loadData(silent: Boolean = false) {
        viewModelScope.launch {
            if (!silent) _uiState.update { it.copy(isLoading = true, errorMessage = null) }

            // 1. Fetch real products from server
            val productsResult = repository.getProducts(includeArchived = false)

            // 2. Fetch real categories from server
            val categoriesResult = repository.getCategories()

            if (productsResult is Resource.Success && categoriesResult is Resource.Success) {
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        products = productsResult.data,
                        categories = categoriesResult.data,
                        errorMessage = null,
                        versionConflictProduct = null
                    )
                }
            } else {
                val error = when {
                    productsResult is Resource.Error -> productsResult.message
                    categoriesResult is Resource.Error -> categoriesResult.message
                    else -> "Ma'lumotlarni yuklab bo‘lmadi"
                }
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        errorMessage = error
                    )
                }
            }
        }
    }

    fun selectCategory(categoryId: String?) {
        _uiState.update { it.copy(selectedCategoryId = categoryId) }
    }

    fun onSearchQueryChange(query: String) {
        _uiState.update { it.copy(searchQuery = query) }
    }

    // --- Product Availability Toggle (Stage 5B) ---
    fun toggleAvailability(product: Product) {
        val newStatus = !product.isAvailable
        viewModelScope.launch {
            _uiState.update { it.copy(isActionLoading = true) }
            val result = repository.updateProductAvailability(
                id = product.id,
                isAvailable = newStatus,
                version = product.version
            )

            when (result) {
                is Resource.Success -> {
                    val updated = result.data
                    val currentProducts = _uiState.value.products.toMutableList()
                    val index = currentProducts.indexOfFirst { it.id == updated.id }
                    if (index >= 0) {
                        currentProducts[index] = updated
                    }
                    _uiState.update {
                        it.copy(
                            isActionLoading = false,
                            products = currentProducts,
                            infoMessage = "\"${updated.name}\" holati yangilandi: ${if (updated.isAvailable) "Sotuvda mavjud" else "To‘xtatilgan"}"
                        )
                    }
                }
                is Resource.Error -> {
                    _uiState.update { it.copy(isActionLoading = false) }
                    if (result.message.contains("VERSION_CONFLICT")) {
                        _uiState.update {
                            it.copy(
                                versionConflictProduct = product,
                                errorMessage = result.message
                            )
                        }
                    } else {
                        _uiState.update { it.copy(errorMessage = result.message) }
                    }
                }
                Resource.Loading -> {}
            }
        }
    }

    // --- Product Archive / Delete (Stage 5B) ---
    fun setProductToDelete(product: Product?) {
        _uiState.update { it.copy(productToDelete = product) }
    }

    fun confirmDeleteProduct() {
        val product = _uiState.value.productToDelete ?: return
        viewModelScope.launch {
            _uiState.update { it.copy(isActionLoading = true, productToDelete = null) }
            val result = repository.deleteProduct(product.id)
            when (result) {
                is Resource.Success -> {
                    val current = _uiState.value.products.toMutableList()
                    current.removeAll { it.id == product.id }
                    _uiState.update {
                        it.copy(
                            isActionLoading = false,
                            products = current,
                            infoMessage = "\"${product.name}\" muvaffaqiyatli arxivlandi"
                        )
                    }
                    // Refresh data after mutation
                    loadData()
                }
                is Resource.Error -> {
                    _uiState.update {
                        it.copy(
                            isActionLoading = false,
                            errorMessage = result.message
                        )
                    }
                }
                Resource.Loading -> {}
            }
        }
    }

    // --- Category Management (Stage 5B) ---
    fun showCategoryDialog(show: Boolean) {
        _uiState.update { it.copy(showCategoryDialog = show, categoryErrorMessage = null) }
    }

    fun addCategory(name: String, position: Int?) {
        viewModelScope.launch {
            _uiState.update { it.copy(isActionLoading = true, categoryErrorMessage = null) }
            val result = repository.createCategory(name = name, position = position)
            when (result) {
                is Resource.Success -> {
                    _uiState.update { it.copy(isActionLoading = false) }
                    // Refresh categories
                    refreshCategories()
                }
                is Resource.Error -> {
                    _uiState.update {
                        it.copy(
                            isActionLoading = false,
                            categoryErrorMessage = result.message
                        )
                    }
                }
                Resource.Loading -> {}
            }
        }
    }

    fun editCategory(id: String, name: String, position: Int, version: Int) {
        viewModelScope.launch {
            _uiState.update { it.copy(isActionLoading = true, categoryErrorMessage = null) }
            val result = repository.updateCategory(id, name, position, version)
            when (result) {
                is Resource.Success -> {
                    _uiState.update { it.copy(isActionLoading = false) }
                    refreshCategories()
                }
                is Resource.Error -> {
                    _uiState.update {
                        it.copy(
                            isActionLoading = false,
                            categoryErrorMessage = result.message
                        )
                    }
                }
                Resource.Loading -> {}
            }
        }
    }

    fun deleteCategory(id: String, reassignTo: String?) {
        viewModelScope.launch {
            _uiState.update { it.copy(isActionLoading = true, categoryErrorMessage = null) }
            val result = repository.deleteCategory(id, reassignTo)
            when (result) {
                is Resource.Success -> {
                    _uiState.update { it.copy(isActionLoading = false) }
                    // Reassignment affects products and categories, reload both
                    loadData()
                }
                is Resource.Error -> {
                    _uiState.update {
                        it.copy(
                            isActionLoading = false,
                            categoryErrorMessage = result.message
                        )
                    }
                }
                Resource.Loading -> {}
            }
        }
    }

    /** A photo for a category (the customer menu opens on a grid of categories). The app has already shrunk it. */
    fun setCategoryPhoto(id: String, jpeg: ByteArray) {
        viewModelScope.launch {
            _uiState.update { it.copy(isActionLoading = true, categoryErrorMessage = null) }
            when (val result = repository.uploadCategoryImage(id, jpeg)) {
                is Resource.Success -> { _uiState.update { it.copy(isActionLoading = false) }; refreshCategories() }
                is Resource.Error -> _uiState.update { it.copy(isActionLoading = false, categoryErrorMessage = result.message) }
                Resource.Loading -> {}
            }
        }
    }

    fun removeCategoryPhoto(id: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isActionLoading = true, categoryErrorMessage = null) }
            when (val result = repository.deleteCategoryImage(id)) {
                is Resource.Success -> { _uiState.update { it.copy(isActionLoading = false) }; refreshCategories() }
                is Resource.Error -> _uiState.update { it.copy(isActionLoading = false, categoryErrorMessage = result.message) }
                Resource.Loading -> {}
            }
        }
    }

    fun categoryPhotoProblem(message: String) {
        _uiState.update { it.copy(categoryErrorMessage = message) }
    }

    private suspend fun refreshCategories() {
        when (val result = repository.getCategories()) {
            is Resource.Success -> {
                _uiState.update { it.copy(categories = result.data, categoryErrorMessage = null) }
            }
            is Resource.Error -> {
                _uiState.update { it.copy(categoryErrorMessage = result.message) }
            }
            Resource.Loading -> {}
        }
    }

    // --- Logout ---
    fun logout(onLoggedOut: () -> Unit) {
        viewModelScope.launch {
            repository.logout()
            onLoggedOut()
        }
    }

    fun dismissInfoMessage() {
        _uiState.update { it.copy(infoMessage = null) }
    }

    fun dismissErrorMessage() {
        _uiState.update { it.copy(errorMessage = null, versionConflictProduct = null) }
    }
}
