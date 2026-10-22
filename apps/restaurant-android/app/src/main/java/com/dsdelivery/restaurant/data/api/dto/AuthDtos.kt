package com.dsdelivery.restaurant.data.api.dto

import com.google.gson.annotations.SerializedName

data class LoginRequestDto(
    @SerializedName("slug")
    val slug: String,
    @SerializedName("password")
    val password: String
)

data class LoginResponseDto(
    @SerializedName("accessToken")
    val accessToken: String,
    @SerializedName("tokenType")
    val tokenType: String,
    @SerializedName("expiresAt")
    val expiresAt: String,
    @SerializedName("restaurant")
    val restaurant: RestaurantDto
)

data class AuthMeResponseDto(
    @SerializedName("restaurant")
    val restaurant: RestaurantDto,
    @SerializedName("session")
    val session: SessionInfoDto
)

data class SessionInfoDto(
    @SerializedName("expiresAt")
    val expiresAt: String
)

data class ApiErrorDto(
    @SerializedName("error")
    val error: String,
    @SerializedName("details")
    val details: Any? = null,
    @SerializedName("retryAfterSeconds")
    val retryAfterSeconds: Int? = null
)
