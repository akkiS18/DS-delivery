package com.dsdelivery.restaurant.data.repository

import com.dsdelivery.restaurant.data.auth.SessionState
import com.dsdelivery.restaurant.data.model.Category
import com.dsdelivery.restaurant.data.model.Product
import com.dsdelivery.restaurant.data.model.Resource
import com.dsdelivery.restaurant.data.model.Restaurant
import com.dsdelivery.restaurant.data.model.RestaurantMenu
import kotlinx.coroutines.flow.StateFlow

interface RestaurantRepository {

    // --- Session & Auth (Stage 5A) ---
    val sessionState: StateFlow<SessionState>
    fun isLoggedIn(): Boolean
    fun getSessionRestaurant(): Restaurant?
    suspend fun login(slug: String, password: String): Resource<Restaurant>
    suspend fun restoreSession(): Resource<Restaurant>
    suspend fun logout(): Resource<Unit>

    // --- Public / Read-Only (Stage 1) ---
    suspend fun getPublicMenu(slug: String): Resource<RestaurantMenu>
    suspend fun getRestaurants(): Resource<List<Restaurant>>
    suspend fun checkHealth(): Resource<Boolean>

    // --- Protected Restaurant Catalog CRUD (Stage 5B) ---
    suspend fun getProducts(includeArchived: Boolean = false): Resource<List<Product>>
    suspend fun createProduct(
        name: String,
        priceSom: Int,
        description: String?,
        categoryId: String?,
        isAvailable: Boolean = true
    ): Resource<Product>
    suspend fun updateProduct(
        id: String,
        name: String,
        priceSom: Int,
        description: String?,
        categoryId: String?,
        version: Int
    ): Resource<Product>
    suspend fun updateProductAvailability(
        id: String,
        isAvailable: Boolean,
        version: Int? = null
    ): Resource<Product>
    suspend fun deleteProduct(id: String): Resource<Unit>

    suspend fun getCategories(): Resource<List<Category>>
    suspend fun createCategory(name: String, position: Int? = null): Resource<Category>
    suspend fun updateCategory(id: String, name: String, position: Int, version: Int): Resource<Category>
    suspend fun deleteCategory(id: String, reassignTo: String? = null): Resource<Unit>

    // --- Stage 4: Orders & Order Details ---
    /** [filter] is one of all|incoming|inProgress|ready|history; [cursor] is the previous page's nextCursor. */
    suspend fun getOrders(filter: String = "all", cursor: Int? = null): Resource<com.dsdelivery.restaurant.data.model.OrdersPage>
    suspend fun getOrder(id: String): Resource<com.dsdelivery.restaurant.data.model.Order>

    /** Actions return the server's updated order. [expectedStatus] is the status the user was looking at. */
    /** [prepMinutes] null = use the restaurant's default preparation time (set in Sozlamalar). */
    suspend fun acceptOrder(id: String, prepMinutes: Int?, expectedStatus: String?): Resource<com.dsdelivery.restaurant.data.model.Order>
    suspend fun rejectOrder(id: String, reasonCode: String, expectedStatus: String?): Resource<com.dsdelivery.restaurant.data.model.Order>
    suspend fun setOrderPreparing(id: String, prepMinutes: Int?, expectedStatus: String?): Resource<com.dsdelivery.restaurant.data.model.Order>
    suspend fun setOrderReady(id: String, expectedStatus: String?): Resource<com.dsdelivery.restaurant.data.model.Order>

    /** The restaurant explicitly confirms the real bank credit. Cooking then starts by itself. */
    suspend fun verifyPayment(id: String, expectedStatus: String?): Resource<com.dsdelivery.restaurant.data.model.Order>
    suspend fun cancelOrder(id: String, reasonCode: String, expectedStatus: String?): Resource<com.dsdelivery.restaurant.data.model.Order>
    suspend fun approveRefund(id: String, expectedStatus: String?): Resource<com.dsdelivery.restaurant.data.model.Order>
    suspend fun rejectRefund(id: String, reasonCode: String, expectedStatus: String?): Resource<com.dsdelivery.restaurant.data.model.Order>
    suspend fun markRefundSent(id: String, bankReference: String, expectedStatus: String?): Resource<com.dsdelivery.restaurant.data.model.Order>

    // --- Stage 4: Operations & Settings ---
    suspend fun updateRestaurantStatus(isPaused: Boolean): Resource<Unit>
    suspend fun getOperationsConfig(): Resource<com.dsdelivery.restaurant.data.model.RestaurantOperationsConfig>
    suspend fun updateWorkingHours(workingDays: List<com.dsdelivery.restaurant.data.model.WorkingDay>): Resource<Unit>
    suspend fun updateDefaultPrepMinutes(minutes: Int): Resource<Unit>

    // --- Stage 4: Finance ---
    suspend fun getFinanceSummary(filter: com.dsdelivery.restaurant.data.model.FinanceDateFilter): Resource<com.dsdelivery.restaurant.data.model.FinanceSummary>
}
