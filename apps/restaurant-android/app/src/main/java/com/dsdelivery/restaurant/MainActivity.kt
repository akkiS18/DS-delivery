package com.dsdelivery.restaurant

import android.Manifest
import android.os.Build
import android.os.Bundle
import androidx.activity.result.contract.ActivityResultContracts
import com.dsdelivery.restaurant.data.notify.AppForeground
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.dsdelivery.restaurant.data.auth.SessionState
import com.dsdelivery.restaurant.ui.navigation.Screen
import com.dsdelivery.restaurant.ui.screens.finance.FinanceViewModel
import com.dsdelivery.restaurant.ui.screens.ratings.RatingsViewModel
import com.dsdelivery.restaurant.ui.screens.reservations.ReservationsViewModel
import com.dsdelivery.restaurant.ui.screens.login.LoginScreen
import com.dsdelivery.restaurant.ui.screens.login.LoginViewModel
import com.dsdelivery.restaurant.ui.screens.main.MainScreen
import com.dsdelivery.restaurant.ui.screens.menu.MenuScreen
import com.dsdelivery.restaurant.ui.screens.menu.MenuViewModel
import com.dsdelivery.restaurant.ui.screens.operations.OperationsViewModel
import com.dsdelivery.restaurant.ui.screens.orders.OrdersViewModel
import com.dsdelivery.restaurant.ui.screens.orders.detail.OrderDetailScreen
import com.dsdelivery.restaurant.ui.screens.orders.detail.OrderDetailViewModel
import com.dsdelivery.restaurant.ui.screens.products.ProductManagementScreen
import com.dsdelivery.restaurant.ui.screens.products.ProductManagementViewModel
import com.dsdelivery.restaurant.ui.screens.products.form.ProductFormScreen
import com.dsdelivery.restaurant.ui.screens.products.form.ProductFormViewModel
import com.dsdelivery.restaurant.ui.theme.DSRestaurantTheme

class MainActivity : ComponentActivity() {

    override fun onStart() {
        super.onStart()
        AppForeground.set(true)
    }

    override fun onStop() {
        AppForeground.set(false)
        super.onStop()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val app = application as RestaurantApp

        // Ask once for permission to show the "new order" notification (Android 13+). Without it the app still polls and
        // shows the in-app message and badge.
        if (Build.VERSION.SDK_INT >= 33) {
            registerForActivityResult(ActivityResultContracts.RequestPermission()) { }.launch(Manifest.permission.POST_NOTIFICATIONS)
        }

        setContent {
            DSRestaurantTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    RestaurantNavGraph(app = app)
                }
            }
        }
    }
}

@Composable
fun RestaurantNavGraph(
    app: RestaurantApp,
    modifier: Modifier = Modifier
) {
    val navController = rememberNavController()

    // A 401 on any protected call clears the session (AuthInterceptor). Send the user back to
    // login instead of leaving a dead screen; the public demo menu does not need a session.
    val sessionState by app.repository.sessionState.collectAsState()
    LaunchedEffect(sessionState) {
        if (sessionState is SessionState.LoggedOut) {
            val route = navController.currentDestination?.route
            if (route != null && route != Screen.Login.route && route != Screen.Menu.route) {
                navController.navigate(Screen.Login.route) {
                    popUpTo(0) { inclusive = true }
                    launchSingleTop = true
                }
            }
        }
    }

    NavHost(
        navController = navController,
        startDestination = Screen.Login.route,
        modifier = modifier
    ) {
        composable(Screen.Login.route) {
            val loginViewModel: LoginViewModel = viewModel(
                factory = object : ViewModelProvider.Factory {
                    @Suppress("UNCHECKED_CAST")
                    override fun <T : ViewModel> create(modelClass: Class<T>): T {
                        return LoginViewModel(
                            apiConfig = app.apiConfig,
                            repository = app.repository
                        ) as T
                    }
                }
            )

            LoginScreen(
                viewModel = loginViewModel,
                onNavigateToManagement = { slug ->
                    navController.navigate(Screen.Main.createRoute(slug)) {
                        popUpTo(Screen.Login.route) { inclusive = true }
                    }
                },
                onNavigateToDemoMenu = { slug ->
                    navController.navigate(Screen.Menu.createRoute(slug))
                }
            )
        }

        composable(
            route = Screen.Main.route,
            arguments = listOf(
                navArgument("slug") {
                    type = NavType.StringType
                    defaultValue = "demo-restoran"
                }
            )
        ) { backStackEntry ->
            val slug = backStackEntry.arguments?.getString("slug") ?: "demo-restoran"

            val ordersViewModel: OrdersViewModel = viewModel(
                key = "OrdersViewModel_$slug",
                factory = object : ViewModelProvider.Factory {
                    @Suppress("UNCHECKED_CAST")
                    override fun <T : ViewModel> create(modelClass: Class<T>): T {
                        return OrdersViewModel(app.repository) as T
                    }
                }
            )

            val managementViewModel: ProductManagementViewModel = viewModel(
                key = "ProductManagementViewModel_$slug",
                factory = object : ViewModelProvider.Factory {
                    @Suppress("UNCHECKED_CAST")
                    override fun <T : ViewModel> create(modelClass: Class<T>): T {
                        return ProductManagementViewModel(
                            slug = slug,
                            repository = app.repository
                        ) as T
                    }
                }
            )

            val financeViewModel: FinanceViewModel = viewModel(
                key = "FinanceViewModel_$slug",
                factory = object : ViewModelProvider.Factory {
                    @Suppress("UNCHECKED_CAST")
                    override fun <T : ViewModel> create(modelClass: Class<T>): T {
                        return FinanceViewModel(app.repository) as T
                    }
                }
            )

            val ratingsViewModel: RatingsViewModel = viewModel(
                key = "RatingsViewModel_$slug",
                factory = object : ViewModelProvider.Factory {
                    @Suppress("UNCHECKED_CAST")
                    override fun <T : ViewModel> create(modelClass: Class<T>): T {
                        return RatingsViewModel(app.repository) as T
                    }
                }
            )

            val reservationsViewModel: ReservationsViewModel = viewModel(
                key = "ReservationsViewModel_$slug",
                factory = object : ViewModelProvider.Factory {
                    @Suppress("UNCHECKED_CAST")
                    override fun <T : ViewModel> create(modelClass: Class<T>): T {
                        return ReservationsViewModel(app.repository) as T
                    }
                }
            )

            val operationsViewModel: OperationsViewModel = viewModel(
                key = "OperationsViewModel_$slug",
                factory = object : ViewModelProvider.Factory {
                    @Suppress("UNCHECKED_CAST")
                    override fun <T : ViewModel> create(modelClass: Class<T>): T {
                        return OperationsViewModel(
                            repository = app.repository,
                            apiConfig = app.apiConfig
                        ) as T
                    }
                }
            )

            MainScreen(
                ordersViewModel = ordersViewModel,
                productManagementViewModel = managementViewModel,
                financeViewModel = financeViewModel,
                ratingsViewModel = ratingsViewModel,
                reservationsViewModel = reservationsViewModel,
                operationsViewModel = operationsViewModel,
                onNavigateToOrderDetail = { orderId ->
                    navController.navigate(Screen.OrderDetail.createRoute(orderId))
                },
                onNavigateToCreateProduct = {
                    navController.navigate(Screen.ProductForm.createNewRoute(slug))
                },
                onNavigateToEditProduct = { productId ->
                    navController.navigate(Screen.ProductForm.createEditRoute(slug, productId))
                },
                onLoggedOut = {
                    navController.navigate(Screen.Login.route) {
                        popUpTo(0) { inclusive = true }
                    }
                }
            )
        }

        composable(
            route = Screen.OrderDetail.route,
            arguments = listOf(
                navArgument("orderId") {
                    type = NavType.StringType
                }
            )
        ) { backStackEntry ->
            val orderId = backStackEntry.arguments?.getString("orderId") ?: ""

            val orderDetailViewModel: OrderDetailViewModel = viewModel(
                key = "OrderDetailViewModel_$orderId",
                factory = object : ViewModelProvider.Factory {
                    @Suppress("UNCHECKED_CAST")
                    override fun <T : ViewModel> create(modelClass: Class<T>): T {
                        return OrderDetailViewModel(
                            orderId = orderId,
                            repository = app.repository
                        ) as T
                    }
                }
            )

            OrderDetailScreen(
                viewModel = orderDetailViewModel,
                onNavigateBack = {
                    navController.popBackStack()
                }
            )
        }

        composable(
            route = Screen.Menu.route,
            arguments = listOf(
                navArgument("slug") {
                    type = NavType.StringType
                    defaultValue = "demo-restoran"
                }
            )
        ) { backStackEntry ->
            val slug = backStackEntry.arguments?.getString("slug") ?: "demo-restoran"

            val menuViewModel: MenuViewModel = viewModel(
                key = "MenuViewModel_$slug",
                factory = object : ViewModelProvider.Factory {
                    @Suppress("UNCHECKED_CAST")
                    override fun <T : ViewModel> create(modelClass: Class<T>): T {
                        return MenuViewModel(
                            slug = slug,
                            repository = app.repository,
                            apiConfig = app.apiConfig
                        ) as T
                    }
                }
            )

            MenuScreen(
                viewModel = menuViewModel,
                onNavigateBack = {
                    navController.popBackStack()
                },
                onNavigateToManagement = {
                    navController.navigate(Screen.Main.createRoute(slug))
                },
                onNavigateToEditProduct = { productId ->
                    navController.navigate(Screen.ProductForm.createEditRoute(slug, productId))
                }
            )
        }

        composable(
            route = Screen.ProductManagement.route,
            arguments = listOf(
                navArgument("slug") {
                    type = NavType.StringType
                    defaultValue = "demo-restoran"
                }
            )
        ) { backStackEntry ->
            val slug = backStackEntry.arguments?.getString("slug") ?: "demo-restoran"

            val managementViewModel: ProductManagementViewModel = viewModel(
                key = "ProductManagementViewModel_$slug",
                factory = object : ViewModelProvider.Factory {
                    @Suppress("UNCHECKED_CAST")
                    override fun <T : ViewModel> create(modelClass: Class<T>): T {
                        return ProductManagementViewModel(
                            slug = slug,
                            repository = app.repository
                        ) as T
                    }
                }
            )

            ProductManagementScreen(
                viewModel = managementViewModel,
                onNavigateBack = {
                    navController.popBackStack()
                },
                onNavigateToCreateProduct = {
                    navController.navigate(Screen.ProductForm.createNewRoute(slug))
                },
                onNavigateToEditProduct = { productId ->
                    navController.navigate(Screen.ProductForm.createEditRoute(slug, productId))
                },
                onLoggedOut = {
                    navController.navigate(Screen.Login.route) {
                        popUpTo(0) { inclusive = true }
                    }
                }
            )
        }

        composable(
            route = Screen.ProductForm.route,
            arguments = listOf(
                navArgument("slug") {
                    type = NavType.StringType
                    defaultValue = "demo-restoran"
                },
                navArgument("productId") {
                    type = NavType.StringType
                    nullable = true
                    defaultValue = null
                }
            )
        ) { backStackEntry ->
            val slug = backStackEntry.arguments?.getString("slug") ?: "demo-restoran"
            val productId = backStackEntry.arguments?.getString("productId")

            val formViewModel: ProductFormViewModel = viewModel(
                key = "ProductFormViewModel_${slug}_${productId ?: "new"}",
                factory = object : ViewModelProvider.Factory {
                    @Suppress("UNCHECKED_CAST")
                    override fun <T : ViewModel> create(modelClass: Class<T>): T {
                        return ProductFormViewModel(
                            slug = slug,
                            productId = productId,
                            repository = app.repository
                        ) as T
                    }
                }
            )

            ProductFormScreen(
                viewModel = formViewModel,
                onNavigateBack = {
                    navController.popBackStack()
                }
            )
        }
    }
}
