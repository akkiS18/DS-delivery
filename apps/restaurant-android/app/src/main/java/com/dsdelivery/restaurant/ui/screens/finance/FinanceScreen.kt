package com.dsdelivery.restaurant.ui.screens.finance

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Backspace
import androidx.compose.material.icons.filled.AccountBalance
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.CreditCard
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Payments
import androidx.compose.material.icons.filled.Percent
import androidx.compose.material.icons.filled.Savings
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.dsdelivery.restaurant.data.api.dto.FinanceOverviewDto
import com.dsdelivery.restaurant.data.api.dto.FinanceSourceDto
import com.dsdelivery.restaurant.data.api.dto.LedgerItemDto
import com.dsdelivery.restaurant.data.model.FinanceDateFilter
import com.dsdelivery.restaurant.data.model.FinanceFormat
import com.dsdelivery.restaurant.ui.components.PullRefresh
import com.dsdelivery.restaurant.ui.theme.BrandDark
import com.dsdelivery.restaurant.ui.theme.BrandMint
import com.dsdelivery.restaurant.ui.theme.BrandMintLight
import com.dsdelivery.restaurant.ui.theme.BrandPrimary
import com.dsdelivery.restaurant.ui.theme.ErrorRed
import com.dsdelivery.restaurant.ui.theme.TextMuted
import com.dsdelivery.restaurant.ui.theme.TextSecondary
import com.dsdelivery.restaurant.ui.theme.WarningOrange
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * Moliya (owner decision 2026-11-05): behind a 4-digit code; the main page shows CARD money only (what you earned, what the platform earned,
 * what was paid, what is left); cash lives only inside the "Jami" history. Only backend values are shown.
 */
@Composable
fun FinanceScreen(
    viewModel: FinanceViewModel,
    modifier: Modifier = Modifier
) {
    val state by viewModel.uiState.collectAsState()
    val showHistory = state.phase == FinancePhase.OPEN && state.historyOpen

    // The system back button closes the history first (the tab-level handler would leave Moliya).
    BackHandler(enabled = showHistory) { viewModel.closeHistory() }

    when {
        showHistory -> FinanceHistory(state = state, viewModel = viewModel, modifier = modifier)
        else -> FinanceMain(state = state, viewModel = viewModel, modifier = modifier)
    }
}

// ------------------------------------------------------------------------------------------------ main page
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FinanceMain(state: FinanceUiState, viewModel: FinanceViewModel, modifier: Modifier) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Moliya", style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold)) },
                actions = {
                    if (state.phase == FinancePhase.OPEN) {
                        IconButton(onClick = viewModel::lock) {
                            Icon(Icons.Default.Lock, contentDescription = "Qulflash")
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = BrandPrimary,
                    titleContentColor = Color.White,
                    actionIconContentColor = Color.White
                )
            )
        },
        modifier = modifier
    ) { innerPadding ->
        Box(modifier = Modifier.fillMaxSize().padding(innerPadding).background(MaterialTheme.colorScheme.background)) {
            when (state.phase) {
                FinancePhase.CHECKING -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = BrandPrimary) }
                FinancePhase.NO_PIN -> NoPinNotice(onRetry = viewModel::refresh)
                FinancePhase.LOCKED -> PinPad(state = state, onDigit = viewModel::onDigit, onBackspace = viewModel::onBackspace)
                FinancePhase.OPEN -> FinanceOverviewPage(state = state, onRefresh = viewModel::refresh, onOpenHistory = viewModel::openHistory)
            }
        }
    }
}

@Composable
private fun NoPinNotice(onRetry: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        IconBadge(Icons.Default.Lock, size = 72.dp)
        Spacer(Modifier.height(20.dp))
        Text("Moliya kodi berilmagan", style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold), color = BrandDark, textAlign = TextAlign.Center)
        Spacer(Modifier.height(8.dp))
        Text("4 xonali kodni administratordan oling.", style = MaterialTheme.typography.bodyMedium, color = TextSecondary, textAlign = TextAlign.Center)
        Spacer(Modifier.height(20.dp))
        OutlinedButton(onClick = onRetry) { Text("Tekshirish") }
    }
}

// ---- the 4-digit code
@Composable
private fun PinPad(state: FinanceUiState, onDigit: (Char) -> Unit, onBackspace: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp, vertical = 16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        IconBadge(Icons.Default.Lock, size = 64.dp)
        Spacer(Modifier.height(16.dp))
        Text("Moliya kodi", style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold), color = BrandDark)
        Spacer(Modifier.height(4.dp))
        Text("4 xonali kodni kiriting", style = MaterialTheme.typography.bodyMedium, color = TextSecondary)
        Spacer(Modifier.height(24.dp))

        Row(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
            for (i in 0 until 4) {
                val filled = i < state.pin.length
                Box(
                    modifier = Modifier
                        .size(18.dp)
                        .clip(CircleShape)
                        .background(if (filled) BrandPrimary else Color.Transparent)
                        .border(2.dp, if (state.pinError != null) ErrorRed else BrandPrimary, CircleShape)
                )
            }
        }
        Spacer(Modifier.height(14.dp))
        Box(Modifier.height(40.dp).fillMaxWidth(), contentAlignment = Alignment.Center) {
            val message = state.pinError ?: state.errorMessage
            when {
                state.pinBusy -> CircularProgressIndicator(color = BrandPrimary, strokeWidth = 2.dp, modifier = Modifier.size(22.dp))
                message != null -> Text(message, color = ErrorRed, style = MaterialTheme.typography.bodySmall, textAlign = TextAlign.Center)
            }
        }
        Spacer(Modifier.height(8.dp))

        val rows = listOf("123", "456", "789")
        Column(verticalArrangement = Arrangement.spacedBy(14.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            rows.forEach { row ->
                Row(horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                    row.forEach { d -> PadKey(enabled = !state.pinBusy, onClick = { onDigit(d) }) { Text(d.toString(), fontSize = 26.sp, fontWeight = FontWeight.Medium, color = BrandDark) } }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                Spacer(Modifier.size(KEY_SIZE))
                PadKey(enabled = !state.pinBusy, onClick = { onDigit('0') }) { Text("0", fontSize = 26.sp, fontWeight = FontWeight.Medium, color = BrandDark) }
                PadKey(enabled = !state.pinBusy && state.pin.isNotEmpty(), onClick = onBackspace, plain = true) {
                    Icon(Icons.AutoMirrored.Filled.Backspace, contentDescription = "O‘chirish", tint = BrandDark)
                }
            }
        }
    }
}

private val KEY_SIZE = 72.dp

@Composable
private fun PadKey(enabled: Boolean, onClick: () -> Unit, plain: Boolean = false, content: @Composable () -> Unit) {
    Box(
        modifier = Modifier
            .size(KEY_SIZE)
            .clip(CircleShape)
            .background(if (plain) Color.Transparent else BrandMintLight)
            .clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center
    ) { content() }
}

// ---- the numbers
@Composable
private fun FinanceOverviewPage(state: FinanceUiState, onRefresh: () -> Unit, onOpenHistory: () -> Unit) {
    val overview = state.overview
    PullRefresh(isRefreshing = state.isLoading, onRefresh = onRefresh, modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            when {
                overview != null -> {
                    OverviewSections(overview)
                    Button(
                        onClick = onOpenHistory,
                        modifier = Modifier.fillMaxWidth().height(54.dp),
                        shape = RoundedCornerShape(16.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = BrandPrimary)
                    ) {
                        Icon(Icons.Default.History, contentDescription = null)
                        Spacer(Modifier.width(10.dp))
                        Text("Jami", fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
                    }
                    Spacer(Modifier.height(72.dp))
                }
                state.isLoading -> Box(Modifier.fillMaxWidth().padding(vertical = 48.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = BrandPrimary) }
                else -> ErrorBox(message = state.errorMessage ?: "Yuklanmadi.", onRetry = onRefresh)
            }
            // A refresh that failed while the numbers are on screen: they stay, the reason is one line.
            if (overview != null && state.errorMessage != null) {
                Text(state.errorMessage, color = ErrorRed, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

@Composable
private fun OverviewSections(o: FinanceOverviewDto) {
    // The platform-card block shows for restaurants whose customers pay onto our card (or that have had such money); the own-card block for the rest.
    val showPlatform = o.collectsToPlatform || o.platformCard.orders > 0 || o.platformCard.paidOutSom > 0
    val showOwn = !o.collectsToPlatform || o.ownCard.orders > 0

    if (o.openRefunds.count > 0) {
        Row(
            modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Color(0xFFFFF4E0)).padding(14.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(Icons.Default.Warning, contentDescription = null, tint = WarningOrange)
            Spacer(Modifier.width(12.dp))
            Column {
                Text("Qaytarish so‘rovi: ${o.openRefunds.count} ta", fontWeight = FontWeight.SemiBold, color = BrandDark)
                Text(FinanceFormat.som(o.openRefunds.amountSom), style = MaterialTheme.typography.bodySmall, color = TextSecondary)
            }
        }
    }
    if (showPlatform) {
        MoneyBlock(
            icon = Icons.Default.AccountBalance,
            title = "Platforma kartasi",
            heroLabel = "Sizga qoldi",
            heroValue = o.platformCard.remainingSom,
            progress = FinanceFormat.share(o.platformCard.paidOutSom, o.platformCard.restaurantEarnedSom),
            rows = listOf(
                MoneyRow(Icons.Default.Savings, "Siz ishlab topdingiz", o.platformCard.restaurantEarnedSom, BrandPrimary),
                MoneyRow(Icons.Default.Percent, "Platforma ishlab topdi", o.platformCard.platformFeeSom, TextSecondary),
                MoneyRow(Icons.Default.ArrowDownward, "Sizga to‘lab berildi", o.platformCard.paidOutSom, BrandPrimary)
            )
        )
    }
    if (showOwn) {
        MoneyBlock(
            icon = Icons.Default.CreditCard,
            title = "O‘z kartangiz",
            heroLabel = "Platformaga to‘lash kerak",
            heroValue = o.ownCard.feeRemainingSom,
            progress = FinanceFormat.share(o.ownCard.feeSettledSom, o.ownCard.platformFeeSom),
            rows = listOf(
                MoneyRow(Icons.Default.Savings, "Siz ishlab topdingiz", o.ownCard.restaurantEarnedSom, BrandPrimary),
                MoneyRow(Icons.Default.Percent, "Platforma ishlab topdi", o.ownCard.platformFeeSom, TextSecondary),
                MoneyRow(Icons.Default.ArrowDownward, "Platformaga to‘landi", o.ownCard.feeSettledSom, BrandPrimary)
            )
        )
    }
}

private data class MoneyRow(val icon: ImageVector, val label: String, val value: Long, val tint: Color)

@Composable
private fun MoneyBlock(icon: ImageVector, title: String, heroLabel: String, heroValue: Long, progress: Float, rows: List<MoneyRow>) {
    Surface(shape = RoundedCornerShape(20.dp), color = Color.White, shadowElevation = 1.dp, modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconBadge(icon, size = 36.dp)
                Spacer(Modifier.width(10.dp))
                Text(title, style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold), color = BrandDark)
            }
            Column {
                Text(heroLabel, style = MaterialTheme.typography.bodyMedium, color = TextSecondary)
                Text(FinanceFormat.som(heroValue), fontSize = 30.sp, fontWeight = FontWeight.Bold, color = BrandPrimary)
            }
            LinearProgressIndicator(
                progress = { progress },
                modifier = Modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(4.dp)),
                color = BrandPrimary,
                trackColor = BrandMint
            )
            rows.forEach { r ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(r.icon, contentDescription = null, tint = r.tint, modifier = Modifier.size(20.dp))
                    Spacer(Modifier.width(10.dp))
                    Text(r.label, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, color = TextSecondary)
                    Text(FinanceFormat.som(r.value), fontWeight = FontWeight.SemiBold, color = BrandDark)
                }
            }
        }
    }
}

@Composable
private fun IconBadge(icon: ImageVector, size: androidx.compose.ui.unit.Dp) {
    Box(
        modifier = Modifier.size(size).clip(CircleShape).background(BrandMintLight),
        contentAlignment = Alignment.Center
    ) { Icon(icon, contentDescription = null, tint = BrandPrimary, modifier = Modifier.size(size * 0.5f)) }
}

@Composable
private fun ErrorBox(message: String, onRetry: () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(vertical = 32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(message, color = ErrorRed, textAlign = TextAlign.Center)
        Spacer(Modifier.height(12.dp))
        OutlinedButton(onClick = onRetry) { Text("Qayta urinish") }
    }
}

// ------------------------------------------------------------------------------------------------ "Jami" history
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FinanceHistory(state: FinanceUiState, viewModel: FinanceViewModel, modifier: Modifier) {
    val h = state.history
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Jami", style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold)) },
                navigationIcon = {
                    IconButton(onClick = viewModel::closeHistory) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Orqaga") }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = BrandPrimary,
                    titleContentColor = Color.White,
                    navigationIconContentColor = Color.White
                )
            )
        },
        modifier = modifier
    ) { innerPadding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(innerPadding).background(MaterialTheme.colorScheme.background),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    ChipRow(HistoryPeriod.entries, h.period, { it.title }, viewModel::setPeriod)
                    ChipRow(HistorySource.entries, h.source, { it.title }, viewModel::setSource)
                }
            }
            item { TotalsCard(h) }
            when {
                h.isLoading -> item { Box(Modifier.fillMaxWidth().padding(vertical = 32.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = BrandPrimary) } }
                h.errorMessage != null && h.items.isEmpty() -> item { ErrorBox(h.errorMessage, onRetry = viewModel::reloadHistory) }
                h.loaded && h.items.isEmpty() -> item {
                    Text("Bu davrda tushum yo‘q.", color = TextMuted, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(vertical = 32.dp))
                }
                else -> {
                    items(h.items, key = { it.kind + it.id }) { LedgerLine(it) }
                    if (h.nextCursor != null) {
                        item {
                            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                                if (h.isLoadingMore) CircularProgressIndicator(color = BrandPrimary, modifier = Modifier.size(28.dp))
                                else TextButton(onClick = viewModel::loadMoreHistory) { Text("Yana yuklash") }
                            }
                        }
                    }
                    if (h.errorMessage != null) item { Text(h.errorMessage, color = ErrorRed, style = MaterialTheme.typography.bodySmall) }
                }
            }
            item { Spacer(Modifier.height(72.dp)) }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun <T> ChipRow(options: List<T>, selected: T, title: (T) -> String, onSelect: (T) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
        options.forEach { o ->
            FilterChip(
                selected = o == selected,
                onClick = { onSelect(o) },
                label = { Text(title(o)) },
                colors = FilterChipDefaults.filterChipColors(selectedContainerColor = BrandPrimary, selectedLabelColor = Color.White)
            )
        }
    }
}

@Composable
private fun TotalsCard(h: FinanceHistoryState) {
    Surface(shape = RoundedCornerShape(20.dp), color = BrandPrimary, modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Siz ishlab topdingiz", color = Color.White.copy(alpha = 0.85f), style = MaterialTheme.typography.bodyMedium)
            Text(FinanceFormat.som(h.totals.restaurantEarnedSom), color = Color.White, fontSize = 30.sp, fontWeight = FontWeight.Bold)
            Row(Modifier.fillMaxWidth()) {
                TotalsCell("Buyurtmalar", h.totals.orders.toString(), Modifier.weight(1f))
                TotalsCell("Platforma", FinanceFormat.som(h.totals.platformFeeSom), Modifier.weight(1f))
                if (h.totals.paidOutSom > 0) TotalsCell("To‘lab berildi", FinanceFormat.som(h.totals.paidOutSom), Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun TotalsCell(label: String, value: String, modifier: Modifier) {
    Column(modifier) {
        Text(label, color = Color.White.copy(alpha = 0.75f), style = MaterialTheme.typography.labelSmall)
        Text(value, color = Color.White, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium)
    }
}

private val TASHKENT_ZONE: ZoneId = FinanceDateFilter.TASHKENT
private val LINE_TIME: DateTimeFormatter = DateTimeFormatter.ofPattern("dd.MM  HH:mm")

private fun lineTime(iso: String): String = try {
    Instant.parse(iso).atZone(TASHKENT_ZONE).format(LINE_TIME)
} catch (_: Exception) { "" }

@Composable
private fun LedgerLine(item: LedgerItemDto) {
    val payout = item.kind == "PAYOUT"
    val icon = when {
        payout -> Icons.Default.AccountBalance
        item.source == "cash" -> Icons.Default.Payments
        else -> Icons.Default.CreditCard
    }
    val title = if (payout) "Platforma to‘lab berdi" else "#${item.orderCode ?: ""}"
    val sub = lineTime(item.at) + when {
        payout -> ""
        item.source == "cash" -> "  ·  Naqd"
        item.source == "platform" -> "  ·  Platforma kartasi"
        else -> "  ·  O‘z karta"
    }
    val amount = if (payout) item.amountSom else item.restaurantShareSom
    Surface(shape = RoundedCornerShape(16.dp), color = Color.White, shadowElevation = 1.dp, modifier = Modifier.fillMaxWidth()) {
        Row(modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            IconBadge(icon, size = 40.dp)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(title, fontWeight = FontWeight.SemiBold, color = BrandDark)
                Text(sub, style = MaterialTheme.typography.bodySmall, color = TextMuted)
            }
            Column(horizontalAlignment = Alignment.End) {
                Text(FinanceFormat.signed(amount), fontWeight = FontWeight.Bold, color = BrandPrimary)
                if (!payout && item.platformFeeSom > 0) {
                    Text("Platforma ${FinanceFormat.som(item.platformFeeSom)}", style = MaterialTheme.typography.labelSmall, color = TextMuted)
                }
            }
        }
    }
}
