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
    /** OPEN_PAYMENTS: how many unpaid card payments block switching a restaurant. */
    @SerializedName("count") val count: Int? = null,
    /** BLOCKED: why real payments cannot be opened. */
    @SerializedName("blockers") val blockers: List<String>? = null,
    /** CHANGED: the amount now due, when it moved under the administrator's hands. */
    @SerializedName("amountSom") val amountSom: Long? = null,
)

// ---- A2: money review, cards, platform pool (src/modules/admin-money) ----

data class ReviewDto(
    @SerializedName("id") val id: String,
    @SerializedName("cardLast4") val cardLast4: String,
    @SerializedName("amountSom") val amountSom: Long,
    @SerializedName("occurredAt") val occurredAt: String,
    @SerializedName("emailReceivedAt") val emailReceivedAt: String?,
    @SerializedName("reason") val reason: String?,
    @SerializedName("reasonText") val reasonText: String,
    @SerializedName("source") val source: String,
    @SerializedName("restaurantName") val restaurantName: String?,
)

data class StaleDto(
    @SerializedName("orderCode") val orderCode: String?,
    @SerializedName("restaurantName") val restaurantName: String,
    @SerializedName("amountSom") val amountSom: Long,
    @SerializedName("matchedAt") val matchedAt: String,
)

data class ReviewActionDto(@SerializedName("action") val action: String, @SerializedName("label") val label: String)

data class MoneyResponse(
    @SerializedName("reviews") val reviews: List<ReviewDto>,
    @SerializedName("stale") val stale: List<StaleDto>,
    @SerializedName("actions") val actions: List<ReviewActionDto>,
)

data class HandleReviewRequest(@SerializedName("action") val action: String, @SerializedName("note") val note: String)

/** result is HANDLED, or ALREADY_HANDLED when somebody (or a double tap) closed it first. */
data class HandleReviewResponse(@SerializedName("ok") val ok: Boolean, @SerializedName("result") val result: String)

data class CardRowDto(
    @SerializedName("id") val id: String,
    @SerializedName("last4") val last4: String,
    @SerializedName("masked") val masked: String,
    @SerializedName("status") val status: String,
    @SerializedName("restaurant") val restaurant: String,
    @SerializedName("platform") val platform: Boolean,
)

data class CardsResponse(@SerializedName("cards") val cards: List<CardRowDto>)

data class CardRestaurantDto(@SerializedName("name") val name: String, @SerializedName("phone") val phone: String?)

/** [number] (grouped, full) is only sent while the card waits for approval. */
data class CardDetailDto(
    @SerializedName("id") val id: String,
    @SerializedName("last4") val last4: String,
    @SerializedName("status") val status: String,
    @SerializedName("holderName") val holderName: String?,
    @SerializedName("createdAt") val createdAt: String,
    @SerializedName("number") val number: String?,
    @SerializedName("restaurant") val restaurant: CardRestaurantDto?,
)

data class DecisionRequest(@SerializedName("decision") val decision: String)
data class DecisionResponse(@SerializedName("ok") val ok: Boolean, @SerializedName("result") val result: String, @SerializedName("last4") val last4: String)

data class PoolCardDto(
    @SerializedName("id") val id: String,
    @SerializedName("last4") val last4: String,
    @SerializedName("status") val status: String,
    @SerializedName("holderName") val holderName: String?,
    @SerializedName("turnoverSom") val turnoverSom: Long,
    /** Null when the cap is off (0 = unlimited). */
    @SerializedName("percent") val percent: Int?,
    @SerializedName("level") val level: String,
)

data class PoolRestaurantDto(
    @SerializedName("slug") val slug: String,
    @SerializedName("name") val name: String,
    @SerializedName("collectsToPlatform") val collectsToPlatform: Boolean,
)

data class PoolResponse(
    @SerializedName("capSom") val capSom: Long,
    @SerializedName("days") val days: Int,
    @SerializedName("cards") val cards: List<PoolCardDto>,
    @SerializedName("restaurants") val restaurants: List<PoolRestaurantDto>,
)

data class PlatformCardRequest(@SerializedName("number") val number: String, @SerializedName("holderName") val holderName: String)
data class PlatformCardResponse(@SerializedName("ok") val ok: Boolean, @SerializedName("last4") val last4: String)

data class CollectRequest(@SerializedName("slug") val slug: String, @SerializedName("on") val on: Boolean)
data class CollectResponse(@SerializedName("ok") val ok: Boolean, @SerializedName("result") val result: String, @SerializedName("name") val name: String)

// ---- A3a: platform settings, restaurants, ratings, commission (src/modules/admin-platform) ----

data class PaymentsPanelDto(
    @SerializedName("open") val open: Boolean,
    /** False on a test server: the door is only enforced in production. */
    @SerializedName("gateActive") val gateActive: Boolean,
    @SerializedName("mode") val mode: String,
    @SerializedName("blockers") val blockers: List<String>,
)
data class CashDto(@SerializedName("enabled") val enabled: Boolean, @SerializedName("maxOrderSom") val maxOrderSom: Long)
data class FeeDto(@SerializedName("mode") val mode: String, @SerializedName("percentBp") val percentBp: Int)
data class RankingDto(@SerializedName("enabled") val enabled: Boolean)

data class SettingsDto(
    @SerializedName("payments") val payments: PaymentsPanelDto,
    @SerializedName("cash") val cash: CashDto,
    @SerializedName("fee") val fee: FeeDto,
    @SerializedName("taxiMode") val taxiMode: String,
    @SerializedName("ranking") val ranking: RankingDto,
)

/** Every settings change answers with the new state, so the screen never shows a stale switch. */
data class SettingsChangeResponse(@SerializedName("ok") val ok: Boolean, @SerializedName("result") val result: String, @SerializedName("settings") val settings: SettingsDto)

data class OpenRequest(@SerializedName("open") val open: Boolean)
data class EnabledRequest(@SerializedName("enabled") val enabled: Boolean)
data class FeeRequest(@SerializedName("mode") val mode: String, @SerializedName("percent") val percent: Double? = null)
data class ModeRequest(@SerializedName("mode") val mode: String)
data class ActiveRequest(@SerializedName("active") val active: Boolean)

data class AvgDto(@SerializedName("count") val count: Int, @SerializedName("avg") val avg: Double?)
data class RatedRestaurantDto(
    @SerializedName("name") val name: String,
    @SerializedName("slug") val slug: String,
    @SerializedName("count") val count: Int,
    @SerializedName("avg") val avg: Double?,
    @SerializedName("last30") val last30: AvgDto,
    @SerializedName("score") val score: Double,
)
data class LowRatingDto(
    @SerializedName("restaurant") val restaurant: String,
    @SerializedName("stars") val stars: Int,
    @SerializedName("reasons") val reasons: List<String>,
    @SerializedName("note") val note: String?,
    @SerializedName("at") val at: String,
)
data class RatingsDto(
    @SerializedName("rankingOn") val rankingOn: Boolean,
    @SerializedName("restaurants") val restaurants: List<RatedRestaurantDto>,
    @SerializedName("lowRecent") val lowRecent: List<LowRatingDto>,
    @SerializedName("reasonLabels") val reasonLabels: Map<String, String>,
)

data class AdminRestaurantDto(
    @SerializedName("id") val id: String,
    @SerializedName("slug") val slug: String,
    @SerializedName("name") val name: String,
    @SerializedName("isActive") val isActive: Boolean,
    @SerializedName("isPaused") val isPaused: Boolean,
    @SerializedName("staffLinked") val staffLinked: Boolean,
    @SerializedName("hasPassword") val hasPassword: Boolean,
    @SerializedName("enabledCards") val enabledCards: Int,
    @SerializedName("pendingCards") val pendingCards: Int,
)
data class RestaurantsResponse(@SerializedName("restaurants") val restaurants: List<AdminRestaurantDto>)
data class ActiveResponse(@SerializedName("ok") val ok: Boolean, @SerializedName("result") val result: String, @SerializedName("signedOut") val signedOut: Int)

data class CountSumDto(@SerializedName("count") val count: Int, @SerializedName("amountSom") val amountSom: Long)
data class StatementDto(
    @SerializedName("restaurantId") val restaurantId: String,
    @SerializedName("name") val name: String,
    @SerializedName("due") val due: CountSumDto,
    @SerializedName("held") val held: CountSumDto,
    @SerializedName("current") val current: CountSumDto,
)
data class StatementsResponse(@SerializedName("statements") val statements: List<StatementDto>)
data class SettleRequest(@SerializedName("expectedCount") val expectedCount: Int, @SerializedName("expectedSom") val expectedSom: Long, @SerializedName("note") val note: String)
data class SettleResponse(@SerializedName("ok") val ok: Boolean, @SerializedName("settlementNumber") val settlementNumber: Int, @SerializedName("count") val count: Int, @SerializedName("amountSom") val amountSom: Long)

/** Severity names as the backend sends them. */
object Severity {
    const val CRITICAL = "CRITICAL"
    const val HIGH = "HIGH"
    const val MEDIUM = "MEDIUM"
}
