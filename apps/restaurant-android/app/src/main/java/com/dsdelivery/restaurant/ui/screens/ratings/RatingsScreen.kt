package com.dsdelivery.restaurant.ui.screens.ratings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.dsdelivery.restaurant.data.model.RatingsReport
import com.dsdelivery.restaurant.data.model.RecentRating
import com.dsdelivery.restaurant.ui.components.PullRefresh
import com.dsdelivery.restaurant.ui.theme.BrandPrimary
import com.dsdelivery.restaurant.ui.theme.ErrorRed
import com.dsdelivery.restaurant.ui.theme.WarningOrange

private fun average(v: Double?): String = if (v == null) "—" else String.format(java.util.Locale.US, "%.1f", v)

private fun stars(n: Int): String = "★".repeat(n.coerceIn(0, 5)) + "☆".repeat(5 - n.coerceIn(0, 5))

@Composable
fun RatingsScreen(
    viewModel: RatingsViewModel,
    modifier: Modifier = Modifier
) {
    val state by viewModel.uiState.collectAsState()
    RatingsContent(state = state, onRefresh = viewModel::refresh, modifier = modifier)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RatingsContent(
    state: RatingsUiState,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = "Baholar",
                        style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold)
                    )
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = BrandPrimary,
                    titleContentColor = Color.White
                )
            )
        },
        modifier = modifier
    ) { innerPadding ->
        PullRefresh(
            isRefreshing = state.isLoading,
            onRefresh = onRefresh,
            modifier = Modifier.fillMaxSize().padding(innerPadding).background(MaterialTheme.colorScheme.background)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                val report = state.report
                when {
                    report != null -> RatingsBody(report)
                    state.isLoading -> {
                        Row(
                            modifier = Modifier.fillMaxWidth().padding(vertical = 32.dp),
                            horizontalArrangement = Arrangement.Center
                        ) {
                            CircularProgressIndicator(color = BrandPrimary)
                        }
                    }
                    else -> RatingsError(state.errorMessage ?: "Yuklanmadi.", onRefresh)
                }
                Spacer(modifier = Modifier.height(80.dp))
            }
        }
    }
}

@Composable
private fun RatingsBody(report: RatingsReport) {
    SectionCard(title = "Taom bahosi") {
        if (report.count == 0) {
            Text(
                text = "Hozircha baho yo‘q. Mijozlar yetkazilgan buyurtmadan keyin 24 soat ichida baholay oladi.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        } else {
            Text(
                text = "★ ${average(report.average)}",
                style = MaterialTheme.typography.headlineMedium.copy(fontWeight = FontWeight.Bold),
                color = BrandPrimary
            )
            Text(
                text = "Jami ${report.count} ta baho",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = "Oxirgi 30 kun: ${average(report.last30Average)} (${report.last30Count} ta)",
                style = MaterialTheme.typography.bodyMedium
            )
            Text(
                text = "Mijozlar o‘rtacha bahoni 5 ta bahodan keyin ko‘radi.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }

    if (report.count > 0) {
        SectionCard(title = "Taqsimot") {
            for (n in 5 downTo 1) {
                val c = report.starCounts.getOrElse(n - 1) { 0 }
                Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text(text = "$n ★", modifier = Modifier.width(36.dp), style = MaterialTheme.typography.bodyMedium)
                    LinearProgressIndicator(
                        progress = { c.toFloat() / report.count },
                        modifier = Modifier.weight(1f).height(8.dp),
                        color = if (n <= 3) WarningOrange else BrandPrimary
                    )
                    Text(
                        text = c.toString(),
                        modifier = Modifier.width(40.dp).padding(start = 8.dp),
                        style = MaterialTheme.typography.bodyMedium
                    )
                }
            }
        }
    }

    if (report.reasons.isNotEmpty()) {
        SectionCard(title = "Nima yoqmagan") {
            report.reasons.forEach { (label, n) ->
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(text = label, style = MaterialTheme.typography.bodyMedium)
                    Text(text = "$n ta", style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Bold))
                }
            }
        }
    }

    if (report.recent.isNotEmpty()) {
        SectionCard(title = "Oxirgi past baholar va izohlar") {
            report.recent.forEach { RecentRow(it) }
            Text(
                text = "Mijozning ismi va raqami ko‘rsatilmaydi.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

@Composable
private fun RecentRow(r: RecentRating) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(
                text = stars(r.stars),
                style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Bold),
                color = if (r.stars <= 3) WarningOrange else BrandPrimary
            )
            Text(
                text = r.whenText,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        if (r.reasons.isNotEmpty()) {
            Text(text = r.reasons.joinToString(", "), style = MaterialTheme.typography.bodyMedium)
        }
        r.note?.let { Text(text = "“$it”", style = MaterialTheme.typography.bodyMedium) }
    }
}

@Composable
private fun SectionCard(title: String, content: @Composable () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    ) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(text = title, style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold))
            content()
        }
    }
}

@Composable
private fun RatingsError(message: String, onRetry: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    ) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(text = message, color = ErrorRed, style = MaterialTheme.typography.bodyMedium)
            Button(onClick = onRetry, colors = ButtonDefaults.buttonColors(containerColor = BrandPrimary)) {
                Text("Qayta urinish")
            }
        }
    }
}
