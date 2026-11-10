package com.dsdelivery.admin.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PinLockTest {

    @Test fun `a pin is 4 to 8 digits`() {
        assertTrue(PinLock.isValidPin("1234"))
        assertTrue(PinLock.isValidPin("12345678"))
        assertFalse(PinLock.isValidPin("123"))
        assertFalse(PinLock.isValidPin("123456789"))
        assertFalse(PinLock.isValidPin("12a4"))
        assertFalse(PinLock.isValidPin(""))
    }

    @Test fun `the right pin matches and a wrong one does not`() {
        val salt = PinLock.newSalt()
        val hash = PinLock.hash("4821", salt)
        assertTrue(PinLock.matches("4821", salt, hash))
        assertFalse(PinLock.matches("4822", salt, hash))
        assertFalse(PinLock.matches("4821", PinLock.newSalt(), hash))
    }

    @Test fun `the same pin gets a different hash with a different salt`() {
        assertNotEquals(PinLock.hash("4821", PinLock.newSalt()), PinLock.hash("4821", PinLock.newSalt()))
    }

    @Test fun `the hash never contains the pin`() {
        assertFalse(PinLock.hash("4821", "00").contains("4821"))
    }

    @Test fun `lockout grows with the number of wrong tries`() {
        assertEquals(0, PinLock.lockoutSeconds(0))
        assertEquals(0, PinLock.lockoutSeconds(4))
        assertEquals(30, PinLock.lockoutSeconds(5))
        assertEquals(60, PinLock.lockoutSeconds(6))
        assertEquals(120, PinLock.lockoutSeconds(7))
        assertEquals(300, PinLock.lockoutSeconds(8))
        assertEquals(600, PinLock.lockoutSeconds(9))
    }

    @Test fun `the phone is wiped after ten wrong tries`() {
        assertFalse(PinLock.shouldWipe(9))
        assertTrue(PinLock.shouldWipe(10))
    }

    @Test fun `the pin is asked after a cold start or a minute away`() {
        assertTrue(PinLock.needsUnlock(null, 5_000))
        assertFalse(PinLock.needsUnlock(10_000, 69_999))
        assertTrue(PinLock.needsUnlock(10_000, 70_000))
    }

    @Test fun `the keypad opens by itself only at the saved length`() {
        assertTrue(PinLock.autoSubmit(4, 4))
        assertTrue(PinLock.autoSubmit(8, 8))
        assertFalse(PinLock.autoSubmit(3, 4))
        assertFalse(PinLock.autoSubmit(5, 4))
        assertFalse(PinLock.autoSubmit(4, 0)) // length unknown (PIN from an older version): never guess
        assertFalse(PinLock.autoSubmit(9, 9)) // outside the allowed range
    }
}
