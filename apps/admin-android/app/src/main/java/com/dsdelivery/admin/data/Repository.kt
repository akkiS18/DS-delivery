package com.dsdelivery.admin.data

import com.dsdelivery.admin.BuildConfig
import com.google.gson.Gson
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import retrofit2.Response
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.PUT
import java.io.IOException
import java.util.concurrent.TimeUnit

interface AdminApi {
    @POST("api/v1/admin/auth/request-code") suspend fun requestCode(@Body body: RequestCodeRequest): Response<RequestCodeResponse>
    @POST("api/v1/admin/auth/verify") suspend fun verify(@Body body: VerifyRequest): Response<VerifyResponse>
    @POST("api/v1/admin/auth/logout") suspend fun logout(): Response<Unit>
    @POST("api/v1/admin/auth/logout-all") suspend fun logoutAll(): Response<LogoutAllResponse>
    @GET("api/v1/admin/attention") suspend fun attention(): Response<AttentionResponse>
    @POST("api/v1/admin/attention/ack") suspend fun ack(@Body body: AckRequest): Response<AckResponse>
    @PUT("api/v1/admin/attention/quiet-hours") suspend fun quietHours(@Body body: QuietRequest): Response<QuietResponse>

    @GET("api/v1/admin/money") suspend fun money(): Response<MoneyResponse>
    @POST("api/v1/admin/money/reviews/{id}/handle") suspend fun handleReview(@Path("id") id: String, @Body body: HandleReviewRequest): Response<HandleReviewResponse>
    @GET("api/v1/admin/cards") suspend fun cards(): Response<CardsResponse>
    @GET("api/v1/admin/cards/{id}") suspend fun cardDetail(@Path("id") id: String): Response<CardDetailDto>
    @POST("api/v1/admin/cards/{id}/decision") suspend fun decideCard(@Path("id") id: String, @Body body: DecisionRequest): Response<DecisionResponse>
    @GET("api/v1/admin/pool") suspend fun pool(): Response<PoolResponse>
    @POST("api/v1/admin/pool/cards") suspend fun addPlatformCard(@Body body: PlatformCardRequest): Response<PlatformCardResponse>
    @POST("api/v1/admin/pool/collect") suspend fun collect(@Body body: CollectRequest): Response<CollectResponse>
}

sealed interface ApiResult<out T> {
    data class Ok<T>(val data: T) : ApiResult<T>
    /** The session is gone (signed out elsewhere, closed with /logoutall, expired): sign in again. */
    data object Unauthorized : ApiResult<Nothing>
    data class Locked(val retryAfterSeconds: Int) : ApiResult<Nothing>
    data class Failed(val code: Int, val error: String?, val message: String?, val count: Int? = null) : ApiResult<Nothing>
    /** No connection / timeout. */
    data object Offline : ApiResult<Nothing>
}

/** All server calls. Never logs bodies, never stores the code. */
class Repository(private val session: SessionStore) {

    private val gson = Gson()

    private val auth = Interceptor { chain ->
        val token = session.token
        val path = chain.request().url.encodedPath
        val open = path.endsWith("/auth/request-code") || path.endsWith("/auth/verify")
        val req = if (!token.isNullOrBlank() && !open) {
            chain.request().newBuilder().header("Authorization", "Bearer $token").build()
        } else chain.request()
        chain.proceed(req)
    }

    private val http = OkHttpClient.Builder()
        .addInterceptor(auth)
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .writeTimeout(10, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    private val api: AdminApi = Retrofit.Builder()
        .baseUrl(BuildConfig.API_BASE_URL.trimEnd('/') + "/")
        .client(http)
        .addConverterFactory(GsonConverterFactory.create(gson))
        .build()
        .create(AdminApi::class.java)

    private suspend fun <T> call(block: suspend () -> Response<T>): ApiResult<T> = try {
        val r = block()
        when {
            r.isSuccessful -> {
                @Suppress("UNCHECKED_CAST")
                ApiResult.Ok(r.body() ?: (Unit as T))
            }
            r.code() == 401 -> ApiResult.Unauthorized
            else -> {
                val body = runCatching { gson.fromJson(r.errorBody()?.string(), ApiErrorBody::class.java) }.getOrNull()
                if (r.code() == 429) ApiResult.Locked(body?.retryAfterSeconds ?: 900)
                else ApiResult.Failed(r.code(), body?.error, body?.message, body?.count)
            }
        }
    } catch (e: IOException) {
        ApiResult.Offline
    } catch (e: RuntimeException) {
        ApiResult.Failed(0, null, null)
    }

    suspend fun requestCode(telegramUserId: String): ApiResult<RequestCodeResponse> =
        call { api.requestCode(RequestCodeRequest(telegramUserId.trim())) }

    suspend fun verify(telegramUserId: String, code: String, deviceName: String?): ApiResult<VerifyResponse> {
        val r = call { api.verify(VerifyRequest(telegramUserId.trim(), code.trim(), deviceName)) }
        // On the login screen a 401 means "wrong code", not "session expired".
        return if (r is ApiResult.Unauthorized) ApiResult.Failed(401, "INVALID_CODE", null) else r
    }

    suspend fun logout(): ApiResult<Unit> = call { api.logout() }
    suspend fun logoutAll(): ApiResult<LogoutAllResponse> = call { api.logoutAll() }
    suspend fun attention(): ApiResult<AttentionResponse> = call { api.attention() }
    suspend fun ack(key: String, minutes: Int?): ApiResult<AckResponse> = call { api.ack(AckRequest(key, minutes)) }
    suspend fun setQuietHours(off: Boolean, from: String?, to: String?): ApiResult<QuietResponse> =
        call { api.quietHours(if (off) QuietRequest(off = true) else QuietRequest(from = from, to = to)) }

    suspend fun money(): ApiResult<MoneyResponse> = call { api.money() }
    suspend fun handleReview(id: String, action: String, note: String): ApiResult<HandleReviewResponse> =
        call { api.handleReview(id, HandleReviewRequest(action, note.trim())) }
    suspend fun cards(): ApiResult<CardsResponse> = call { api.cards() }
    suspend fun cardDetail(id: String): ApiResult<CardDetailDto> = call { api.cardDetail(id) }
    suspend fun decideCard(id: String, approve: Boolean): ApiResult<DecisionResponse> =
        call { api.decideCard(id, DecisionRequest(if (approve) "APPROVE" else "REJECT")) }
    suspend fun pool(): ApiResult<PoolResponse> = call { api.pool() }
    suspend fun addPlatformCard(number: String, holderName: String): ApiResult<PlatformCardResponse> =
        call { api.addPlatformCard(PlatformCardRequest(number.trim(), holderName.trim())) }
    suspend fun collect(slug: String, on: Boolean): ApiResult<CollectResponse> = call { api.collect(CollectRequest(slug, on)) }
}
