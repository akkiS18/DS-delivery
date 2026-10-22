package com.dsdelivery.restaurant.data.api.dto

import com.google.gson.annotations.SerializedName

data class ProductDto(
    @SerializedName("id")
    val id: String,
    @SerializedName("name")
    val name: String,
    @SerializedName("description")
    val description: String? = null,
    @SerializedName("priceSom")
    val priceSom: Int,
    @SerializedName("imageUrl")
    val imageUrl: String? = null,
    @SerializedName("categoryId")
    val categoryId: String? = null,
    @SerializedName("isAvailable")
    val isAvailable: Boolean = true,
    @SerializedName("archivedAt")
    val archivedAt: String? = null,
    @SerializedName("version")
    val version: Int = 1,
    @SerializedName("createdAt")
    val createdAt: String? = null,
    @SerializedName("updatedAt")
    val updatedAt: String? = null
)

data class ProductsResponseDto(
    @SerializedName("products")
    val products: List<ProductDto>
)
