package com.dsdelivery.restaurant.data.api

import com.dsdelivery.restaurant.data.api.dto.SelfDeliveredRequestDto
import com.dsdelivery.restaurant.data.api.dto.AcceptOrderRequestDto
import com.dsdelivery.restaurant.data.api.dto.AddCardRequestDto
import com.dsdelivery.restaurant.data.api.dto.CardResponseDto
import com.dsdelivery.restaurant.data.api.dto.CardsResponseDto
import com.dsdelivery.restaurant.data.api.dto.EmptyBodyDto
import com.dsdelivery.restaurant.data.api.dto.CancelOrderRequestDto
import com.dsdelivery.restaurant.data.api.dto.RefundDecisionRequestDto
import com.dsdelivery.restaurant.data.api.dto.VerifyPaymentRequestDto
import com.dsdelivery.restaurant.data.api.dto.AuthMeResponseDto
import com.dsdelivery.restaurant.data.api.dto.OrdersResponseDto
import com.dsdelivery.restaurant.data.api.dto.PrepTimeRequestDto
import com.dsdelivery.restaurant.data.api.dto.PreparingOrderRequestDto
import com.dsdelivery.restaurant.data.api.dto.ReadyOrderRequestDto
import com.dsdelivery.restaurant.data.api.dto.RejectOrderRequestDto
import com.dsdelivery.restaurant.data.api.dto.CategoriesResponseDto
import com.dsdelivery.restaurant.data.api.dto.CategoryDto
import com.dsdelivery.restaurant.data.api.dto.CreateCategoryRequestDto
import com.dsdelivery.restaurant.data.api.dto.CreateProductRequestDto
import com.dsdelivery.restaurant.data.api.dto.FinanceSummaryDto
import com.dsdelivery.restaurant.data.api.dto.FinanceStateDto
import com.dsdelivery.restaurant.data.api.dto.FinanceUnlockRequestDto
import com.dsdelivery.restaurant.data.api.dto.FinanceOverviewDto
import com.dsdelivery.restaurant.data.api.dto.LedgerDto
import com.dsdelivery.restaurant.data.api.dto.RatingsReportDto
import com.dsdelivery.restaurant.data.api.dto.LoginRequestDto
import com.dsdelivery.restaurant.data.api.dto.LoginResponseDto
import com.dsdelivery.restaurant.data.api.dto.MenuResponseDto
import com.dsdelivery.restaurant.data.api.dto.OperationsResponseDto
import com.dsdelivery.restaurant.data.api.dto.OrderDto
import com.dsdelivery.restaurant.data.api.dto.ProductDto
import com.dsdelivery.restaurant.data.api.dto.ProductsResponseDto
import com.dsdelivery.restaurant.data.api.dto.RestaurantDto
import com.dsdelivery.restaurant.data.api.dto.UpdateAvailabilityRequestDto
import com.dsdelivery.restaurant.data.api.dto.UpdatePrepTimeRequestDto
import com.dsdelivery.restaurant.data.api.dto.UpdateStatusRequestDto
import com.dsdelivery.restaurant.data.api.dto.UpdateWorkingHoursRequestDto
import com.dsdelivery.restaurant.data.api.dto.UpdateCategoryRequestDto
import com.dsdelivery.restaurant.data.api.dto.UpdateProductRequestDto
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Path
import retrofit2.http.Query

interface RestaurantApiService {

    // --- Public endpoints ---
    @GET("health")
    suspend fun getHealth(): Map<String, Any>

    @GET("api/v1/restaurants")
    suspend fun getRestaurants(): List<RestaurantDto>

    @GET("api/v1/restaurants/{slug}/menu")
    suspend fun getPublicMenu(
        @Path("slug") slug: String
    ): MenuResponseDto

    // --- Stage 5A: Restaurant Authentication ---
    @POST("api/v1/restaurant/auth/login")
    suspend fun login(
        @Body body: LoginRequestDto
    ): LoginResponseDto

    @GET("api/v1/restaurant/auth/me")
    suspend fun getAuthMe(): AuthMeResponseDto

    @POST("api/v1/restaurant/auth/logout")
    suspend fun logout(): Response<Unit>

    // --- Stage 5B: Restaurant Products CRUD ---
    @GET("api/v1/restaurant/products")
    suspend fun getProducts(
        @Query("includeArchived") includeArchived: Boolean = false
    ): ProductsResponseDto

    @POST("api/v1/restaurant/products")
    suspend fun createProduct(
        @Body body: CreateProductRequestDto
    ): ProductDto

    @PUT("api/v1/restaurant/products/{id}")
    suspend fun updateProduct(
        @Path("id") id: String,
        @Body body: UpdateProductRequestDto
    ): ProductDto

    @PATCH("api/v1/restaurant/products/{id}/availability")
    suspend fun updateProductAvailability(
        @Path("id") id: String,
        @Body body: UpdateAvailabilityRequestDto
    ): ProductDto

    @DELETE("api/v1/restaurant/products/{id}")
    suspend fun deleteProduct(
        @Path("id") id: String
    ): Response<Unit>

    /** The dish photo as the raw body (image/jpeg), already shrunk by the app. */
    @PUT("api/v1/restaurant/products/{id}/image")
    suspend fun uploadProductImage(
        @Path("id") id: String,
        @Body body: okhttp3.RequestBody
    ): com.dsdelivery.restaurant.data.api.dto.ProductImageResponseDto

    @DELETE("api/v1/restaurant/products/{id}/image")
    suspend fun deleteProductImage(
        @Path("id") id: String
    ): Response<Unit>

    /** The category photo as the raw body (image/jpeg), already shrunk by the app. */
    @PUT("api/v1/restaurant/categories/{id}/image")
    suspend fun uploadCategoryImage(
        @Path("id") id: String,
        @Body body: okhttp3.RequestBody
    ): com.dsdelivery.restaurant.data.api.dto.ProductImageResponseDto

    @DELETE("api/v1/restaurant/categories/{id}/image")
    suspend fun deleteCategoryImage(
        @Path("id") id: String
    ): Response<Unit>

    // --- Stage 5B: Restaurant Categories CRUD ---
    @GET("api/v1/restaurant/categories")
    suspend fun getCategories(): CategoriesResponseDto

    @POST("api/v1/restaurant/categories")
    suspend fun createCategory(
        @Body body: CreateCategoryRequestDto
    ): CategoryDto

    @PUT("api/v1/restaurant/categories/{id}")
    suspend fun updateCategory(
        @Path("id") id: String,
        @Body body: UpdateCategoryRequestDto
    ): CategoryDto

    @DELETE("api/v1/restaurant/categories/{id}")
    suspend fun deleteCategory(
        @Path("id") id: String,
        @Query("reassignTo") reassignTo: String? = null
    ): Response<Unit>

    // --- Stage 6C: Restaurant Orders ---
    @GET("api/v1/restaurant/orders")
    suspend fun getOrders(
        @Query("filter") filter: String = "all",
        @Query("limit") limit: Int = 20,
        @Query("cursor") cursor: String? = null
    ): OrdersResponseDto

    @GET("api/v1/restaurant/orders/{id}")
    suspend fun getOrder(
        @Path("id") id: String
    ): OrderDto

    @POST("api/v1/restaurant/orders/{id}/accept")
    suspend fun acceptOrder(
        @Path("id") id: String,
        @Body body: AcceptOrderRequestDto
    ): OrderDto

    @POST("api/v1/restaurant/orders/{id}/reject")
    suspend fun rejectOrder(
        @Path("id") id: String,
        @Body body: RejectOrderRequestDto
    ): OrderDto

    @POST("api/v1/restaurant/orders/{id}/preparing")
    suspend fun startPreparingOrder(
        @Path("id") id: String,
        @Body body: PreparingOrderRequestDto
    ): OrderDto

    @POST("api/v1/restaurant/orders/{id}/prep-time")
    suspend fun setPrepTime(
        @Path("id") id: String,
        @Body body: PrepTimeRequestDto
    ): OrderDto

    @POST("api/v1/restaurant/orders/{id}/ready")
    suspend fun markOrderReady(
        @Path("id") id: String,
        @Body body: ReadyOrderRequestDto
    ): OrderDto

    /** Walking delivery: the restaurant reports that it brought the order itself. */
    @POST("api/v1/restaurant/orders/{id}/delivered-self")
    suspend fun markDeliveredSelf(
        @Path("id") id: String,
        @Body body: SelfDeliveredRequestDto
    ): OrderDto

    // --- Stage 6E: payment verification, price proposals, cancellation / refunds (Telegram staff panel replaced) ---
    @POST("api/v1/restaurant/orders/{id}/verify-payment")
    suspend fun verifyPayment(@Path("id") id: String, @Body body: VerifyPaymentRequestDto): OrderDto

    @POST("api/v1/restaurant/orders/{id}/cancel")
    suspend fun cancelOrder(@Path("id") id: String, @Body body: CancelOrderRequestDto): OrderDto

    @POST("api/v1/restaurant/orders/{id}/refund/approve")
    suspend fun approveRefund(@Path("id") id: String, @Body body: RefundDecisionRequestDto): OrderDto

    @POST("api/v1/restaurant/orders/{id}/refund/reject")
    suspend fun rejectRefund(@Path("id") id: String, @Body body: RefundDecisionRequestDto): OrderDto

    /** "Qaytarildi": ONE photo of the bank receipt as the raw body (image/jpeg), nothing typed. */
    @POST("api/v1/restaurant/orders/{id}/refund/receipt")
    suspend fun uploadRefundReceipt(@Path("id") id: String, @Query("expectedStatus") expectedStatus: String?, @Body body: okhttp3.RequestBody): OrderDto

    // --- Stage 6B: Restaurant Finance (read-only) ---
    @GET("api/v1/restaurant/finance/summary")
    suspend fun getFinanceSummary(
        @Query("from") from: String,
        @Query("to") to: String
    ): FinanceSummaryDto

    // --- Moliya behind a 4-digit code (owner decision 2026-11-05) ---
    @GET("api/v1/restaurant/finance/state")
    suspend fun getFinanceState(): FinanceStateDto

    /** 200 opened; 403 FINANCE_PIN_WRONG {attemptsLeft}; 429 FINANCE_PIN_BLOCKED {retryAfterSeconds}; 409 FINANCE_NO_PIN. */
    @POST("api/v1/restaurant/finance/unlock")
    suspend fun unlockFinance(@Body body: FinanceUnlockRequestDto): Response<Unit>

    @POST("api/v1/restaurant/finance/lock")
    suspend fun lockFinance(): Response<Unit>

    /** 423 while the code has not been entered. */
    @GET("api/v1/restaurant/finance/overview")
    suspend fun getFinanceOverview(): FinanceOverviewDto

    @GET("api/v1/restaurant/finance/ledger")
    suspend fun getFinanceLedger(
        @Query("filter") filter: String,
        @Query("from") from: String?,
        @Query("to") to: String?,
        @Query("cursor") cursor: String?,
        @Query("limit") limit: Int
    ): LedgerDto

    /** The restaurant's own food ratings and reasons (read-only; never who rated). */
    @GET("api/v1/restaurant/ratings")
    suspend fun getRatings(): RatingsReportDto

    // --- Table reservations: the deposit arrives on the restaurant's card; the list, the "seen" marker, manual confirm, cancel and the settings ---
    @GET("api/v1/restaurant/reservations")
    suspend fun getReservations(): com.dsdelivery.restaurant.data.api.dto.ReservationsReportDto

    @POST("api/v1/restaurant/reservations/{id}/seen")
    suspend fun markReservationSeen(@Path("id") id: String)

    @POST("api/v1/restaurant/reservations/{id}/confirm-payment")
    suspend fun confirmReservationPayment(@Path("id") id: String, @Body body: EmptyBodyDto = EmptyBodyDto())

    @POST("api/v1/restaurant/reservations/{id}/cancel")
    suspend fun cancelReservation(@Path("id") id: String, @Body body: com.dsdelivery.restaurant.data.api.dto.ReservationCancelRequestDto)

    @PUT("api/v1/restaurant/reservations/settings")
    suspend fun updateReservationSettings(@Body body: com.dsdelivery.restaurant.data.api.dto.ReservationSettingsRequestDto)

    // --- Stage 6C: Restaurant Operations ---
    @GET("api/v1/restaurant/operations")
    suspend fun getOperations(): OperationsResponseDto

    @PATCH("api/v1/restaurant/operations/status")
    suspend fun updateOperationsStatus(
        @Body body: UpdateStatusRequestDto
    ): OperationsResponseDto

    @PUT("api/v1/restaurant/operations/working-hours")
    suspend fun updateWorkingHours(
        @Body body: UpdateWorkingHoursRequestDto
    ): OperationsResponseDto

    @PATCH("api/v1/restaurant/operations/prep-time")
    suspend fun updatePrepTime(
        @Body body: UpdatePrepTimeRequestDto
    ): OperationsResponseDto

    // --- Stage 8B: payee cards ---
    @GET("api/v1/restaurant/cards")
    suspend fun getCards(): CardsResponseDto

    @POST("api/v1/restaurant/cards")
    suspend fun addCard(
        @Body body: AddCardRequestDto
    ): CardResponseDto

    @POST("api/v1/restaurant/cards/{id}/disable")
    suspend fun disableCard(
        @Path("id") id: String,
        @Body body: EmptyBodyDto = EmptyBodyDto()
    ): CardResponseDto

    @POST("api/v1/restaurant/cards/{id}/enable")
    suspend fun enableCard(
        @Path("id") id: String,
        @Body body: EmptyBodyDto = EmptyBodyDto()
    ): CardResponseDto
}
