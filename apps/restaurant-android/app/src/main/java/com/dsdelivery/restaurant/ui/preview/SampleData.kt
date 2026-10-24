package com.dsdelivery.restaurant.ui.preview

import com.dsdelivery.restaurant.data.model.Category
import com.dsdelivery.restaurant.data.model.Product
import com.dsdelivery.restaurant.data.model.Restaurant
import com.dsdelivery.restaurant.data.model.RestaurantMenu

object SampleData {

    val sampleRestaurant = Restaurant(
        id = "rest_demo_123",
        slug = "demo-restoran",
        name = "Demo Restoran",
        isPaused = false
    )

    val sampleCategories = listOf(
        Category(id = "cat_1", name = "Burgerlar", position = 0),
        Category(id = "cat_2", name = "Ichimliklar", position = 1),
        Category(id = "cat_3", name = "Lavash & Donar", position = 2),
        Category(id = "cat_4", name = "Shirinliklar", position = 3)
    )

    val sampleProducts = listOf(
        Product(
            id = "prod_1",
            name = "Klassik Burger",
            description = "Suvli mol go‘shti, maxsus sous, yangi pomidor va bodring",
            priceSom = 25000,
            imageUrl = "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=400",
            categoryId = "cat_1",
            isAvailable = true
        ),
        Product(
            id = "prod_2",
            name = "Pishloqli Cheeseburger",
            description = "Eritilgan cheddar pishlog‘i va qovurilgan piyoz bilan",
            priceSom = 29000,
            imageUrl = null,
            categoryId = "cat_1",
            isAvailable = false
        ),
        Product(
            id = "prod_3",
            name = "Maxsus Lavash (Katta)",
            description = "Tandir go‘shti, chips va achchiq pomidor sousi",
            priceSom = 32000,
            imageUrl = null,
            categoryId = "cat_3",
            isAvailable = true
        ),
        Product(
            id = "prod_4",
            name = "Muzdek Coca-Cola 0.5L",
            description = "Klassik salqin ichimlik",
            priceSom = 8000,
            imageUrl = null,
            categoryId = "cat_2",
            isAvailable = true
        ),
        Product(
            id = "prod_5",
            name = "Limonli Choy",
            description = "Tabiiy yangi damlangan choy",
            priceSom = 5000,
            imageUrl = null,
            categoryId = "cat_2",
            isAvailable = false
        )
    )

    val sampleMenu = RestaurantMenu(
        restaurant = sampleRestaurant,
        categories = sampleCategories,
        products = sampleProducts
    )

    val sampleOrders = listOf(
        com.dsdelivery.restaurant.data.model.Order(
            id = "order_1042",
            code = "K7M2Q",
            status = com.dsdelivery.restaurant.data.model.OrderStatus.WAITING_RESTAURANT,
            totalSom = 75000,
            createdAt = "2026-10-17T15:20:00.000Z",
            estimatedPrepMinutes = 25,
            items = listOf(
                com.dsdelivery.restaurant.data.model.OrderItem("Klassik Burger", 25000, 2, 50000),
                com.dsdelivery.restaurant.data.model.OrderItem("Muzdek Coca-Cola 0.5L", 8000, 1, 8000),
                com.dsdelivery.restaurant.data.model.OrderItem("Kartoshka Fri", 17000, 1, 17000)
            ),
            paymentStatus = com.dsdelivery.restaurant.data.model.PaymentStatus.AWAITING,
            customerPhone = "+998 90 123 45 67",
            customerName = "Rustam Aliyev"
        ),
        com.dsdelivery.restaurant.data.model.Order(
            id = "order_1041",
            code = "T4WZ9",
            status = com.dsdelivery.restaurant.data.model.OrderStatus.PREPARING,
            totalSom = 93000,
            createdAt = "2026-10-17T15:05:00.000Z",
            estimatedPrepMinutes = 30,
            items = listOf(
                com.dsdelivery.restaurant.data.model.OrderItem("Maxsus Lavash (Katta)", 32000, 2, 64000),
                com.dsdelivery.restaurant.data.model.OrderItem("Pishloqli Cheeseburger", 29000, 1, 29000)
            ),
            paymentStatus = com.dsdelivery.restaurant.data.model.PaymentStatus.CONFIRMED_MANUAL,
            customerPhone = "+998 97 765 43 21",
            customerName = "Azizbek Mahmudov"
        ),
        com.dsdelivery.restaurant.data.model.Order(
            id = "order_1040",
            code = "B8NR3",
            status = com.dsdelivery.restaurant.data.model.OrderStatus.READY,
            totalSom = 32000,
            createdAt = "2026-10-17T14:45:00.000Z",
            estimatedPrepMinutes = 15,
            items = listOf(
                com.dsdelivery.restaurant.data.model.OrderItem("Maxsus Lavash (Katta)", 32000, 1, 32000)
            ),
            paymentStatus = com.dsdelivery.restaurant.data.model.PaymentStatus.CONFIRMED_MANUAL,
            customerPhone = "+998 93 555 12 34",
            customerName = "Madina Karimova"
        ),
        com.dsdelivery.restaurant.data.model.Order(
            id = "order_1039",
            code = "H6CX5",
            status = com.dsdelivery.restaurant.data.model.OrderStatus.PAYMENT_PENDING,
            totalSom = 58000,
            createdAt = "2026-10-17T14:30:00.000Z",
            estimatedPrepMinutes = 20,
            items = listOf(
                com.dsdelivery.restaurant.data.model.OrderItem("Klassik Burger", 25000, 2, 50000),
                com.dsdelivery.restaurant.data.model.OrderItem("Muzdek Coca-Cola 0.5L", 8000, 1, 8000)
            ),
            paymentStatus = com.dsdelivery.restaurant.data.model.PaymentStatus.AWAITING,
            customerPhone = "+998 99 888 77 66",
            customerName = "Jasur Toshmatov"
        ),
        com.dsdelivery.restaurant.data.model.Order(
            id = "order_1038",
            code = "D2PV7",
            status = com.dsdelivery.restaurant.data.model.OrderStatus.COMPLETED,
            totalSom = 110000,
            createdAt = "2026-10-17T13:10:00.000Z",
            estimatedPrepMinutes = 25,
            items = listOf(
                com.dsdelivery.restaurant.data.model.OrderItem("Klassik Burger", 25000, 2, 50000),
                com.dsdelivery.restaurant.data.model.OrderItem("Maxsus Lavash (Katta)", 32000, 1, 32000),
                com.dsdelivery.restaurant.data.model.OrderItem("Pishloqli Cheeseburger", 28000, 1, 28000)
            ),
            paymentStatus = com.dsdelivery.restaurant.data.model.PaymentStatus.CONFIRMED_MANUAL,
            customerPhone = "+998 91 234 56 78",
            customerName = "Dilshod Saidov"
        ),
        com.dsdelivery.restaurant.data.model.Order(
            id = "order_1037",
            code = "S9GJ4",
            status = com.dsdelivery.restaurant.data.model.OrderStatus.RESTAURANT_REJECTED,
            totalSom = 29000,
            createdAt = "2026-10-17T12:00:00.000Z",
            items = listOf(
                com.dsdelivery.restaurant.data.model.OrderItem("Pishloqli Cheeseburger", 29000, 1, 29000)
            ),
            paymentStatus = com.dsdelivery.restaurant.data.model.PaymentStatus.CANCELLED,
            customerPhone = "+998 90 999 88 77",
            rejectReason = "Mahsulot tugagan"
        )
    )
}
