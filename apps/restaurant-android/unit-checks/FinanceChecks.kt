package com.dsdelivery.restaurant.unitchecks

import com.dsdelivery.restaurant.data.model.FinanceFormat

private var failures = 0
private fun check(name: String, actual: Any?, expected: Any?) {
    if (actual == expected) println("ok   $name") else { failures++; println("FAIL $name: expected <$expected> got <$actual>") }
}

fun main() {
    val n = ' '
    check("small amount in full", FinanceFormat.som(450_000), "450${n}000 so‘m")
    check("zero", FinanceFormat.som(0), "0 so‘m")
    check("under 10 mln stays in full", FinanceFormat.som(9_999_999), "9${n}999${n}999 so‘m")
    check("10 mln is shortened", FinanceFormat.som(10_000_000), "10 mln so‘m")
    check("12.4 mln", FinanceFormat.som(12_400_000), "12,4 mln so‘m")
    check("billions", FinanceFormat.som(1_250_000_000), "1,3 mlrd so‘m")
    check("negative", FinanceFormat.som(-5_000), "−5${n}000 so‘m")
    check("signed plus", FinanceFormat.signed(49_000), "+49${n}000 so‘m")
    check("signed minus", FinanceFormat.signed(-5_000), "−5${n}000 so‘m")
    check("share of a half", FinanceFormat.share(450_000, 900_000), 0.5f)
    check("share with nothing earned", FinanceFormat.share(10, 0), 0f)
    check("share never above 1", FinanceFormat.share(2_000, 1_000), 1f)
    if (failures > 0) { println("$failures check(s) failed"); kotlin.system.exitProcess(1) }
    println("all finance checks passed")
}
