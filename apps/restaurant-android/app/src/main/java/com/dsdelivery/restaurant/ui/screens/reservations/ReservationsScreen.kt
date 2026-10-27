package com.dsdelivery.restaurant.ui.screens.reservations

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.dsdelivery.restaurant.data.model.Reservation
import com.dsdelivery.restaurant.ui.components.ActionConfirmDialog
import com.dsdelivery.restaurant.ui.components.PullRefresh
import com.dsdelivery.restaurant.ui.theme.BrandMint
import com.dsdelivery.restaurant.ui.theme.BrandPrimary
import com.dsdelivery.restaurant.ui.theme.ErrorRed
import com.dsdelivery.restaurant.ui.theme.WarningOrange

/** The "Bronlar" tab. Opening it (with the tab selected) marks the new reservations as seen. */
@Composable
fun ReservationsScreen(
    viewModel: ReservationsViewModel,
    modifier: Modifier = Modifier
) {
    val state by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(state.infoMessage) {
        state.infoMessage?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.dismissInfo()
        }
    }
    // Opened with something new on it: report it as seen (once the list has really loaded), and forget the markers when the tab is left.
    LaunchedEffect(state.unseenCount, state.report) {
        if (state.unseenCount > 0) viewModel.markSeen()
    }
    DisposableEffect(Unit) { onDispose { viewModel.clearFresh() } }

    ReservationsContent(
        state = state,
        snackbarHostState = snackbarHostState,
        onRefresh = { viewModel.refresh() },
        onConfirm = viewModel::confirmPayment,
        onCancel = viewModel::cancel,
        modifier = modifier
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReservationsContent(
    state: ReservationsUiState,
    snackbarHostState: SnackbarHostState,
    onRefresh: () -> Unit,
    onConfirm: (String) -> Unit,
    onCancel: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    var cancelling by remember { mutableStateOf<Reservation?>(null) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Bronlar", style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold)) },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = BrandPrimary, titleContentColor = Color.White)
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
        modifier = modifier
    ) { innerPadding ->
        PullRefresh(
            isRefreshing = state.isLoading,
            onRefresh = onRefresh,
            modifier = Modifier.fillMaxSize().padding(innerPadding).background(MaterialTheme.colorScheme.background)
        ) {
            Column(
                modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                val report = state.report
                if (state.errorMessage != null && report != null) {
                    Text(state.errorMessage, color = WarningOrange, style = MaterialTheme.typography.bodySmall)
                }
                when {
                    report != null -> {
                        if (!report.settings.enabled) {
                            Card(
                                shape = RoundedCornerShape(14.dp),
                                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text(
                                    "Joy bron qilish o‘chiq. Sozlamalar bo‘limidan yoqing: mijozlar menyuda “Joy bron qilish” tugmasini ko‘radi.",
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.padding(16.dp)
                                )
                            }
                        }
                        SectionTitle("Kelgusi bronlar", report.upcoming.size)
                        if (report.upcoming.isEmpty()) {
                            Text("Hozircha bron yo‘q.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        report.upcoming.forEach { r ->
                            ReservationCard(
                                r = r,
                                fresh = r.id in state.freshIds || !r.seen,
                                busy = state.busyId == r.id,
                                onConfirm = { onConfirm(r.id) },
                                onCancel = { cancelling = r }
                            )
                        }
                        if (report.past.isNotEmpty()) {
                            Spacer(Modifier.height(4.dp))
                            SectionTitle("Oldingi bronlar", null)
                            report.past.forEach { r ->
                                ReservationCard(r = r, fresh = false, busy = false, onConfirm = {}, onCancel = {})
                            }
                        }
                    }
                    state.isLoading -> {
                        Row(Modifier.fillMaxWidth().padding(vertical = 32.dp), horizontalArrangement = Arrangement.Center) {
                            CircularProgressIndicator(color = BrandPrimary)
                        }
                    }
                    else -> {
                        Text(state.errorMessage ?: "Yuklanmadi.", color = ErrorRed, style = MaterialTheme.typography.bodyMedium)
                        TextButton(onClick = onRefresh) { Text("Qayta urinish") }
                    }
                }
                Spacer(Modifier.height(80.dp))
            }
        }
    }

    cancelling?.let { r ->
        ActionConfirmDialog(
            title = "Bronni bekor qilasizmi?",
            message = "#${r.code} • ${r.whenText} • ${r.partySize} kishi",
            confirmText = "Bekor qilish",
            confirmButtonColor = ErrorRed,
            warningNote = "Mijoz to‘lagan ${r.formattedDeposit} qaytarilishi kerak: ${r.customerName} ga ${r.customerPhone} raqamiga qo‘ng‘iroq qiling.",
            onConfirm = { cancelling = null; onCancel(r.id) },
            onDismiss = { cancelling = null }
        )
    }
}

@Composable
private fun SectionTitle(title: String, count: Int?) {
    Text(
        text = if (count != null) "$title ($count)" else title,
        style = MaterialTheme.typography.titleSmall,
        fontWeight = FontWeight.SemiBold,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(start = 4.dp)
    )
}

@Composable
private fun ReservationCard(
    r: Reservation,
    fresh: Boolean,
    busy: Boolean,
    onConfirm: () -> Unit,
    onCancel: () -> Unit
) {
    val context = LocalContext.current
    Card(
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = if (fresh || r.awaitingConfirm) BrandMint.copy(alpha = 0.35f) else MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text("${r.whenText} • ${r.partySize} kishi", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                when {
                    r.cancelled -> Tag("Bekor qilindi", ErrorRed)
                    r.awaitingConfirm -> Tag("Tasdiq kutmoqda", WarningOrange)
                    fresh -> Tag("Yangi", BrandPrimary)
                }
            }
            Text("#${r.code} • ${r.customerName}", style = MaterialTheme.typography.bodyMedium)
            Text(
                "Oldindan to‘lov: ${r.formattedDeposit}${if (r.paidAtText.isNotEmpty() && !r.awaitingConfirm) " • ${r.paidAtText} da tushdi" else ""}",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            if (r.note != null) Text("Izoh: ${r.note}", style = MaterialTheme.typography.bodyMedium)
            if (r.isTest) Text("TEST", style = MaterialTheme.typography.labelSmall, color = WarningOrange)
            if (r.customerPhone.isNotEmpty()) {
                TextButton(
                    onClick = { context.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:${r.customerPhone}"))) },
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp)
                ) { Text("Qo‘ng‘iroq: ${r.customerPhone}", color = BrandPrimary) }
            }
            if (r.awaitingConfirm) {
                Button(
                    onClick = onConfirm,
                    enabled = !busy,
                    colors = ButtonDefaults.buttonColors(containerColor = BrandPrimary),
                    modifier = Modifier.fillMaxWidth()
                ) { Text(if (busy) "Kuting..." else "Pul tushdi — joyni band qilish") }
            }
            if (!r.cancelled && !r.awaitingConfirm && r.depositSom > 0 && !isPast(r)) {
                OutlinedButton(onClick = onCancel, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
                    Text("Bronni bekor qilish", color = ErrorRed)
                }
            }
        }
    }
}

/** The "past" cards are rendered with fresh = false and no handlers; they never offer a cancel button. */
private fun isPast(r: Reservation): Boolean = runCatching { java.time.Instant.parse(r.startsAtIso).isBefore(java.time.Instant.now().minusSeconds(2 * 3600)) }.getOrDefault(false)

@Composable
private fun Tag(text: String, color: Color) {
    Text(
        text = text,
        color = color,
        style = MaterialTheme.typography.labelMedium,
        fontWeight = FontWeight.Bold
    )
}
