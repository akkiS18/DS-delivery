package com.dsdelivery.restaurant.ui.navigation

sealed class Screen(val route: String) {
    data object Login : Screen("login")
    data object Main : Screen("main/{slug}") {
        fun createRoute(slug: String): String = "main/$slug"
    }
    data object Menu : Screen("menu/{slug}") {
        fun createRoute(slug: String): String = "menu/$slug"
    }
    data object ProductManagement : Screen("product_management/{slug}") {
        fun createRoute(slug: String): String = "product_management/$slug"
    }
    data object ProductForm : Screen("product_form/{slug}?productId={productId}") {
        fun createNewRoute(slug: String): String = "product_form/$slug"
        fun createEditRoute(slug: String, productId: String): String = "product_form/$slug?productId=$productId"
    }
    data object OrderDetail : Screen("order_detail/{orderId}") {
        fun createRoute(orderId: String): String = "order_detail/$orderId"
    }
}
