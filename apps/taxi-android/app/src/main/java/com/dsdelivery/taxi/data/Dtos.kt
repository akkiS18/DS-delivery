package com.dsdelivery.taxi.data

import com.google.gson.annotations.SerializedName

// Mirrors src/modules/taxi-app (backend). Only the fields the app uses.

data class LoginRequest(
    @SerializedName("login") val login: String,
    @SerializedName("password") val password: String
)

data class CompanyDto(
    @SerializedName("id") val id: String,
    @SerializedName("name") val name: String,
    @SerializedName("login") val login: String
)

data class LoginResponse(
    @SerializedName("accessToken") val accessToken: String,
    @SerializedName("expiresAt") val expiresAt: String,
    @SerializedName("company") val company: CompanyDto
)

data class RestaurantInfo(
    @SerializedName("name") val name: String,
    @SerializedName("address") val address: String?,
    @SerializedName("phone") val phone: String?
)

data class DeliveryInfo(
    @SerializedName("address") val address: String,
    @SerializedName("lat") val lat: Double?,
    @SerializedName("lng") val lng: Double?,
    @SerializedName("customerPhone") val customerPhone: String?
)

data class FoodInfo(
    @SerializedName("ready") val ready: Boolean,
    @SerializedName("status") val status: String,
    @SerializedName("prepMinutes") val prepMinutes: Int?,
    @SerializedName("estimatedReadyAt") val estimatedReadyAt: String?,
    @SerializedName("readyAt") val readyAt: String?,
    @SerializedName("totalSom") val totalSom: Int
)

/** One taxi request. [actions] is decided by the server (what this company may press now). */
data class RequestDto(
    @SerializedName("id") val id: String,
    @SerializedName("orderNumber") val orderNumber: Int,
    @SerializedName("status") val status: String,
    @SerializedName("attention") val attention: Boolean,
    @SerializedName("createdAt") val createdAt: String,
    @SerializedName("sentAt") val sentAt: String?,
    @SerializedName("answerBy") val answerBy: String?,
    @SerializedName("updatedAt") val updatedAt: String,
    @SerializedName("deliveredAt") val deliveredAt: String?,
    @SerializedName("isTest") val isTest: Boolean,
    @SerializedName("restaurant") val restaurant: RestaurantInfo,
    @SerializedName("delivery") val delivery: DeliveryInfo,
    @SerializedName("food") val food: FoodInfo,
    @SerializedName("actions") val actions: List<String>,
    @SerializedName("deliverBlockedReason") val deliverBlockedReason: String?
)

data class RequestsResponse(
    @SerializedName("serverNow") val serverNow: String,
    @SerializedName("company") val company: CompanyDto,
    @SerializedName("active") val active: List<RequestDto>,
    @SerializedName("history") val history: List<RequestDto>
)

data class ActionRequest(@SerializedName("action") val action: String)

data class ActionResponse(
    @SerializedName("changed") val changed: Boolean,
    @SerializedName("finalStatus") val finalStatus: String,
    @SerializedName("fallbackCompany") val fallbackCompany: String?,
    @SerializedName("request") val request: RequestDto?
)

data class ApiErrorBody(
    @SerializedName("error") val error: String?,
    @SerializedName("message") val message: String?,
    @SerializedName("retryAfterSeconds") val retryAfterSeconds: Int?
)

/** What an operator can press. The wire names are the backend's. */
object Action {
    const val ACCEPT = "ACCEPT"
    const val SENT = "SENT"
    const val NO_TAXI = "NO_TAXI"
    const val DELIVERED = "DELIVERED"
}
