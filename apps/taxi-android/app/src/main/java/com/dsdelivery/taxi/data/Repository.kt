package com.dsdelivery.taxi.data

import com.dsdelivery.taxi.BuildConfig
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
import java.io.IOException
import java.util.concurrent.TimeUnit

interface TaxiApi {
    @POST("api/v1/taxi/auth/login") suspend fun login(@Body body: LoginRequest): Response<LoginResponse>
    @POST("api/v1/taxi/auth/logout") suspend fun logout(): Response<Unit>
    @GET("api/v1/taxi/requests") suspend fun requests(): Response<RequestsResponse>
    @POST("api/v1/taxi/requests/{id}/action") suspend fun act(@Path("id") id: String, @Body body: ActionRequest): Response<ActionResponse>
}

sealed interface ApiResult<out T> {
    data class Ok<T>(val data: T) : ApiResult<T>
    /** The session is gone (password changed, signed out elsewhere, expired): sign in again. */
    data object Unauthorized : ApiResult<Nothing>
    data class Locked(val retryAfterSeconds: Int) : ApiResult<Nothing>
    /** The server answered with an error; [message] is already in Uzbek when the server supplied one. */
    data class Failed(val code: Int, val error: String?, val message: String?) : ApiResult<Nothing>
    /** No connection / timeout. */
    data object Offline : ApiResult<Nothing>
}

/** All server calls. Never logs bodies, never stores the password. */
class Repository(private val session: SessionStore) {

    private val gson = Gson()

    private val auth = Interceptor { chain ->
        val token = session.token
        val req = if (!token.isNullOrBlank() && !chain.request().url.encodedPath.endsWith("/auth/login")) {
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

    private val api: TaxiApi = Retrofit.Builder()
        .baseUrl(BuildConfig.API_BASE_URL.trimEnd('/') + "/")
        .client(http)
        .addConverterFactory(GsonConverterFactory.create(gson))
        .build()
        .create(TaxiApi::class.java)

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
                else ApiResult.Failed(r.code(), body?.error, body?.message)
            }
        }
    } catch (e: IOException) {
        ApiResult.Offline
    } catch (e: RuntimeException) {
        ApiResult.Failed(0, null, null)
    }

    suspend fun login(login: String, password: String): ApiResult<LoginResponse> {
        val r = call { api.login(LoginRequest(login.trim().lowercase(), password)) }
        // On the login screen a 401 means "wrong login or password", not "session expired".
        return if (r is ApiResult.Unauthorized) ApiResult.Failed(401, "INVALID_CREDENTIALS", null) else r
    }

    suspend fun logout(): ApiResult<Unit> = call { api.logout() }
    suspend fun requests(): ApiResult<RequestsResponse> = call { api.requests() }
    suspend fun act(id: String, action: String): ApiResult<ActionResponse> = call { api.act(id, ActionRequest(action)) }
}
