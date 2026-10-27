package com.dsdelivery.restaurant.data.api.dto

import com.google.gson.annotations.SerializedName

data class CategoryDto(
    @SerializedName("id")
    val id: String,
    @SerializedName("name")
    val name: String,
    @SerializedName("position")
    val position: Int = 0,
    @SerializedName("version")
    val version: Int = 1,
    @SerializedName("productCount")
    val productCount: Int? = null,
    /** Relative URL of the category photo (null = none). */
    @SerializedName("imageUrl")
    val imageUrl: String? = null
)

data class CategoriesResponseDto(
    @SerializedName("categories")
    val categories: List<CategoryDto>
)
