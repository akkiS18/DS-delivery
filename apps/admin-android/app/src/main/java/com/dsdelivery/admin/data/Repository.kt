package com.dsdelivery.admin.data

import com.dsdelivery.admin.BuildConfig
import com.google.gson.Gson
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.PUT
import retrofit2.http.Query
import java.io.IOException
import java.util.concurrent.TimeUnit

interface AdminApi {
    @POST("api/v1/admin/auth/request-code") suspend fun requestCode(@Body body: RequestCodeRequest): Response<RequestCodeResponse>
    @POST("api/v1/admin/auth/verify") suspend fun verify(@Body body: VerifyRequest): Response<VerifyResponse>
    @POST("api/v1/admin/auth/logout") suspend fun logout(): Response<Unit>
    @POST("api/v1/admin/auth/logout-all") suspend fun logoutAll(): Response<LogoutAllResponse>
    @GET("api/v1/admin/attention") suspend fun attention(): Response<AttentionResponse>
    @GET("api/v1/admin/today") suspend fun today(): Response<TodayDto>
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

    @GET("api/v1/admin/settings") suspend fun settings(): Response<SettingsDto>
    @PUT("api/v1/admin/settings/payments") suspend fun setPayments(@Body body: OpenRequest): Response<SettingsChangeResponse>
    @PUT("api/v1/admin/settings/cash") suspend fun setCash(@Body body: EnabledRequest): Response<SettingsChangeResponse>
    @PUT("api/v1/admin/settings/cash-max") suspend fun setCashMax(@Body body: CashMaxRequest): Response<SettingsChangeResponse>
    @PUT("api/v1/admin/settings/fee") suspend fun setFee(@Body body: FeeRequest): Response<SettingsChangeResponse>
    @PUT("api/v1/admin/settings/taxi-mode") suspend fun setTaxiMode(@Body body: ModeRequest): Response<SettingsChangeResponse>
    @PUT("api/v1/admin/settings/ranking") suspend fun setRanking(@Body body: EnabledRequest): Response<SettingsChangeResponse>
    @GET("api/v1/admin/ratings") suspend fun ratings(): Response<RatingsDto>
    @GET("api/v1/admin/restaurants") suspend fun restaurants(): Response<RestaurantsResponse>
    @PUT("api/v1/admin/restaurants/{id}/active") suspend fun setRestaurantActive(@Path("id") id: String, @Body body: ActiveRequest): Response<ActiveResponse>
    @POST("api/v1/admin/restaurants") suspend fun createRestaurant(@Body body: CreateRestaurantRequest): Response<CredentialResponse>
    @POST("api/v1/admin/restaurants/{id}/password") suspend fun resetPassword(@Path("id") id: String): Response<CredentialResponse>
    @POST("api/v1/admin/restaurants/{id}/finance-pin") suspend fun issueFinancePin(@Path("id") id: String): Response<FinancePinResponse>
    @PUT("api/v1/admin/restaurants/{id}/staff") suspend fun linkStaff(@Path("id") id: String, @Body body: StaffRequest): Response<NameResponse>
    @PUT("api/v1/admin/restaurants/{id}/image") suspend fun setRestaurantImage(@Path("id") id: String, @Body body: RequestBody): Response<ImageResponse>
    @GET("api/v1/admin/restaurants/{id}/removal") suspend fun removalPlan(@Path("id") id: String): Response<RemovalPlanResponse>
    @POST("api/v1/admin/restaurants/{id}/remove") suspend fun removeRestaurant(@Path("id") id: String, @Body body: RemoveRequest): Response<RemoveResponse>
    @GET("api/v1/admin/tickets") suspend fun tickets(): Response<InboxResponse>
    @GET("api/v1/admin/tickets/{id}") suspend fun ticket(@Path("id") id: String): Response<ThreadDto>
    @POST("api/v1/admin/tickets/{id}/claim") suspend fun claimTicket(@Path("id") id: String, @Body body: KeyRequest): Response<TicketActionResponse>
    @POST("api/v1/admin/tickets/{id}/resolve") suspend fun resolveTicket(@Path("id") id: String, @Body body: KeyRequest): Response<TicketActionResponse>
    @POST("api/v1/admin/tickets/{id}/reopen") suspend fun reopenTicket(@Path("id") id: String, @Body body: KeyRequest): Response<TicketActionResponse>
    @POST("api/v1/admin/tickets/{id}/reassign") suspend fun reassignTicket(@Path("id") id: String, @Body body: ReassignRequest): Response<TicketActionResponse>
    @POST("api/v1/admin/tickets/{id}/reply") suspend fun replyTicket(@Path("id") id: String, @Body body: ReplyRequest): Response<TicketActionResponse>
    @GET("api/v1/admin/taxi/problems") suspend fun taxiProblems(): Response<ProblemsResponse>
    @GET("api/v1/admin/taxi/problems/{id}") suspend fun taxiProblem(@Path("id") id: String): Response<ProblemDetailDto>
    @POST("api/v1/admin/taxi/problems/{id}/recover") suspend fun taxiRecover(@Path("id") id: String, @Body body: RecoverRequest): Response<RecoverResponse>
    @GET("api/v1/admin/taxi/companies") suspend fun taxiCompanies(): Response<CompaniesResponse>
    @POST("api/v1/admin/taxi/companies") suspend fun createTaxiCompany(@Body body: NameRequest): Response<TaxiCredentialResponse>
    @POST("api/v1/admin/taxi/companies/{id}/password") suspend fun resetTaxiPassword(@Path("id") id: String): Response<TaxiCredentialResponse>
    @GET("api/v1/admin/taxi/companies/{id}/removal") suspend fun taxiRemovalPlan(@Path("id") id: String): Response<RemovalPlanResponse>
    @POST("api/v1/admin/taxi/companies/{id}/remove") suspend fun removeTaxiCompany(@Path("id") id: String, @Body body: RemoveRequest): Response<RemoveResponse>
    @GET("api/v1/admin/refunds") suspend fun refunds(): Response<RefundsResponse>
    @GET("api/v1/admin/refunds/{id}") suspend fun refund(@Path("id") id: String): Response<RefundDetailDto>
    @POST("api/v1/admin/refunds/{id}/confirm") suspend fun confirmRefund(@Path("id") id: String, @Body body: ConfirmRefundRequest): Response<OkResponse>
    @POST("api/v1/admin/refunds/{id}/sent") suspend fun sentRefund(@Path("id") id: String, @Body body: SentRefundRequest): Response<OkResponse>
    @GET("api/v1/admin/payouts") suspend fun payouts(@Query("days") days: Int): Response<PayoutsResponse>
    @GET("api/v1/admin/payouts/{date}/{restaurantId}") suspend fun payoutDay(@Path("date") date: String, @Path("restaurantId") restaurantId: String): Response<PayoutDetailDto>
    @POST("api/v1/admin/payouts/{date}/{restaurantId}/paid") suspend fun markPaid(@Path("date") date: String, @Path("restaurantId") restaurantId: String, @Body body: PaidRequest): Response<PaidResponse>
    @POST("api/v1/admin/payouts/{date}/{restaurantId}/unpaid") suspend fun unmarkPaid(@Path("date") date: String, @Path("restaurantId") restaurantId: String, @Body body: NoteRequest): Response<OkResponse>
    @GET("api/v1/admin/customers") suspend fun customers(@Query("q") q: String?): Response<CustomersResponse>
    @GET("api/v1/admin/customers/{id}") suspend fun customer(@Path("id") id: String): Response<CustomerDetailDto>
    @POST("api/v1/admin/customers/{id}/strikes") suspend fun addStrike(@Path("id") id: String, @Body body: StrikeRequest): Response<StandingResponse>
    @POST("api/v1/admin/customers/{id}/strikes/{strikeId}/revoke") suspend fun revokeStrike(@Path("id") id: String, @Path("strikeId") strikeId: String, @Body body: NoteRequest): Response<StandingResponse>
    @POST("api/v1/admin/customers/{id}/block") suspend fun blockCustomer(@Path("id") id: String, @Body body: NoteRequest): Response<StandingResponse>
    @POST("api/v1/admin/customers/{id}/unblock") suspend fun unblockCustomer(@Path("id") id: String, @Body body: NoteRequest): Response<StandingResponse>
    @GET("api/v1/admin/commission") suspend fun commission(): Response<StatementsResponse>
    @POST("api/v1/admin/commission/{id}/settle") suspend fun settle(@Path("id") id: String, @Body body: SettleRequest): Response<SettleResponse>

    @GET("api/v1/admin/landmarks") suspend fun landmarks(): Response<LandmarksResponse>
    @POST("api/v1/admin/landmarks") suspend fun createLandmark(@Body body: CreateLandmarkRequest): Response<CreatedResponse>
    @PUT("api/v1/admin/landmarks/{id}") suspend fun updateLandmark(@Path("id") id: String, @Body body: PatchLandmarkRequest): Response<OkResponse>
    @DELETE("api/v1/admin/landmarks/{id}") suspend fun deleteLandmark(@Path("id") id: String): Response<OkResponse>
    @GET("api/v1/admin/promo") suspend fun promo(): Response<PromoOverviewDto>
    @POST("api/v1/admin/promo/promotions") suspend fun createPromotion(@Body body: CreatePromoRequest): Response<CreatedResponse>
    @PUT("api/v1/admin/promo/promotions/{id}") suspend fun updatePromotion(@Path("id") id: String, @Body body: PatchPromoRequest): Response<OkResponse>
    @DELETE("api/v1/admin/promo/promotions/{id}") suspend fun deletePromotion(@Path("id") id: String): Response<OkResponse>
    @POST("api/v1/admin/promo/banners") suspend fun createSlide(@Body body: CreateSlideRequest): Response<CreatedResponse>
    @PUT("api/v1/admin/promo/banners/{id}") suspend fun updateSlide(@Path("id") id: String, @Body body: PatchSlideRequest): Response<OkResponse>
    @DELETE("api/v1/admin/promo/banners/{id}") suspend fun deleteSlide(@Path("id") id: String): Response<OkResponse>
    @PUT("api/v1/admin/promo/banners/{id}/image") suspend fun setSlideImage(@Path("id") id: String, @Body body: RequestBody): Response<ImageResponse>
    @GET("api/v1/admin/promo/banners/{id}/image") suspend fun slideImage(@Path("id") id: String): Response<ResponseBody>
}

sealed interface ApiResult<out T> {
    data class Ok<T>(val data: T) : ApiResult<T>
    /** The session is gone (signed out elsewhere, closed with /logoutall, expired): sign in again. */
    data object Unauthorized : ApiResult<Nothing>
    data class Locked(val retryAfterSeconds: Int) : ApiResult<Nothing>
    data class Failed(
        val code: Int, val error: String?, val message: String?, val count: Int? = null,
        val blockers: List<String>? = null, val amountSom: Long? = null,
        /** The one extra word some refusals carry (TELEGRAM_TAKEN: the other restaurant's slug; REMOVAL_BLOCKED: the reason). */
        val detail: String? = null,
    ) : ApiResult<Nothing>
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
                else ApiResult.Failed(r.code(), body?.error, body?.message, body?.count, body?.blockers, body?.amountSom, body?.otherSlug ?: body?.reason ?: body?.assignedAdminName ?: body?.number?.toString())
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
    suspend fun today(): ApiResult<TodayDto> = call { api.today() }
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

    suspend fun settings(): ApiResult<SettingsDto> = call { api.settings() }
    suspend fun setPayments(open: Boolean): ApiResult<SettingsChangeResponse> = call { api.setPayments(OpenRequest(open)) }
    suspend fun setCash(enabled: Boolean): ApiResult<SettingsChangeResponse> = call { api.setCash(EnabledRequest(enabled)) }
    suspend fun setFee(mode: String, percent: Double?, lineSom: Int? = null, lineWaived: Boolean? = null): ApiResult<SettingsChangeResponse> =
        call { api.setFee(FeeRequest(mode, percent, lineSom, lineWaived)) }
    suspend fun setCashMax(maxOrderSom: Long): ApiResult<SettingsChangeResponse> = call { api.setCashMax(CashMaxRequest(maxOrderSom)) }
    suspend fun setTaxiMode(mode: String): ApiResult<SettingsChangeResponse> = call { api.setTaxiMode(ModeRequest(mode)) }
    suspend fun setRanking(enabled: Boolean): ApiResult<SettingsChangeResponse> = call { api.setRanking(EnabledRequest(enabled)) }
    suspend fun ratings(): ApiResult<RatingsDto> = call { api.ratings() }
    suspend fun restaurants(): ApiResult<RestaurantsResponse> = call { api.restaurants() }
    suspend fun setRestaurantActive(id: String, active: Boolean): ApiResult<ActiveResponse> = call { api.setRestaurantActive(id, ActiveRequest(active)) }
    suspend fun createRestaurant(name: String, address: String, phone: String): ApiResult<CredentialResponse> =
        call { api.createRestaurant(CreateRestaurantRequest(name.trim(), address.trim(), phone.trim().ifEmpty { null })) }
    suspend fun resetPassword(id: String): ApiResult<CredentialResponse> = call { api.resetPassword(id) }
    suspend fun issueFinancePin(id: String): ApiResult<FinancePinResponse> = call { api.issueFinancePin(id) }
    suspend fun linkStaff(id: String, telegramId: String): ApiResult<NameResponse> = call { api.linkStaff(id, StaffRequest(telegramId.trim())) }
    /** [jpeg] is already shrunk by ImagePrep; the server decides the type from the bytes. */
    suspend fun setRestaurantImage(id: String, jpeg: ByteArray): ApiResult<ImageResponse> =
        call { api.setRestaurantImage(id, jpeg.toRequestBody("image/jpeg".toMediaType())) }
    suspend fun removalPlan(id: String): ApiResult<RemovalPlanResponse> = call { api.removalPlan(id) }
    suspend fun removeRestaurant(id: String, expected: String): ApiResult<RemoveResponse> = call { api.removeRestaurant(id, RemoveRequest(expected)) }
    suspend fun tickets(): ApiResult<InboxResponse> = call { api.tickets() }
    suspend fun ticket(id: String): ApiResult<ThreadDto> = call { api.ticket(id) }
    suspend fun claimTicket(id: String, key: String): ApiResult<TicketActionResponse> = call { api.claimTicket(id, KeyRequest(key)) }
    suspend fun resolveTicket(id: String, key: String): ApiResult<TicketActionResponse> = call { api.resolveTicket(id, KeyRequest(key)) }
    suspend fun reopenTicket(id: String, key: String): ApiResult<TicketActionResponse> = call { api.reopenTicket(id, KeyRequest(key)) }
    suspend fun reassignTicket(id: String, key: String, target: String): ApiResult<TicketActionResponse> = call { api.reassignTicket(id, ReassignRequest(key, target)) }
    suspend fun replyTicket(id: String, key: String, text: String): ApiResult<TicketActionResponse> = call { api.replyTicket(id, ReplyRequest(key, text.trim())) }
    suspend fun taxiProblems(): ApiResult<ProblemsResponse> = call { api.taxiProblems() }
    suspend fun taxiProblem(id: String): ApiResult<ProblemDetailDto> = call { api.taxiProblem(id) }
    suspend fun taxiRecover(id: String, action: String, note: String, companyId: String? = null): ApiResult<RecoverResponse> =
        call { api.taxiRecover(id, RecoverRequest(action, note.trim(), companyId)) }
    suspend fun taxiCompanies(): ApiResult<CompaniesResponse> = call { api.taxiCompanies() }
    suspend fun createTaxiCompany(name: String): ApiResult<TaxiCredentialResponse> = call { api.createTaxiCompany(NameRequest(name.trim())) }
    suspend fun resetTaxiPassword(id: String): ApiResult<TaxiCredentialResponse> = call { api.resetTaxiPassword(id) }
    suspend fun taxiRemovalPlan(id: String): ApiResult<RemovalPlanResponse> = call { api.taxiRemovalPlan(id) }
    suspend fun removeTaxiCompany(id: String, expected: String): ApiResult<RemoveResponse> = call { api.removeTaxiCompany(id, RemoveRequest(expected)) }
    suspend fun refunds(): ApiResult<RefundsResponse> = call { api.refunds() }
    suspend fun refund(id: String): ApiResult<RefundDetailDto> = call { api.refund(id) }
    suspend fun sentRefund(id: String, bankReference: String): ApiResult<OkResponse> = call { api.sentRefund(id, SentRefundRequest(bankReference.trim())) }
    suspend fun confirmRefund(id: String, note: String): ApiResult<OkResponse> = call { api.confirmRefund(id, ConfirmRefundRequest(note.trim())) }
    suspend fun payouts(days: Int = 7): ApiResult<PayoutsResponse> = call { api.payouts(days) }
    suspend fun payoutDay(date: String, restaurantId: String): ApiResult<PayoutDetailDto> = call { api.payoutDay(date, restaurantId) }
    suspend fun markPaid(date: String, restaurantId: String, expectedSom: Long, note: String): ApiResult<PaidResponse> =
        call { api.markPaid(date, restaurantId, PaidRequest(expectedSom, note.trim().ifEmpty { null })) }
    suspend fun unmarkPaid(date: String, restaurantId: String, note: String): ApiResult<OkResponse> = call { api.unmarkPaid(date, restaurantId, NoteRequest(note.trim())) }
    suspend fun customers(q: String?): ApiResult<CustomersResponse> = call { api.customers(q?.trim()?.ifEmpty { null }) }
    suspend fun customer(id: String): ApiResult<CustomerDetailDto> = call { api.customer(id) }
    suspend fun addStrike(id: String, note: String, orderCode: String? = null): ApiResult<StandingResponse> =
        call { api.addStrike(id, StrikeRequest(note.trim(), orderCode?.trim()?.ifEmpty { null })) }
    suspend fun revokeStrike(id: String, strikeId: String, note: String): ApiResult<StandingResponse> = call { api.revokeStrike(id, strikeId, NoteRequest(note.trim())) }
    suspend fun blockCustomer(id: String, note: String): ApiResult<StandingResponse> = call { api.blockCustomer(id, NoteRequest(note.trim())) }
    suspend fun unblockCustomer(id: String, note: String): ApiResult<StandingResponse> = call { api.unblockCustomer(id, NoteRequest(note.trim())) }
    suspend fun commission(): ApiResult<StatementsResponse> = call { api.commission() }
    suspend fun settle(id: String, count: Int, som: Long, note: String): ApiResult<SettleResponse> = call { api.settle(id, SettleRequest(count, som, note.trim())) }

    suspend fun landmarks(): ApiResult<LandmarksResponse> = call { api.landmarks() }
    suspend fun createLandmark(name: String, kind: String, lat: Double, lng: Double): ApiResult<CreatedResponse> = call { api.createLandmark(CreateLandmarkRequest(name.trim(), kind, lat, lng)) }
    suspend fun updateLandmark(id: String, patch: PatchLandmarkRequest): ApiResult<OkResponse> = call { api.updateLandmark(id, patch) }
    suspend fun setLandmarkActive(id: String, active: Boolean): ApiResult<OkResponse> = call { api.updateLandmark(id, PatchLandmarkRequest(isActive = active)) }
    suspend fun deleteLandmark(id: String): ApiResult<OkResponse> = call { api.deleteLandmark(id) }
    suspend fun promo(): ApiResult<PromoOverviewDto> = call { api.promo() }
    suspend fun createPromotion(restaurantId: String, title: String): ApiResult<CreatedResponse> = call { api.createPromotion(CreatePromoRequest(restaurantId, title.trim())) }
    suspend fun setPromotionActive(id: String, active: Boolean): ApiResult<OkResponse> = call { api.updatePromotion(id, PatchPromoRequest(isActive = active)) }
    suspend fun setPromotionDishes(id: String, productIds: List<String>): ApiResult<OkResponse> = call { api.updatePromotion(id, PatchPromoRequest(productIds = productIds)) }
    /** 0 removes the cap. */
    suspend fun setPromotionCap(id: String, cap: Int): ApiResult<OkResponse> = call { api.updatePromotion(id, PatchPromoRequest(maxFreePerOrder = cap)) }
    suspend fun deletePromotion(id: String): ApiResult<OkResponse> = call { api.deletePromotion(id) }
    suspend fun createSlide(title: String, restaurantId: String?, promotionId: String?): ApiResult<CreatedResponse> =
        call { api.createSlide(CreateSlideRequest(title.trim(), restaurantId, promotionId)) }
    suspend fun setSlideActive(id: String, active: Boolean): ApiResult<OkResponse> = call { api.updateSlide(id, PatchSlideRequest(isActive = active)) }
    suspend fun setSlidePosition(id: String, position: Int): ApiResult<OkResponse> = call { api.updateSlide(id, PatchSlideRequest(position = position)) }
    suspend fun deleteSlide(id: String): ApiResult<OkResponse> = call { api.deleteSlide(id) }
    /** [jpeg] is already shrunk by ImagePrep (<= 900 KB); the server decides the type from the bytes. */
    suspend fun setSlideImage(id: String, jpeg: ByteArray): ApiResult<ImageResponse> = call { api.setSlideImage(id, jpeg.toRequestBody("image/jpeg".toMediaType())) }
    /** The slide's picture for the administrator's own preview; null when it cannot be read. Blocking body read: runs on the caller's dispatcher. */
    suspend fun slideImage(id: String): ByteArray? = when (val r = call { api.slideImage(id) }) {
        is ApiResult.Ok -> try { r.data.bytes() } catch (e: IOException) { null }
        else -> null
    }
}
