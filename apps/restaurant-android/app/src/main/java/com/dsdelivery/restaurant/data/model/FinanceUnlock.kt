package com.dsdelivery.restaurant.data.model

import retrofit2.HttpException

/** Result of typing the 4-digit finance code. */
sealed interface FinanceUnlock {
    data object Opened : FinanceUnlock
    /** Wrong code; [attemptsLeft] before the code is blocked (null when the server did not say). */
    data class Wrong(val attemptsLeft: Int?) : FinanceUnlock
    /** Too many wrong codes: blocked for [retryAfterSeconds]. */
    data class Blocked(val retryAfterSeconds: Int) : FinanceUnlock
    /** An administrator has not issued a code to this restaurant yet. */
    data object NoPin : FinanceUnlock
    data class Failed(val message: String) : FinanceUnlock
}

/** True when a finance request failed because the code is not (or no longer) entered: HTTP 423. */
fun isFinanceLocked(error: Resource.Error): Boolean = (error.cause as? HttpException)?.code() == 423
