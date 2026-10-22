package com.dsdelivery.restaurant.data.api.dto

import com.google.gson.annotations.SerializedName

data class MenuResponseDto(
    @SerializedName("id")
    val id: String,
    @SerializedName("slug")
    val slug: String,
    @SerializedName("name")
    val name: String,
    @SerializedName("isPaused")
    val isPaused: Boolean,
    @SerializedName("categories")
    val categories: List<CategoryDto>,
    @SerializedName("products")
    val products: List<ProductDto>
)
