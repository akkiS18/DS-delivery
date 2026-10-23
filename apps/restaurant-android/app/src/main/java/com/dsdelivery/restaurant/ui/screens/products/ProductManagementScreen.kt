package com.dsdelivery.restaurant.ui.screens.products

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Category
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.dsdelivery.restaurant.data.model.Product
import com.dsdelivery.restaurant.ui.components.CategoryChipRow
import com.dsdelivery.restaurant.ui.components.CategoryManagementDialog
import com.dsdelivery.restaurant.ui.components.EmptyView
import com.dsdelivery.restaurant.ui.components.ErrorView
import com.dsdelivery.restaurant.ui.components.LoadingView
import com.dsdelivery.restaurant.ui.components.ProductCard
import com.dsdelivery.restaurant.ui.components.PullRefresh
import com.dsdelivery.restaurant.ui.preview.SampleData
import com.dsdelivery.restaurant.ui.theme.BrandPrimary
import com.dsdelivery.restaurant.ui.theme.DSRestaurantTheme
import com.dsdelivery.restaurant.ui.theme.ErrorRed

@Composable
fun ProductManagementScreen(
    viewModel: ProductManagementViewModel,
    onNavigateBack: () -> Unit,
    onNavigateToCreateProduct: () -> Unit,
    onNavigateToEditProduct: (productId: String) -> Unit,
    onLoggedOut: () -> Unit,
    modifier: Modifier = Modifier
) {
    val state by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }
    var showLogoutDialog by remember { mutableStateOf(false) }

    LaunchedEffect(state.infoMessage) {
        state.infoMessage?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.dismissInfoMessage()
        }
    }

    ProductManagementContent(
        state = state,
        snackbarHostState = snackbarHostState,
        onNavigateBack = onNavigateBack,
        onRefresh = { viewModel.loadData(silent = true) },
        onSearchQueryChange = viewModel::onSearchQueryChange,
        onCategorySelected = viewModel::selectCategory,
        onToggleAvailability = viewModel::toggleAvailability,
        onNavigateToCreateProduct = onNavigateToCreateProduct,
        onNavigateToEditProduct = onNavigateToEditProduct,
        onOpenCategoryDialog = { viewModel.showCategoryDialog(true) },
        onCloseCategoryDialog = { viewModel.showCategoryDialog(false) },
        onAddCategory = viewModel::addCategory,
        onEditCategory = viewModel::editCategory,
        onDeleteCategory = viewModel::deleteCategory,
        onInitiateDeleteProduct = viewModel::setProductToDelete,
        onConfirmDeleteProduct = viewModel::confirmDeleteProduct,
        onCancelDeleteProduct = { viewModel.setProductToDelete(null) },
        onOpenLogoutDialog = { showLogoutDialog = true },
        onDismissConflictDialog = viewModel::dismissErrorMessage,
        modifier = modifier
    )

    if (showLogoutDialog) {
        AlertDialog(
            onDismissRequest = { showLogoutDialog = false },
            icon = {
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.Logout,
                    contentDescription = null,
                    tint = BrandPrimary
                )
            },
            title = { Text("Tizimdan chiqish") },
            text = { Text("Haqiqatan ham restoran sessiyasidan chiqmoqchimisiz?") },
            confirmButton = {
                Button(
                    onClick = {
                        showLogoutDialog = false
                        viewModel.logout(onLoggedOut)
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = ErrorRed)
                ) {
                    Text("Chiqish")
                }
            },
            dismissButton = {
                TextButton(onClick = { showLogoutDialog = false }) {
                    Text("Bekor qilish")
                }
            }
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProductManagementContent(
    state: ProductManagementUiState,
    snackbarHostState: SnackbarHostState,
    onNavigateBack: () -> Unit,
    onRefresh: () -> Unit,
    onSearchQueryChange: (String) -> Unit,
    onCategorySelected: (String?) -> Unit,
    onToggleAvailability: (Product) -> Unit,
    onNavigateToCreateProduct: () -> Unit,
    onNavigateToEditProduct: (productId: String) -> Unit,
    onOpenCategoryDialog: () -> Unit,
    onCloseCategoryDialog: () -> Unit,
    onAddCategory: (name: String, position: Int?) -> Unit,
    onEditCategory: (id: String, name: String, position: Int, version: Int) -> Unit,
    onDeleteCategory: (id: String, reassignTo: String?) -> Unit,
    onInitiateDeleteProduct: (Product) -> Unit,
    onConfirmDeleteProduct: () -> Unit,
    onCancelDeleteProduct: () -> Unit,
    onOpenLogoutDialog: () -> Unit,
    onDismissConflictDialog: () -> Unit,
    modifier: Modifier = Modifier
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = "Menyu",
                        style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold)
                    )
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = BrandPrimary,
                    titleContentColor = Color.White,
                    actionIconContentColor = Color.White
                )
            )
        },
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = onNavigateToCreateProduct,
                icon = { Icon(Icons.Default.Add, contentDescription = null) },
                text = { Text("Yangi taom", fontWeight = FontWeight.SemiBold) },
                containerColor = BrandPrimary,
                contentColor = Color.White
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
        modifier = modifier
    ) { innerPadding ->
        PullRefresh(
            isRefreshing = state.isLoading,
            onRefresh = onRefresh,
            modifier = Modifier.fillMaxSize().padding(innerPadding).background(MaterialTheme.colorScheme.background)
        ) {
        Box(modifier = Modifier.fillMaxSize()) {
            when {
                state.isLoading && state.products.isEmpty() -> {
                    LoadingView(message = "Yuklanmoqda...")
                }

                state.errorMessage != null && state.products.isEmpty() -> {
                    ErrorView(
                        message = state.errorMessage,
                        onRetry = onRefresh
                    )
                }

                else -> {
                    Column(modifier = Modifier.fillMaxSize()) {
                        // Search Bar
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 16.dp, vertical = 8.dp)
                        ) {
                            OutlinedTextField(
                                value = state.searchQuery,
                                onValueChange = onSearchQueryChange,
                                placeholder = { Text("Qidirish") },
                                leadingIcon = {
                                    Icon(
                                        imageVector = Icons.Default.Search,
                                        contentDescription = null,
                                        tint = BrandPrimary
                                    )
                                },
                                trailingIcon = {
                                    if (state.searchQuery.isNotEmpty()) {
                                        IconButton(onClick = { onSearchQueryChange("") }) {
                                            Icon(imageVector = Icons.Default.Clear, contentDescription = "Tozalash")
                                        }
                                    }
                                },
                                singleLine = true,
                                shape = RoundedCornerShape(12.dp),
                                modifier = Modifier.fillMaxWidth()
                            )
                        }

                        // Category Chips Row
                        if (state.categories.isNotEmpty()) {
                            CategoryChipRow(
                                categories = state.categories,
                                selectedCategoryId = state.selectedCategoryId,
                                onCategorySelected = onCategorySelected
                            )
                        }

                        // Products Count & Category Action Indicator
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 16.dp, vertical = 4.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = "${state.filteredProducts.size} ta taom",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )

                            TextButton(onClick = onOpenCategoryDialog) {
                                Icon(
                                    imageVector = Icons.Default.Category,
                                    contentDescription = null,
                                    modifier = Modifier.size(18.dp)
                                )
                                Spacer(modifier = Modifier.width(6.dp))
                                Text("Toifalar")
                            }
                        }

                        // Products List
                        if (state.filteredProducts.isEmpty()) {
                            // A scrollable (empty) list, so the pull-down gesture also works on an empty menu.
                            LazyColumn(modifier = Modifier.fillMaxSize()) {
                                item {
                                    EmptyView(
                                        title = if (state.searchQuery.isNotEmpty()) "Hech narsa topilmadi" else "Menyu bo‘sh",
                                        subtitle = null,
                                        modifier = Modifier.fillParentMaxSize()
                                    )
                                }
                            }
                        } else {
                            LazyColumn(
                                modifier = Modifier.fillMaxSize(),
                                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 88.dp),
                                verticalArrangement = Arrangement.spacedBy(10.dp)
                            ) {
                                items(
                                    items = state.filteredProducts,
                                    key = { it.id }
                                ) { product ->
                                    ProductCard(
                                        product = product,
                                        showManagementActions = true,
                                        onEditClick = { onNavigateToEditProduct(product.id) },
                                        onDeleteClick = { onInitiateDeleteProduct(product) },
                                        onToggleAvailability = {
                                            onToggleAvailability(product)
                                        }
                                    )
                                }
                            }
                        }
                    }
                }
            }

            // Category Management Dialog
            if (state.showCategoryDialog) {
                CategoryManagementDialog(
                    categories = state.categories,
                    onDismiss = onCloseCategoryDialog,
                    onAddCategory = onAddCategory,
                    onEditCategory = onEditCategory,
                    onDeleteCategory = onDeleteCategory,
                    isLoading = state.isActionLoading,
                    errorMessage = state.categoryErrorMessage
                )
            }

            // Version Conflict Alert Dialog
            if (state.versionConflictProduct != null) {
                AlertDialog(
                    onDismissRequest = onDismissConflictDialog,
                    icon = {
                        Icon(
                            imageVector = Icons.Default.Warning,
                            contentDescription = null,
                            tint = ErrorRed,
                            modifier = Modifier.size(36.dp)
                        )
                    },
                    title = { Text("Boshqa joyda o‘zgartirilgan", fontWeight = FontWeight.Bold) },
                    text = {
                        Text("Ro‘yxatni yangilang va qayta urinib ko‘ring.")
                    },
                    confirmButton = {
                        Button(
                            onClick = {
                                onDismissConflictDialog()
                                onRefresh()
                            },
                            colors = ButtonDefaults.buttonColors(containerColor = BrandPrimary)
                        ) {
                            Text("Yangilash")
                        }
                    },
                    dismissButton = {
                        TextButton(onClick = onDismissConflictDialog) {
                            Text("Yopish")
                        }
                    }
                )
            }

            // Delete / Archive Product Confirmation Dialog
            if (state.productToDelete != null) {
                AlertDialog(
                    onDismissRequest = onCancelDeleteProduct,
                    icon = {
                        Icon(
                            imageVector = Icons.Default.Warning,
                            contentDescription = null,
                            tint = ErrorRed
                        )
                    },
                    title = { Text("Menyudan olib tashlaysizmi?") },
                    text = {
                        Text("\"${state.productToDelete?.name}\" mijozlarga ko‘rinmaydi. Buyurtmalar tarixi saqlanadi.")
                    },
                    confirmButton = {
                        Button(
                            onClick = onConfirmDeleteProduct,
                            colors = ButtonDefaults.buttonColors(containerColor = ErrorRed)
                        ) {
                            Text("Olib tashlash")
                        }
                    },
                    dismissButton = {
                        TextButton(onClick = onCancelDeleteProduct) {
                            Text("Yopish")
                        }
                    }
                )
            }
        }
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun ProductManagementScreenPreview() {
    DSRestaurantTheme {
        ProductManagementContent(
            state = ProductManagementUiState(
                slug = "demo-restoran",
                isLoading = false,
                restaurant = SampleData.sampleRestaurant,
                categories = SampleData.sampleCategories,
                products = SampleData.sampleProducts
            ),
            snackbarHostState = remember { SnackbarHostState() },
            onNavigateBack = {},
            onRefresh = {},
            onSearchQueryChange = {},
            onCategorySelected = {},
            onToggleAvailability = {},
            onNavigateToCreateProduct = {},
            onNavigateToEditProduct = {},
            onOpenCategoryDialog = {},
            onCloseCategoryDialog = {},
            onAddCategory = { _, _ -> },
            onEditCategory = { _, _, _, _ -> },
            onDeleteCategory = { _, _ -> },
            onInitiateDeleteProduct = {},
            onConfirmDeleteProduct = {},
            onCancelDeleteProduct = {},
            onOpenLogoutDialog = {},
            onDismissConflictDialog = {}
        )
    }
}
