package com.dsdelivery.admin.core

import java.security.SecureRandom
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

/**
 * The local PIN lock of the admin app. Pure logic (no Android classes) so it is unit-tested.
 * The PIN only protects the screen on THIS phone; the server session is separate. Wrong tries are slowed down, and after
 * [WIPE_AFTER] wrong tries the phone is signed out (a new Telegram code is needed).
 */
object PinLock {
    const val MIN_LEN = 4
    const val MAX_LEN = 8
    const val WIPE_AFTER = 10
    /** The app asks for the PIN again after it was in the background this long. */
    const val GRACE_MS = 60_000L

    private const val ITERATIONS = 60_000
    private val random = SecureRandom()

    fun isValidPin(pin: String): Boolean = pin.length in MIN_LEN..MAX_LEN && pin.all { it in '0'..'9' }

    fun newSalt(): String {
        val bytes = ByteArray(16)
        random.nextBytes(bytes)
        return bytes.joinToString("") { "%02x".format(it) }
    }

    fun hash(pin: String, salt: String): String {
        val spec = PBEKeySpec(pin.toCharArray(), salt.toByteArray(Charsets.UTF_8), ITERATIONS, 256)
        val bytes = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
        return bytes.joinToString("") { "%02x".format(it) }
    }

    /** Constant-time comparison of the derived hash. */
    fun matches(pin: String, salt: String, expectedHash: String): Boolean {
        val actual = hash(pin, salt)
        if (actual.length != expectedHash.length) return false
        var diff = 0
        for (i in actual.indices) diff = diff or (actual[i].code xor expectedHash[i].code)
        return diff == 0
    }

    /** Seconds the keypad stays locked after [fails] wrong tries in a row (0 = not locked). */
    fun lockoutSeconds(fails: Int): Int = when {
        fails < 5 -> 0
        fails == 5 -> 30
        fails == 6 -> 60
        fails == 7 -> 120
        fails == 8 -> 300
        else -> 600
    }

    fun shouldWipe(fails: Int): Boolean = fails >= WIPE_AFTER

    /** Cold start (never was in the background) or away for at least the grace time. */
    fun needsUnlock(lastBackgroundAtMs: Long?, nowMs: Long, graceMs: Long = GRACE_MS): Boolean =
        lastBackgroundAtMs == null || nowMs - lastBackgroundAtMs >= graceMs
}
