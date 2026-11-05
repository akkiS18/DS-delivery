package com.dsdelivery.restaurant.ui.screens.finance

import com.dsdelivery.restaurant.data.api.dto.FinanceOverviewDto
import com.dsdelivery.restaurant.data.api.dto.LedgerItemDto
import com.dsdelivery.restaurant.data.api.dto.LedgerTotalsDto
import com.dsdelivery.restaurant.data.model.FinanceDateFilter
import java.time.LocalDate

/** Where the Moliya tab is: asking the server, no code issued yet, waiting for the code, or open. */
enum class FinancePhase { CHECKING, NO_PIN, LOCKED, OPEN }

/** Period chips on the "Jami" history screen. */
enum class HistoryPeriod(val title: String) {
    ALL("Hammasi"), TODAY("Bugun"), LAST_7_DAYS("7 kun"), THIS_MONTH("Shu oy");

    /** Inclusive Asia/Tashkent day keys (null = no limit). */
    fun range(today: LocalDate = LocalDate.now(FinanceDateFilter.TASHKENT)): Pair<String?, String?> = when (this) {
        ALL -> null to null
        TODAY -> today.toString() to today.toString()
        LAST_7_DAYS -> today.minusDays(6).toString() to today.toString()
        THIS_MONTH -> today.withDayOfMonth(1).toString() to today.toString()
    }
}

/** Source chips on the history screen; [query] is the backend `filter` value. */
enum class HistorySource(val title: String, val query: String) {
    ALL("Hammasi", "all"), CARD("Karta", "card"), CASH("Naqd", "cash")
}

data class FinanceHistoryState(
    val period: HistoryPeriod = HistoryPeriod.ALL,
    val source: HistorySource = HistorySource.ALL,
    val items: List<LedgerItemDto> = emptyList(),
    val totals: LedgerTotalsDto = LedgerTotalsDto(),
    val nextCursor: String? = null,
    val loaded: Boolean = false,
    val isLoading: Boolean = false,
    val isLoadingMore: Boolean = false,
    val errorMessage: String? = null
)

data class FinanceUiState(
    val phase: FinancePhase = FinancePhase.CHECKING,
    /** Digits typed so far (0..4). */
    val pin: String = "",
    val pinBusy: Boolean = false,
    val pinError: String? = null,
    val isLoading: Boolean = false,
    /** Backend numbers only; null until the first answer, and cleared when the code is locked again. */
    val overview: FinanceOverviewDto? = null,
    val errorMessage: String? = null,
    val historyOpen: Boolean = false,
    val history: FinanceHistoryState = FinanceHistoryState()
)
