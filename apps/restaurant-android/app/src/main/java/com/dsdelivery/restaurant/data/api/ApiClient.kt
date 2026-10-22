package com.dsdelivery.restaurant.data.api

import com.dsdelivery.restaurant.BuildConfig
import com.dsdelivery.restaurant.data.auth.SessionManager
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

class ApiClient(
    private val apiConfig: ApiConfig,
    private val sessionManager: SessionManager
) {

    // Never log bodies (login password, bearer token, finance data); headers are limited to
    // debug builds and the Authorization header is always redacted.
    private val loggingInterceptor = HttpLoggingInterceptor().apply {
        level = if (BuildConfig.DEBUG) {
            HttpLoggingInterceptor.Level.BASIC
        } else {
            HttpLoggingInterceptor.Level.NONE
        }
        redactHeader("Authorization")
    }

    private val authInterceptor = AuthInterceptor(sessionManager)

    private val okHttpClient: OkHttpClient = OkHttpClient.Builder()
        .addInterceptor(authInterceptor)
        .addInterceptor(loggingInterceptor)
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .writeTimeout(15, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    @Volatile
    private var cachedBaseUrl: String? = null

    @Volatile
    private var cachedService: RestaurantApiService? = null

    val service: RestaurantApiService
        get() {
            val currentUrl = apiConfig.baseUrl
            val localService = cachedService
            if (localService != null && cachedBaseUrl == currentUrl) {
                return localService
            }
            return synchronized(this) {
                if (cachedService != null && cachedBaseUrl == currentUrl) {
                    cachedService!!
                } else {
                    val newService = createService(currentUrl)
                    cachedBaseUrl = currentUrl
                    cachedService = newService
                    newService
                }
            }
        }

    private fun createService(baseUrl: String): RestaurantApiService {
        val retrofit = Retrofit.Builder()
            .baseUrl(baseUrl)
            .client(okHttpClient)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
        return retrofit.create(RestaurantApiService::class.java)
    }
}
