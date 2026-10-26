package com.dsdelivery.restaurant.ui.screens.main

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountBalance
import androidx.compose.material.icons.filled.Receipt
import androidx.compose.material.icons.filled.RestaurantMenu
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.Storefront
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import com.dsdelivery.restaurant.RestaurantApp
import com.dsdelivery.restaurant.data.notify.NewOrderNotifier
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.dsdelivery.restaurant.ui.screens.finance.FinanceScreen
import com.dsdelivery.restaurant.ui.screens.finance.FinanceViewModel
import com.dsdelivery.restaurant.ui.screens.operations.OperationsScreen
import com.dsdelivery.restaurant.ui.screens.ratings.RatingsScreen
import com.dsdelivery.restaurant.ui.screens.ratings.RatingsViewModel
import com.dsdelivery.restaurant.ui.screens.operations.OperationsViewModel
import com.dsdelivery.restaurant.ui.screens.orders.OrdersScreen
import com.dsdelivery.restaurant.ui.screens.orders.OrdersViewModel
import com.dsdelivery.restaurant.ui.screens.products.ProductManagementScreen
import com.dsdelivery.restaurant.ui.screens.products.ProductManagementViewModel
import com.dsdelivery.restaurant.ui.theme.BrandMint
import com.dsdelivery.restaurant.ui.theme.BrandPrimary

enum class MainTab(val title: String, val icon: ImageVector) {
    ORDERS("Buyurtmalar", Icons.Default.Receipt),
    MENU("Menyu", Icons.Default.RestaurantMenu),
    FINANCE("Moliya", Icons.Default.AccountBalance),
    RATINGS("Baholar", Icons.Default.Star),
    OPERATIONS("Sozlamalar", Icons.Default.Storefront)
}

@Composable
fun MainScreen(
    ordersViewModel: OrdersViewModel,
    productManagementViewModel: ProductManagementViewModel,
    financeViewModel: FinanceViewModel,
    ratingsViewModel: RatingsViewModel,
    operationsViewModel: OperationsViewModel,
    onNavigateToOrderDetail: (orderId: String) -> Unit,
    onNavigateToCreateProduct: () -> Unit,
    onNavigateToEditProduct: (productId: String) -> Unit,
    onLoggedOut: () -> Unit,
    modifier: Modifier = Modifier
) {
    var selectedTab by rememberSaveable { mutableStateOf(MainTab.ORDERS) }
    val ordersState by ordersViewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }
    val context = LocalContext.current
    val notifier = remember { NewOrderNotifier(context.applicationContext) }
    // The kitchen bell (background service) already announces new orders; the one-off system notification is only the fallback when it is off.
    val alarm = remember { (context.applicationContext as RestaurantApp).alarm }
    val bellOn by alarm.settings.enabled.collectAsState()
    val bellRinging by alarm.watcher.ringing.collectAsState()
    val operationsState by operationsViewModel.uiState.collectAsState()

    // Anything that changed while the app was away (a card the administrator approved, a new order, the menu on another phone) shows up
    // as soon as the app is opened again or a tab is selected; no need to close the app.
    var firstResume by remember { mutableStateOf(true) }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
        if (firstResume) { firstResume = false; return@LifecycleEventEffect }
        ordersViewModel.loadOrders(silent = true)
        productManagementViewModel.loadData(silent = true)
        financeViewModel.refresh()
        ratingsViewModel.refresh()
        operationsViewModel.loadOperations()
        operationsViewModel.loadCards()
    }
    var shownTab by remember { mutableStateOf(selectedTab) }
    LaunchedEffect(selectedTab) {
        if (shownTab == selectedTab) return@LaunchedEffect
        shownTab = selectedTab
        when (selectedTab) {
            MainTab.ORDERS -> ordersViewModel.loadOrders(silent = true)
            MainTab.MENU -> productManagementViewModel.loadData(silent = true)
            MainTab.FINANCE -> financeViewModel.refresh()
            MainTab.RATINGS -> ratingsViewModel.refresh()
            MainTab.OPERATIONS -> { operationsViewModel.loadOperations(); operationsViewModel.loadCards() }
        }
    }

    // A genuinely new order: one in-app message and (if allowed) one system notification, never repeated for the same id.
    LaunchedEffect(ordersViewModel) {
        ordersViewModel.newOrders.collect { fresh ->
            if (!bellOn) notifier.notifyNewOrders(fresh)
            val numbers = fresh.joinToString(", ") { it.orderNumberDisplay }
            snackbarHostState.showSnackbar("Yangi buyurtma: $numbers")
        }
    }

    Scaffold(
        bottomBar = {
            NavigationBar(
                containerColor = MaterialTheme.colorScheme.surface,
                tonalElevation = 8.dp
            ) {
                MainTab.entries.forEach { tab ->
                    val isSelected = selectedTab == tab
                    NavigationBarItem(
                        selected = isSelected,
                        onClick = { selectedTab = tab },
                        icon = {
                            val badge = if (tab == MainTab.ORDERS) ordersState.newOrdersCount + ordersState.attentionOrdersCount else 0
                            if (badge > 0) {
                                BadgedBox(badge = { Badge { Text(badge.toString()) } }) {
                                    Icon(imageVector = tab.icon, contentDescription = tab.title)
                                }
                            } else {
                                Icon(imageVector = tab.icon, contentDescription = tab.title)
                            }
                        },
                        label = {
                            Text(
                                text = tab.title,
                                fontSize = 11.sp,
                                fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal
                            )
                        },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = BrandPrimary,
                            selectedTextColor = BrandPrimary,
                            indicatorColor = BrandMint.copy(alpha = 0.4f),
                            unselectedIconColor = MaterialTheme.colorScheme.onSurfaceVariant,
                            unselectedTextColor = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    )
                }
            }
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
        modifier = modifier
    ) { innerPadding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(bottom = innerPadding.calculateBottomPadding())
        ) {
            when (selectedTab) {
                MainTab.ORDERS -> {
                    OrdersScreen(
                        viewModel = ordersViewModel,
                        onNavigateToOrderDetail = onNavigateToOrderDetail,
                        alarmRinging = bellRinging,
                        onSilence = alarm.watcher::silence,
                        isPaused = operationsState.isPaused,
                        onSetPaused = operationsViewModel::setPaused
                    )
                }
                MainTab.MENU -> {
                    ProductManagementScreen(
                        viewModel = productManagementViewModel,
                        onNavigateBack = { selectedTab = MainTab.ORDERS },
                        onNavigateToCreateProduct = onNavigateToCreateProduct,
                        onNavigateToEditProduct = onNavigateToEditProduct,
                        onLoggedOut = onLoggedOut
                    )
                }
                MainTab.FINANCE -> {
                    FinanceScreen(
                        viewModel = financeViewModel
                    )
                }
                MainTab.RATINGS -> {
                    RatingsScreen(viewModel = ratingsViewModel)
                }
                MainTab.OPERATIONS -> {
                    OperationsScreen(
                        viewModel = operationsViewModel,
                        onLoggedOut = onLoggedOut
                    )
                }
            }
        }
    }
}
