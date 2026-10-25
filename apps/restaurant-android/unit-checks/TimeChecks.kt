package com.dsdelivery.restaurant.unitchecks

import com.dsdelivery.restaurant.data.model.PrepInfo
import com.dsdelivery.restaurant.data.model.ServerClock
import com.dsdelivery.restaurant.data.model.Urgency
import com.dsdelivery.restaurant.data.model.ageMinutes
import com.dsdelivery.restaurant.data.model.ageText
import com.dsdelivery.restaurant.data.model.display
import com.dsdelivery.restaurant.data.model.formatClock
import com.dsdelivery.restaurant.data.model.overdueMinutes
import com.dsdelivery.restaurant.data.model.parseIsoMillis
import com.dsdelivery.restaurant.data.model.urgencyOf

/**
 * Standalone checks for the preparation clock (no JUnit needed: run.ps1 compiles this with the Kotlin compiler from the Gradle cache).
 * Exit code 1 and a message per failed check.
 */
private var failures = 0
private fun check(name: String, actual: Any?, expected: Any?) {
    if (actual == expected) println("  ok   $name") else { failures++; println("  FAIL $name\n       expected: $expected\n       actual:   $actual") }
}

fun main() {
    val serverNow = parseIsoMillis("2026-10-18T10:00:00Z")!!
    val ready = serverNow + 25 * 60_000L                      // 25 minutes of cooking promised
    val received = 5_000L                                      // monotonic clock reading when the response arrived
    val prep = PrepInfo(minutes = 25, startedAtMillis = serverNow, estimatedReadyAtMillis = ready, serverNowMillis = serverNow, receivedAtElapsed = received)
    fun at(secondsAfterReceive: Long) = received + secondsAfterReceive * 1000

    println("countdown before the estimate")
    check("full time left", prep.display(at(0))!!.text, "Qolgan vaqt: 25:00")
    check("one minute later", prep.display(at(60))!!.text, "Qolgan vaqt: 24:00")
    check("last second still shows", prep.display(at(25 * 60 - 1))!!.text, "Qolgan vaqt: 0:01")
    check("not overdue yet", prep.display(at(25 * 60 - 1))!!.overdue, false)
    check("ready clock time (Asia/Tashkent = UTC+5)", prep.display(at(0))!!.detail, "Taxminiy tayyor: 15:25")

    println("the moment it reaches zero (the reported bug: nothing was shown)")
    check("at exactly zero already reads as overdue", prep.display(at(25 * 60))!!.overdue, true)
    check("at zero: headline", prep.display(at(25 * 60))!!.text, "Kechikish: 1 daqiqa")
    check("1 second late", prep.display(at(25 * 60 + 1))!!.text, "Kechikish: 1 daqiqa")
    check("59 seconds late", prep.display(at(25 * 60 + 59))!!.text, "Kechikish: 1 daqiqa")
    check("exactly 1 minute late", prep.display(at(26 * 60))!!.text, "Kechikish: 1 daqiqa")
    check("1 minute 1 second late", prep.display(at(26 * 60 + 1))!!.text, "Kechikish: 2 daqiqa")
    check("7 minutes late", prep.display(at(32 * 60))!!.text, "Kechikish: 7 daqiqa")
    check("overdue exact value", prep.display(at(32 * 60 + 42))!!.detail, "Kechikish 7:42 • rejalashtirilgan 15:25")
    check("keeps growing, 2 hours late", prep.display(at(25 * 60 + 2 * 3600))!!.text, "Kechikish: 120 daqiqa")

    println("clock independence and resume")
    // The model has no wall-clock input: a phone whose clock is wrong by hours changes nothing. Only the monotonic delta matters.
    check("same elapsed delta, same answer", prep.display(at(600))!!.text, prep.display(at(600))!!.text)
    // Backgrounded for 40 minutes: the monotonic clock kept counting, so on resume the order shows the true lateness at once.
    check("after 40 minutes in the background", prep.display(at(40 * 60))!!.text, "Kechikish: 15 daqiqa")
    // A fresh response (new serverNow) replaces the reference; nothing accumulates.
    val refreshed = PrepInfo(25, serverNow, ready, serverNow + 31 * 60_000L, 900_000L)
    check("after a refresh the server time is the reference", refreshed.display(900_000L)!!.text, "Kechikish: 6 daqiqa")

    println("edge cases")
    check("no estimate -> nothing to show", PrepInfo(25, null, null, serverNow, 0L).display(1000L), null)
    check("overdueMinutes(0)", overdueMinutes(0), 0L)
    check("overdueMinutes(-1)", overdueMinutes(-1), 1L)
    check("overdueMinutes(-60)", overdueMinutes(-60), 1L)
    check("overdueMinutes(-61)", overdueMinutes(-61), 2L)

    println("order age / timestamps")
    val clock = ServerClock(serverNow, received)
    val created = serverNow - 7 * 60_000L
    check("age 7 min", ageText(created, clock, received), "7 daq oldin")
    check("age grows with elapsed time", ageText(created, clock, received + 60_000L), "8 daq oldin")
    check("age under a minute", ageText(serverNow - 20_000L, clock, received), "hozirgina")
    check("age 1h05", ageText(serverNow - 65 * 60_000L, clock, received), "1 soat 5 daq oldin")
    check("age 2h", ageText(serverNow - 120 * 60_000L, clock, received), "2 soat oldin")
    check("age 3 days", ageText(serverNow - 3 * 24 * 3600_000L, clock, received), "3 kun oldin")
    check("age unknown", ageText(null, clock, received), null)
    check("formatClock Tashkent", formatClock(serverNow), "15:00")

    println("age colour of an order that waits for the kitchen")
    check("ageMinutes 7", ageMinutes(created, clock, received), 7L)
    check("ageMinutes unknown", ageMinutes(null, clock, received), null)
    check("ageMinutes never negative (created 'in the future')", ageMinutes(serverNow + 60_000L, clock, received), 0L)
    check("0 min is calm", urgencyOf(0), Urgency.CALM)
    check("4 min is calm", urgencyOf(4), Urgency.CALM)
    check("5 min is orange", urgencyOf(5), Urgency.SOON)
    check("9 min is orange", urgencyOf(9), Urgency.SOON)
    check("10 min is red", urgencyOf(10), Urgency.LATE)
    check("unknown age stays calm", urgencyOf(null), Urgency.CALM)

    if (failures > 0) { println("\n$failures check(s) FAILED"); kotlin.system.exitProcess(1) }
    println("\nAll time checks passed")
}
