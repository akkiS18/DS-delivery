package com.dsdelivery.restaurant.data.repository

import com.dsdelivery.restaurant.data.api.ApiClient
import com.dsdelivery.restaurant.data.api.dto.AcceptOrderRequestDto
import com.dsdelivery.restaurant.data.api.dto.CancelOrderRequestDto
import com.dsdelivery.restaurant.data.api.dto.RefundDecisionRequestDto
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import com.dsdelivery.restaurant.data.api.dto.VerifyPaymentRequestDto
import com.dsdelivery.restaurant.data.api.dto.CreateCategoryRequestDto
import com.dsdelivery.restaurant.data.api.dto.CreateProductRequestDto
import com.dsdelivery.restaurant.data.api.dto.LoginRequestDto
import com.dsdelivery.restaurant.data.api.dto.OrderDto
import com.dsdelivery.restaurant.data.api.dto.PreparingOrderRequestDto
import com.dsdelivery.restaurant.data.api.dto.ReadyOrderRequestDto
import com.dsdelivery.restaurant.data.api.dto.RejectOrderRequestDto
import com.dsdelivery.restaurant.data.api.dto.UpdateAvailabilityRequestDto
import com.dsdelivery.restaurant.data.api.dto.UpdateCategoryRequestDto
import com.dsdelivery.restaurant.data.api.dto.UpdatePrepTimeRequestDto
import com.dsdelivery.restaurant.data.api.dto.AddCardRequestDto
import com.dsdelivery.restaurant.data.api.dto.toDomain as cardToDomain
import com.dsdelivery.restaurant.data.model.PayeeCard
import com.dsdelivery.restaurant.data.api.dto.UpdateProductRequestDto
import com.dsdelivery.restaurant.data.api.dto.UpdateStatusRequestDto
import com.dsdelivery.restaurant.data.api.dto.UpdateWorkingHoursRequestDto
import com.dsdelivery.restaurant.data.api.dto.toDto
import com.dsdelivery.restaurant.data.auth.SessionManager
import com.dsdelivery.restaurant.data.auth.SessionState
import com.dsdelivery.restaurant.data.api.dto.toDomain
import com.dsdelivery.restaurant.data.model.Category
import com.dsdelivery.restaurant.data.model.FinanceDateFilter
import com.dsdelivery.restaurant.data.model.FinanceSummary
import com.dsdelivery.restaurant.data.model.Order
import com.dsdelivery.restaurant.data.model.OrdersPage
import com.dsdelivery.restaurant.data.model.Product
import com.dsdelivery.restaurant.data.model.Resource
import com.dsdelivery.restaurant.data.model.Restaurant
import com.dsdelivery.restaurant.data.model.RestaurantMenu
import com.dsdelivery.restaurant.data.model.RestaurantOperationsConfig
import com.dsdelivery.restaurant.data.model.WorkingDay
import com.google.gson.JsonParser
import kotlinx.coroutines.flow.StateFlow
import retrofit2.HttpException
import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException

class RestaurantRepositoryImpl(
    private val apiClient: ApiClient,
    private val sessionManager: SessionManager
) : RestaurantRepository {

    override val sessionState: StateFlow<SessionState> = sessionManager.sessionState

    override fun isLoggedIn(): Boolean = sessionManager.isLoggedIn

    override fun getSessionRestaurant(): Restaurant? = sessionManager.getRestaurant()

    // --- Stage 5A: Real Authentication & Session ---

    override suspend fun login(slug: String, password: String): Resource<Restaurant> {
        return try {
            val response = apiClient.service.login(
                LoginRequestDto(slug = slug.trim(), password = password)
            )

            val restaurant = Restaurant(
                id = response.restaurant.id,
                slug = response.restaurant.slug,
                name = response.restaurant.name,
                isPaused = response.restaurant.isPaused
            )

            // Save token and session in EncryptedSharedPreferences
            sessionManager.saveSession(
                accessToken = response.accessToken,
                restaurant = restaurant,
                expiresAt = response.expiresAt
            )

            Resource.Success(restaurant)
        } catch (e: HttpException) {
            Resource.Error(parseErrorMessage(e), e)
        } catch (e: Exception) {
            Resource.Error(parseGenericException(e), e)
        }
    }

    override suspend fun restoreSession(): Resource<Restaurant> {
        val token = sessionManager.getAccessToken()
        if (token.isNullOrBlank()) {
            sessionManager.clearSession()
            return Resource.Error("Saqlangan sessiya mavjud emas.")
        }

        return try {
            val response = apiClient.service.getAuthMe()
            val restaurant = Restaurant(
                id = response.restaurant.id,
                slug = response.restaurant.slug,
                name = response.restaurant.name,
                isPaused = response.restaurant.isPaused
            )

            sessionManager.saveSession(
                accessToken = token,
                restaurant = restaurant,
                expiresAt = response.session.expiresAt
            )

            Resource.Success(restaurant)
        } catch (e: HttpException) {
            if (e.code() == 401) {
                sessionManager.clearSession()
                Resource.Error("Sessiya muddati tugagan yoki bekor qilingan.", e)
            } else {
                Resource.Error(parseErrorMessage(e), e)
            }
        } catch (e: Exception) {
            // If offline, allow cached restaurant info if available
            val cached = sessionManager.getRestaurant()
            if (cached != null) {
                Resource.Success(cached)
            } else {
                Resource.Error(parseGenericException(e), e)
            }
        }
    }

    override suspend fun logout(): Resource<Unit> {
        return try {
            try {
                apiClient.service.logout()
            } catch (_: Exception) {
                // Ignore network errors on logout
            }
            sessionManager.clearSession()
            Resource.Success(Unit)
        } catch (e: Exception) {
            sessionManager.clearSession()
            Resource.Success(Unit)
        }
    }

    // --- Public / Read-Only Menu (Demo Mode) ---

    override suspend fun getPublicMenu(slug: String): Resource<RestaurantMenu> {
        return try {
            val response = apiClient.service.getPublicMenu(slug)
            val restaurant = Restaurant(
                id = response.id,
                slug = response.slug,
                name = response.name,
                isPaused = response.isPaused
            )
            val categories = response.categories
                .sortedBy { it.position }
                .map {
                    Category(
                        id = it.id,
                        name = it.name,
                        position = it.position,
                        version = 1
                    )
                }
            val products = response.products.map {
                Product(
                    id = it.id,
                    name = it.name,
                    description = it.description,
                    priceSom = it.priceSom,
                    imageUrl = it.imageUrl,
                    categoryId = it.categoryId,
                    isAvailable = it.isAvailable ?: true,
                    archivedAt = null,
                    version = 1
                )
            }
            Resource.Success(
                RestaurantMenu(
                    restaurant = restaurant,
                    categories = categories,
                    products = products
                )
            )
        } catch (e: HttpException) {
            Resource.Error(parseErrorMessage(e), e)
        } catch (e: Exception) {
            Resource.Error(parseGenericException(e), e)
        }
    }

    override suspend fun getRestaurants(): Resource<List<Restaurant>> {
        return try {
            val dtoList = apiClient.service.getRestaurants()
            val list = dtoList.map {
                Restaurant(
                    id = it.id,
                    slug = it.slug,
                    name = it.name,
                    isPaused = it.isPaused
                )
            }
            Resource.Success(list)
        } catch (e: Exception) {
            Resource.Error(parseGenericException(e), e)
        }
    }

    override suspend fun checkHealth(): Resource<Boolean> {
        return try {
            val response = apiClient.service.getHealth()
            val ok = response["ok"] == true
            Resource.Success(ok)
        } catch (e: Exception) {
            Resource.Error(parseGenericException(e), e)
        }
    }

    // --- Stage 5B: Real Protected Products CRUD ---

    override suspend fun getProducts(includeArchived: Boolean): Resource<List<Product>> {
        return try {
            val response = apiClient.service.getProducts(includeArchived = includeArchived)
            val list = response.products.map { dto ->
                Product(
                    id = dto.id,
                    name = dto.name,
                    description = dto.description,
                    priceSom = dto.priceSom,
                    imageUrl = dto.imageUrl,
                    categoryId = dto.categoryId,
                    isAvailable = dto.isAvailable,
                    archivedAt = dto.archivedAt,
                    version = dto.version
                )
            }
            Resource.Success(list)
        } catch (e: HttpException) {
            Resource.Error(parseErrorMessage(e), e)
        } catch (e: Exception) {
            Resource.Error(parseGenericException(e), e)
        }
    }

    override suspend fun createProduct(
        name: String,
        priceSom: Int,
        description: String?,
        categoryId: String?,
        isAvailable: Boolean
    ): Resource<Product> {
        return try {
            // Strict payload: no imageUrl or id (per Stage 5B contract)
            val payload = CreateProductRequestDto(
                name = name.trim(),
                priceSom = priceSom,
                description = description?.trim()?.ifBlank { null },
                categoryId = categoryId,
                isAvailable = isAvailable
            )
            val dto = apiClient.service.createProduct(payload)
            val product = Product(
                id = dto.id,
                name = dto.name,
                description = dto.description,
                priceSom = dto.priceSom,
                imageUrl = dto.imageUrl,
                categoryId = dto.categoryId,
                isAvailable = dto.isAvailable,
                archivedAt = dto.archivedAt,
                version = dto.version
            )
            Resource.Success(product)
        } catch (e: HttpException) {
            Resource.Error(parseErrorMessage(e), e)
        } catch (e: Exception) {
            Resource.Error(parseGenericException(e), e)
        }
    }

    override suspend fun updateProduct(
        id: String,
        name: String,
        priceSom: Int,
        description: String?,
        categoryId: String?,
        version: Int
    ): Resource<Product> {
        return try {
            // Strict payload: requires version, no imageUrl
            val payload = UpdateProductRequestDto(
                name = name.trim(),
                priceSom = priceSom,
                description = description?.trim()?.ifBlank { null },
                categoryId = categoryId,
                version = version
            )
            val dto = apiClient.service.updateProduct(id, payload)
            val product = Product(
                id = dto.id,
                name = dto.name,
                description = dto.description,
                priceSom = dto.priceSom,
                imageUrl = dto.imageUrl,
                categoryId = dto.categoryId,
                isAvailable = dto.isAvailable,
                archivedAt = dto.archivedAt,
                version = dto.version
            )
            Resource.Success(product)
        } catch (e: HttpException) {
            Resource.Error(parseErrorMessage(e), e)
        } catch (e: Exception) {
            Resource.Error(parseGenericException(e), e)
        }
    }

    override suspend fun updateProductAvailability(
        id: String,
        isAvailable: Boolean,
        version: Int?
    ): Resource<Product> {
        return try {
            val payload = UpdateAvailabilityRequestDto(
                isAvailable = isAvailable,
                version = version
            )
            val dto = apiClient.service.updateProductAvailability(id, payload)
            val product = Product(
                id = dto.id,
                name = dto.name,
                description = dto.description,
                priceSom = dto.priceSom,
                imageUrl = dto.imageUrl,
                categoryId = dto.categoryId,
                isAvailable = dto.isAvailable,
                archivedAt = dto.archivedAt,
                version = dto.version
            )
            Resource.Success(product)
        } catch (e: HttpException) {
            Resource.Error(parseErrorMessage(e), e)
        } catch (e: Exception) {
            Resource.Error(parseGenericException(e), e)
        }
    }

    override suspend fun deleteProduct(id: String): Resource<Unit> {
        return try {
            val response = apiClient.service.deleteProduct(id)
            if (response.isSuccessful) {
                Resource.Success(Unit)
            } else {
                Resource.Error("Mahsulotni arxivlab bo‘lmadi (HTTP ${response.code()})")
            }
        } catch (e: HttpException) {
            Resource.Error(parseErrorMessage(e), e)
        } catch (e: Exception) {
            Resource.Error(parseGenericException(e), e)
        }
    }

    // --- Stage 5B: Real Protected Categories CRUD ---

    override suspend fun getCategories(): Resource<List<Category>> {
        return try {
            val response = apiClient.service.getCategories()
            val list = response.categories.map { dto ->
                Category(
                    id = dto.id,
                    name = dto.name,
                    position = dto.position,
                    version = dto.version,
                    productCount = dto.productCount ?: 0
                )
            }
            Resource.Success(list)
        } catch (e: HttpException) {
            Resource.Error(parseErrorMessage(e), e)
        } catch (e: Exception) {
            Resource.Error(parseGenericException(e), e)
        }
    }

    override suspend fun createCategory(name: String, position: Int?): Resource<Category> {
        return try {
            val payload = CreateCategoryRequestDto(
                name = name.trim(),
                position = position
            )
            val dto = apiClient.service.createCategory(payload)
            val category = Category(
                id = dto.id,
                name = dto.name,
                position = dto.position,
                version = dto.version,
                productCount = dto.productCount ?: 0
            )
            Resource.Success(category)
        } catch (e: HttpException) {
            Resource.Error(parseErrorMessage(e), e)
        } catch (e: Exception) {
            Resource.Error(parseGenericException(e), e)
        }
    }

    override suspend fun updateCategory(
        id: String,
        name: String,
        position: Int,
        version: Int
    ): Resource<Category> {
        return try {
            val payload = UpdateCategoryRequestDto(
                name = name.trim(),
                position = position,
                version = version
            )
            val dto = apiClient.service.updateCategory(id, payload)
            val category = Category(
                id = dto.id,
                name = dto.name,
                position = dto.position,
                version = dto.version,
                productCount = dto.productCount ?: 0
            )
            Resource.Success(category)
        } catch (e: HttpException) {
            Resource.Error(parseErrorMessage(e), e)
        } catch (e: Exception) {
            Resource.Error(parseGenericException(e), e)
        }
    }

    override suspend fun deleteCategory(id: String, reassignTo: String?): Resource<Unit> {
        return try {
            val response = apiClient.service.deleteCategory(id, reassignTo)
            if (response.isSuccessful) {
                Resource.Success(Unit)
            } else {
                Resource.Error("Toifani o‘chirib bo‘lmadi (HTTP ${response.code()})")
            }
        } catch (e: HttpException) {
            Resource.Error(parseErrorMessage(e), e)
        } catch (e: Exception) {
            Resource.Error(parseGenericException(e), e)
        }
    }

    // --- Stage 4: Orders & Order Details ---

    override suspend fun getOrders(filter: String, cursor: Int?): Resource<OrdersPage> {
        return try {
            Resource.Success(apiClient.service.getOrders(filter = filter, cursor = cursor).toDomain())
        } catch (e: HttpException) {
            Resource.Error(parseErrorMessage(e), e)
        } catch (e: Exception) {
            Resource.Error(parseGenericException(e), e)
        }
    }

    override suspend fun getOrder(id: String): Resource<Order> {
        return try {
            val response = apiClient.service.getOrder(id.trim())
            Resource.Success(response.toDomain())
        } catch (e: HttpException) {
            Resource.Error(parseErrorMessage(e), e)
        } catch (e: Exception) {
            Resource.Error(parseGenericException(e), e)
        }
    }

    /** Runs one order mutation; the backend answers with the order as it is after the action. */
    private suspend fun orderAction(call: suspend () -> OrderDto): Resource<Order> {
        return try {
            Resource.Success(call().toDomain())
        } catch (e: HttpException) {
            Resource.Error(parseErrorMessage(e), e)
        } catch (e: Exception) {
            Resource.Error(parseGenericException(e), e)
        }
    }

    override suspend fun acceptOrder(id: String, prepMinutes: Int?, expectedStatus: String?): Resource<Order> =
        orderAction { apiClient.service.acceptOrder(id, AcceptOrderRequestDto(prepMinutes, expectedStatus)) }

    override suspend fun rejectOrder(id: String, reasonCode: String, expectedStatus: String?): Resource<Order> =
        orderAction { apiClient.service.rejectOrder(id, RejectOrderRequestDto(reasonCode, expectedStatus)) }

    override suspend fun setOrderPreparing(id: String, prepMinutes: Int?, expectedStatus: String?): Resource<Order> =
        orderAction { apiClient.service.startPreparingOrder(id, PreparingOrderRequestDto(prepMinutes, expectedStatus)) }

    override suspend fun setOrderReady(id: String, expectedStatus: String?): Resource<Order> =
        orderAction { apiClient.service.markOrderReady(id, ReadyOrderRequestDto(expectedStatus)) }

    override suspend fun verifyPayment(id: String, expectedStatus: String?): Resource<Order> =
        orderAction { apiClient.service.verifyPayment(id, VerifyPaymentRequestDto(confirmReceived = true, expectedStatus = expectedStatus)) }

    override suspend fun cancelOrder(id: String, reasonCode: String, expectedStatus: String?): Resource<Order> =
        orderAction { apiClient.service.cancelOrder(id, CancelOrderRequestDto(reasonCode, expectedStatus)) }

    override suspend fun approveRefund(id: String, expectedStatus: String?): Resource<Order> =
        orderAction { apiClient.service.approveRefund(id, RefundDecisionRequestDto(expectedStatus = expectedStatus)) }

    override suspend fun rejectRefund(id: String, reasonCode: String, expectedStatus: String?): Resource<Order> =
        orderAction { apiClient.service.rejectRefund(id, RefundDecisionRequestDto(rejectReason = reasonCode, expectedStatus = expectedStatus)) }

    override suspend fun uploadRefundReceipt(id: String, receiptJpeg: ByteArray, expectedStatus: String?): Resource<Order> =
        orderAction { apiClient.service.uploadRefundReceipt(id, expectedStatus, receiptJpeg.toRequestBody("image/jpeg".toMediaType())) }

    // --- Stage 4: Operations & Settings ---

    override suspend fun updateRestaurantStatus(isPaused: Boolean): Resource<Unit> {
        return try {
            apiClient.service.updateOperationsStatus(UpdateStatusRequestDto(isPaused))
            Resource.Success(Unit)
        } catch (e: HttpException) {
            Resource.Error(parseErrorMessage(e), e)
        } catch (e: Exception) {
            Resource.Error(parseGenericException(e), e)
        }
    }

    override suspend fun getOperationsConfig(): Resource<RestaurantOperationsConfig> {
        return try {
            Resource.Success(apiClient.service.getOperations().toDomain())
        } catch (e: HttpException) {
            Resource.Error(parseErrorMessage(e), e)
        } catch (e: Exception) {
            Resource.Error(parseGenericException(e), e)
        }
    }

    override suspend fun updateWorkingHours(workingDays: List<WorkingDay>): Resource<Unit> {
        return try {
            apiClient.service.updateWorkingHours(UpdateWorkingHoursRequestDto(workingDays.map { it.toDto() }))
            Resource.Success(Unit)
        } catch (e: HttpException) {
            Resource.Error(parseErrorMessage(e), e)
        } catch (e: Exception) {
            Resource.Error(parseGenericException(e), e)
        }
    }

    override suspend fun updateDefaultPrepMinutes(minutes: Int): Resource<Unit> {
        return try {
            apiClient.service.updatePrepTime(UpdatePrepTimeRequestDto(minutes))
            Resource.Success(Unit)
        } catch (e: HttpException) {
            Resource.Error(parseErrorMessage(e), e)
        } catch (e: Exception) {
            Resource.Error(parseGenericException(e), e)
        }
    }

    // --- Stage 8B: payee cards ---

    override suspend fun getCards(): Resource<List<PayeeCard>> {
        return try {
            Resource.Success(apiClient.service.getCards().cards.orEmpty().map { it.cardToDomain() })
        } catch (e: HttpException) {
            Resource.Error(parseErrorMessage(e), e)
        } catch (e: Exception) {
            Resource.Error(parseGenericException(e), e)
        }
    }

    override suspend fun addCard(number: String, password: String): Resource<PayeeCard> {
        return try {
            val card = apiClient.service.addCard(AddCardRequestDto(number, password)).card
                ?: return Resource.Error("Server javobi noto‘g‘ri.", null)
            Resource.Success(card.cardToDomain())
        } catch (e: HttpException) {
            Resource.Error(parseErrorMessage(e), e)
        } catch (e: Exception) {
            Resource.Error(parseGenericException(e), e)
        }
    }

    override suspend fun setCardActive(id: String, active: Boolean): Resource<PayeeCard> {
        return try {
            val response = if (active) apiClient.service.enableCard(id) else apiClient.service.disableCard(id)
            val card = response.card ?: return Resource.Error("Server javobi noto‘g‘ri.", null)
            Resource.Success(card.cardToDomain())
        } catch (e: HttpException) {
            Resource.Error(parseErrorMessage(e), e)
        } catch (e: Exception) {
            Resource.Error(parseGenericException(e), e)
        }
    }

    // --- Stage 4: Finance ---

    override suspend fun getFinanceSummary(filter: FinanceDateFilter): Resource<FinanceSummary> {
        return try {
            val (from, to) = filter.dateRange()
            val response = apiClient.service.getFinanceSummary(from = from, to = to)
            Resource.Success(response.toDomain())
        } catch (e: HttpException) {
            Resource.Error(parseErrorMessage(e), e)
        } catch (e: Exception) {
            Resource.Error(parseGenericException(e), e)
        }
    }

    // --- Error Parser Helper ---

    private fun parseErrorMessage(e: HttpException): String {
        val errorBody = try {
            e.response()?.errorBody()?.string()
        } catch (_: Exception) {
            null
        }

        val parsedCode = try {
            if (!errorBody.isNullOrBlank()) {
                val json = JsonParser.parseString(errorBody).asJsonObject
                json.get("error")?.asString
            } else null
        } catch (_: Exception) {
            null
        }

        return when (e.code()) {
            400 -> when (parsedCode) {
                "CARD_NUMBER_INVALID" -> "Karta raqami noto‘g‘ri."
                "Validation failed" -> "Ma’lumotlar noto‘g‘ri kiritilgan."
                "DATE_FILTER_INVALID" -> "Sana noto‘g‘ri."
                "DATE_RANGE_TOO_LARGE" -> "Sana oralig‘i juda katta (eng ko‘pi 366 kun)."
                else -> parsedCode ?: "So‘rov noto‘g‘ri."
            }
            401 -> when (parsedCode) {
                "INVALID_CREDENTIALS" -> "Restoran kodi yoki parol noto‘g‘ri."
                "UNAUTHENTICATED" -> "Qayta kiring."
                else -> "Qayta kiring."
            }
            403 -> when (parsedCode) {
                "PASSWORD_INVALID" -> "Parol noto‘g‘ri."
                "RESTAURANT_INACTIVE" -> "Restoran to‘xtatilgan. Administrator bilan bog‘laning."
                else -> "Ruxsat yo‘q."
            }
            404 -> when (parsedCode) {
                "NOT_FOUND" -> "Topilmadi."
                else -> "Topilmadi."
            }
            409 -> when (parsedCode) {
                "VERSION_CONFLICT" -> "Boshqa joyda o‘zgartirilgan. Yangilab, qayta urinib ko‘ring."
                "DUPLICATE_NAME" -> "Bunday nom allaqachon bor."
                "CATEGORY_NOT_EMPTY" -> "Toifada taomlar bor. Avval ularni boshqa toifaga o‘tkazing."
                "ARCHIVED" -> "Taom allaqachon olib tashlangan."
                "STALE" -> "Buyurtma allaqachon o‘zgargan. Yangilandi."
                "INVALID_STATE" -> "Hozir bu amalni bajarib bo‘lmaydi."
                "TIMED_OUT" -> "Vaqt tugadi, buyurtma bekor qilindi."
                "RESTAURANT_CLOSED" -> "Qabul to‘xtatilgan. Sozlamalarda yoqing yoki buyurtmani rad eting."
                "PAYMENT_EVIDENCE_INVALID" -> "To‘lov mos kelmadi. Administrator bilan bog‘laning."
                "PRICE_EDIT_REQUIRES_PAUSE" -> "Narxni o‘zgartirish uchun avval Sozlamalarda qabulni to‘xtating."
                "PRICE_PROPOSALS_REMOVED" -> "Buyurtmadan keyin narxni o‘zgartirib bo‘lmaydi."
                "REFUND_ALREADY_OPEN" -> "Bu buyurtma uchun bekor qilish so‘rovi allaqachon bor."
                "NO_OPEN_REFUND" -> "So‘rov topilmadi. Yangilandi."
                "ORDER_PROBLEMS" -> "Qabul qilib bo‘lmaydi: menyu yoki narx o‘zgargan. Buyurtmani rad eting."
                "CARD_TAKEN" -> "Bu kartani qo‘shib bo‘lmaydi: oxirgi 4 raqami band. Administrator bilan bog‘laning."
                "CARD_EXISTS" -> "Bu karta ro‘yxatda bor. Uni yoqing."
                "CARD_LIMIT" -> "Kartalar soni chegaraga yetdi."
                "CARD_PENDING_LIMIT" -> "Tasdiq kutayotgan kartalar bor. Administrator tasdiqlagach yana qo‘shing."
                "NOT_APPROVED" -> "Karta hali tasdiqlanmagan."
                else -> "Bajarib bo‘lmadi. Yangilab, qayta urinib ko‘ring."
            }
            422 -> when (parsedCode) {
                "INVALID_CATEGORY" -> "Toifa noto‘g‘ri tanlangan."
                else -> "Ma’lumotlar noto‘g‘ri."
            }
            429 -> when (parsedCode) {
                "TOO_MANY_ATTEMPTS" -> "Juda ko‘p urinish. Birozdan keyin qayta urining."
                else -> "Juda ko‘p so‘rov. Birozdan keyin qayta urining."
            }
            else -> "Server javob bermadi. Birozdan keyin qayta urining."
        }
    }

    private fun parseGenericException(e: Exception): String {
        return when (e) {
            is ConnectException, is UnknownHostException -> "Serverga ulanib bo‘lmadi. Internetni tekshiring."
            is SocketTimeoutException -> "Internet sekin. Qayta urining."
            is IOException -> "Internet yo‘q."
            else -> "Xatolik yuz berdi. Qayta urining."
        }
    }
}
