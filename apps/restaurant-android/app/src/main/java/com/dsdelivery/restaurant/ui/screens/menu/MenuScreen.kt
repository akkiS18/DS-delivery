package com.dsdelivery.restaurant.ui.screens.menu

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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Inventory
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.dsdelivery.restaurant.ui.components.CategoryChipRow
import com.dsdelivery.restaurant.ui.components.EmptyView
import com.dsdelivery.restaurant.ui.components.ErrorView
import com.dsdelivery.restaurant.ui.components.LoadingView
import com.dsdelivery.restaurant.ui.components.ProductCard
import com.dsdelivery.restaurant.ui.components.ServerConfigDialog
import com.dsdelivery.restaurant.ui.components.StatusBadge
import com.dsdelivery.restaurant.ui.preview.SampleData
import com.dsdelivery.restaurant.ui.theme.BrandPrimary
import com.dsdelivery.restaurant.ui.theme.DSRestaurantTheme

@Composable
fun MenuScreen(
    viewModel: MenuViewModel,
    onNavigateBack: () -> Unit,
    onNavigateToManagement: () -> Unit,
    onNavigateToEditProduct: (productId: String) -> Unit,
    modifier: Modifier = Modifier
) {
    val state by viewModel.uiState.collectAsState()

    MenuContent(
        state = state,
        onNavigateBack = onNavigateBack,
        onNavigateToManagement = onNavigateToManagement,
        onNavigateToEditProduct = onNavigateToEditProduct,
        onRefresh = { viewModel.loadMenu(isRefresh = true) },
        onCategorySelected = viewModel::selectCategory,
        onOpenServerConfig = { viewModel.showServerConfig(true) },
        onCloseServerConfig = { viewModel.showServerConfig(false) },
        onSaveServerUrl = viewModel::updateBaseUrl,
        onRetry = { viewModel.loadMenu(isRefresh = false) },
        modifier = modifier
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MenuContent(
    state: MenuUiState,
    onNavigateBack: () -> Unit,
    onNavigateToManagement: () -> Unit,
    onNavigateToEditProduct: (productId: String) -> Unit,
    onRefresh: () -> Unit,
    onCategorySelected: (String?) -> Unit,
    onOpenServerConfig: () -> Unit,
    onCloseServerConfig: () -> Unit,
    onSaveServerUrl: (String) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                text = state.restaurant?.name ?: "Restoran menyusi",
                                style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                            state.restaurant?.let { rest ->
                                Spacer(modifier = Modifier.width(8.dp))
                                StatusBadge(isPaused = rest.isPaused)
                            }
                        }
                        Text(
                            text = "Slug: ${state.slug}",
                            style = MaterialTheme.typography.bodySmall,
                            color = Color.White.copy(alpha = 0.8f)
                        )
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "Ortga",
                            tint = Color.White
                        )
                    }
                },
                actions = {
                    // Navigate to Product Management
                    IconButton(onClick = onNavigateToManagement) {
                        Icon(
                            imageVector = Icons.Default.Inventory,
                            contentDescription = "Mahsulotlar boshqaruvi",
                            tint = Color.White
                        )
                    }
                    // Server config shortcut
                    IconButton(onClick = onOpenServerConfig) {
                        Icon(
                            imageVector = Icons.Default.Dns,
                            contentDescription = "Server sozlamasi",
                            tint = Color.White
                        )
                    }
                    // Refresh button
                    IconButton(onClick = onRefresh, enabled = !state.isLoading && !state.isRefreshing) {
                        if (state.isRefreshing) {
                            CircularProgressIndicator(
                                color = Color.White,
                                modifier = Modifier.size(20.dp),
                                strokeWidth = 2.dp
                            )
                        } else {
                            Icon(
                                imageVector = Icons.Default.Refresh,
                                contentDescription = "Yangilash",
                                tint = Color.White
                            )
                        }
                    }
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
                onClick = onNavigateToManagement,
                icon = { Icon(Icons.Default.Edit, contentDescription = null) },
                text = { Text("Boshqaruv", fontWeight = FontWeight.SemiBold) },
                containerColor = BrandPrimary,
                contentColor = Color.White
            )
        },
        modifier = modifier
    ) { innerPadding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .background(MaterialTheme.colorScheme.background)
        ) {
            when {
                // Initial Loading State
                state.isLoading -> {
                    LoadingView(message = "Restoran menyusi yuklanmoqda...")
                }

                // Error State
                state.errorMessage != null -> {
                    ErrorView(
                        message = state.errorMessage,
                        onRetry = onRetry,
                        onOpenSettings = onOpenServerConfig
                    )
                }

                // Empty Restaurant Menu (no products at all)
                state.products.isEmpty() -> {
                    EmptyView(
                        title = "Ushbu restoranda mahsulotlar mavjud emas",
                        subtitle = "Mahsulot qo‘shish uchun 'Boshqaruv' tugmasidan foydalaning."
                    )
                }

                // Loaded Menu
                else -> {
                    Column(modifier = Modifier.fillMaxSize()) {
                        // Category Selector
                        if (state.categories.isNotEmpty()) {
                            CategoryChipRow(
                                categories = state.categories,
                                selectedCategoryId = state.selectedCategoryId,
                                onCategorySelected = onCategorySelected
                            )
                        }

                        // Products Count Indicator
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 16.dp, vertical = 4.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = "Mahsulotlar (${state.filteredProducts.size})",
                                style = MaterialTheme.typography.labelLarge,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                fontWeight = FontWeight.SemiBold
                            )
                        }

                        Spacer(modifier = Modifier.height(4.dp))

                        // Filtered Empty State (category selected but no products match)
                        if (state.filteredProducts.isEmpty()) {
                            EmptyView(
                                title = "Tanlangan toifada mahsulot topilmadi",
                                subtitle = "Boshqa toifani tanlang yoki barcha mahsulotlarni ko‘ring."
                            )
                        } else {
                            // Product Cards List
                            LazyColumn(
                                modifier = Modifier.fillMaxSize(),
                                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 88.dp),
                                verticalArrangement = Arrangement.spacedBy(10.dp)
                            ) {
                                items(
                                    items = state.filteredProducts,
                                    key = { it.id }
                                ) { product ->
                                    ProductCard(
                                        product = product,
                                        showManagementActions = false
                                    )
                                }
                            }
                        }
                    }
                }
            }

            // Server Config Dialog
            if (state.showServerConfigDialog) {
                ServerConfigDialog(
                    currentBaseUrl = state.currentBaseUrl,
                    onDismiss = onCloseServerConfig,
                    onSave = onSaveServerUrl
                )
            }
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun MenuScreenPreview() {
    DSRestaurantTheme {
        MenuContent(
            state = MenuUiState(
                slug = "demo-restoran",
                isLoading = false,
                restaurant = SampleData.sampleRestaurant,
                categories = SampleData.sampleCategories,
                products = SampleData.sampleProducts,
                currentBaseUrl = "http://10.0.2.2:4000/"
            ),
            onNavigateBack = {},
            onNavigateToManagement = {},
            onNavigateToEditProduct = {},
            onRefresh = {},
            onCategorySelected = {},
            onOpenServerConfig = {},
            onCloseServerConfig = {},
            onSaveServerUrl = {},
            onRetry = {}
        )
    }
}
