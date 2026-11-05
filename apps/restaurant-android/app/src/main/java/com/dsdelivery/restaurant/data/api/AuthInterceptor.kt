package com.dsdelivery.restaurant.data.api

import com.dsdelivery.restaurant.data.auth.SessionManager
import okhttp3.Interceptor
import okhttp3.Response

class AuthInterceptor(
    private val sessionManager: SessionManager
) : Interceptor {

    override fun intercept(chain: Interceptor.Chain): Response {
        val originalRequest = chain.request()
        val url = originalRequest.url.toString()

        val token = sessionManager.getAccessToken()

        val requestBuilder = originalRequest.newBuilder()

        // Attach Bearer token for protected restaurant endpoints
        val isLoginEndpoint = url.contains("/api/v1/restaurant/auth/login")
        if (!token.isNullOrBlank() && !isLoginEndpoint && url.contains("/api/v1/restaurant/")) {
            requestBuilder.header("Authorization", "Bearer $token")
        }

        val response = chain.proceed(requestBuilder.build())

        // Handle expired, revoked, or unauthenticated token (HTTP 401)
        if (response.code == 401 && !isLoginEndpoint && !url.contains("/api/v1/restaurant/finance/unlock")) {
            sessionManager.clearSession()
        }

        return response
    }
}
