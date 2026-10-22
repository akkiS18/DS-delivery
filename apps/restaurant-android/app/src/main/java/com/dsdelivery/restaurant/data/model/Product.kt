package com.dsdelivery.restaurant.data.model

import java.text.NumberFormat
import java.util.Locale

data class Product(
    val id: String,
    val name: String,
    val description: String?,
    val priceSom: Int,
    val imageUrl: String?,
    val categoryId: String?,
    val isAvailable: Boolean = true,
    val archivedAt: String? = null,
    val version: Int = 1
) {
    val formattedPrice: String
        get() {
            val formatter = NumberFormat.getNumberInstance(Locale("uz", "UZ"))
            return "${formatter.format(priceSom)} so‘m"
        }

    val isArchived: Boolean
        get() = archivedAt != null
}

data class RestaurantMenu(
    val restaurant: Restaurant,
    val categories: List<Category>,
    val products: List<Product>
)
