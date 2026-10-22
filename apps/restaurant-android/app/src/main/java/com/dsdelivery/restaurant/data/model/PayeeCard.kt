package com.dsdelivery.restaurant.data.model

/** PENDING: waiting for the platform administrator. ACTIVE: customers are given this card. DISABLED: switched off by the restaurant. */
enum class PayeeCardStatus { PENDING, ACTIVE, DISABLED, REJECTED, UNKNOWN }

data class PayeeCard(
    val id: String,
    val last4: String,
    val masked: String,
    val status: PayeeCardStatus
)

object CardNumber {
    /** Keeps digits only, at most 16. */
    fun digits(input: String): String = input.filter { it.isDigit() }.take(16)

    /** "8600123456781234" -> "8600 1234 5678 1234" */
    fun grouped(digits: String): String = digits.chunked(4).joinToString(" ")

    /** Same typo guard as the server (Luhn). The server decides; this only saves a round trip. */
    fun isValid(digits: String): Boolean {
        if (digits.length != 16 || !digits.all { it.isDigit() }) return false
        var sum = 0
        for (i in digits.indices) {
            var d = digits[digits.length - 1 - i] - '0'
            if (i % 2 == 1) {
                d *= 2
                if (d > 9) d -= 9
            }
            sum += d
        }
        return sum % 10 == 0
    }
}
