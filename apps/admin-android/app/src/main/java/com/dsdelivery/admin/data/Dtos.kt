package com.dsdelivery.admin.data

import com.google.gson.annotations.SerializedName

// Mirrors src/modules/admin-auth and src/modules/admin-attention (backend). Only the fields the app uses.

data class RequestCodeRequest(@SerializedName("telegramUserId") val telegramUserId: String)

data class RequestCodeResponse(
    @SerializedName("ok") val ok: Boolean,
    @SerializedName("validMinutes") val validMinutes: Int,
)

data class VerifyRequest(
    @SerializedName("telegramUserId") val telegramUserId: String,
    @SerializedName("code") val code: String,
    @SerializedName("deviceName") val deviceName: String?,
)

data class AdminInfo(@SerializedName("telegramUserId") val telegramUserId: String)

data class VerifyResponse(
    @SerializedName("accessToken") val accessToken: String,
    @SerializedName("expiresAt") val expiresAt: String,
    @SerializedName("admin") val admin: AdminInfo,
)

data class RestaurantRef(
    @SerializedName("id") val id: String,
    @SerializedName("name") val name: String,
    @SerializedName("phone") val phone: String?,
)

/** One thing the administrator has to look at. [alarm] is decided by the server (not acknowledged, and not a quiet-hours item below critical). */
data class AttentionItem(
    @SerializedName("key") val key: String,
    @SerializedName("kind") val kind: String,
    @SerializedName("severity") val severity: String,
    @SerializedName("title") val title: String,
    @SerializedName("detail") val detail: String,
    @SerializedName("restaurant") val restaurant: RestaurantRef?,
    @SerializedName("orderCode") val orderCode: String?,
    @SerializedName("since") val since: String?,
    @SerializedName("ageSeconds") val ageSeconds: Long?,
    @SerializedName("acked") val acked: Boolean,
    @SerializedName("snoozeUntil") val snoozeUntil: String?,
    @SerializedName("alarm") val alarm: Boolean,
)

data class QuietHours(
    @SerializedName("from") val from: String,
    @SerializedName("to") val to: String,
)

data class AttentionCounts(
    @SerializedName("total") val total: Int,
    @SerializedName("alarming") val alarming: Int,
    @SerializedName("critical") val critical: Int,
)

data class AttentionResponse(
    @SerializedName("now") val now: String,
    @SerializedName("quiet") val quiet: QuietHours?,
    @SerializedName("quietActive") val quietActive: Boolean,
    @SerializedName("items") val items: List<AttentionItem>,
    @SerializedName("counts") val counts: AttentionCounts,
)

data class AckRequest(
    @SerializedName("key") val key: String,
    @SerializedName("minutes") val minutes: Int?,
)

data class AckResponse(
    @SerializedName("ok") val ok: Boolean,
    @SerializedName("snoozeUntil") val snoozeUntil: String,
)

/** Either [off] = true, or both [from] and [to] ("HH:MM"). Null fields are not sent. */
data class QuietRequest(
    @SerializedName("off") val off: Boolean? = null,
    @SerializedName("from") val from: String? = null,
    @SerializedName("to") val to: String? = null,
)

data class QuietResponse(
    @SerializedName("ok") val ok: Boolean,
    @SerializedName("quiet") val quiet: QuietHours?,
    @SerializedName("quietActive") val quietActive: Boolean,
)

data class LogoutAllResponse(@SerializedName("closed") val closed: Int)

data class ApiErrorBody(
    @SerializedName("error") val error: String?,
    @SerializedName("message") val message: String?,
    @SerializedName("retryAfterSeconds") val retryAfterSeconds: Int?,
)

/** Severity names as the backend sends them. */
object Severity {
    const val CRITICAL = "CRITICAL"
    const val HIGH = "HIGH"
    const val MEDIUM = "MEDIUM"
}
