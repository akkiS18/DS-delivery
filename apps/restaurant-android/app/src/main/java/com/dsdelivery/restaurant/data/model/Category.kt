package com.dsdelivery.restaurant.data.model

data class Category(
    val id: String,
    val name: String,
    val position: Int,
    val version: Int = 1,
    val productCount: Int = 0
)
