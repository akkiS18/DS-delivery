package com.dsdelivery.restaurant.ui.screens.finance

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountBalance
import androidx.compose.material.icons.filled.CreditCard
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Receipt
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.dsdelivery.restaurant.data.model.FinanceCountSom
import com.dsdelivery.restaurant.data.model.FinanceDateFilter
import com.dsdelivery.restaurant.data.model.FinancePayout
import com.dsdelivery.restaurant.data.model.FinanceRefundAmount
import com.dsdelivery.restaurant.data.model.FinanceSummary
import com.dsdelivery.restaurant.ui.components.PullRefresh
import com.dsdelivery.restaurant.ui.theme.BrandDark
import com.dsdelivery.restaurant.ui.theme.BrandMint
import com.dsdelivery.restaurant.ui.theme.BrandPrimary
import com.dsdelivery.restaurant.ui.theme.DSRestaurantTheme
import com.dsdelivery.restaurant.ui.theme.ErrorRed
import com.dsdelivery.restaurant.ui.theme.SuccessGreen
import com.dsdelivery.restaurant.ui.theme.WarningOrange

@Composable
fun FinanceScreen(
    viewModel: FinanceViewModel,
    modifier: Modifier = Modifier
) {
    val state by viewModel.uiState.collectAsState()

    FinanceContent(
        state = state,
        onFilterSelected = viewModel::loadFinance,
        onRefresh = viewModel::refresh,
        modifier = modifier
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FinanceContent(
    state: FinanceUiState,
    onFilterSelected: (FinanceDateFilter) -> Unit,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier
) {
    val scrollState = rememberScrollState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = "Moliya",
                        style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold)
                    )
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
        PullRefresh(
            isRefreshing = state.isLoading,
            onRefresh = onRefresh,
            modifier = Modifier.fillMaxSize().padding(innerPadding).background(MaterialTheme.colorScheme.background)
        ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(scrollState)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                FinanceDateFilter.entries.forEach { filter ->
                    FilterChip(
                        selected = state.selectedFilter == filter,
                        onClick = { onFilterSelected(filter) },
                        label = { Text(filter.title) },
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = BrandPrimary,
                            selectedLabelColor = Color.White
                        )
                    )
                }
            }

            val summary = state.summary
            when {
                summary != null -> FinanceSummaryCards(summary)
                state.isLoading -> {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 32.dp),
                        horizontalArrangement = Arrangement.Center
                    ) {
                        CircularProgressIndicator(color = BrandPrimary)
                    }
                }
                else -> FinanceErrorCard(
                    message = state.errorMessage ?: "Yuklanmadi.",
                    onRetry = onRefresh
                )
            }

            Spacer(modifier = Modifier.height(80.dp))
        }
        }
    }
}

@Composable
private fun FinanceSummaryCards(summary: FinanceSummary) {
    // Money the platform collected on its own cards and still has to pay out to the restaurant
    summary.payout?.takeIf { it.shown }?.let { PayoutCard(it) }

    // Money actually received
    FinanceCard(title = "Tushum", icon = Icons.Default.AccountBalance) {
        Text(
            text = FinanceSummary.formatSom(summary.verifiedReceived.som),
            style = MaterialTheme.typography.headlineMedium.copy(fontWeight = FontWeight.Bold),
            color = BrandPrimary
        )
        Text(
            text = "${summary.verifiedReceived.count} ta to‘lov",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Spacer(modifier = Modifier.height(10.dp))
        HorizontalDivider(color = MaterialTheme.colorScheme.surfaceVariant)
        CountSomRow("Tasdiqlanmoqda", summary.pendingUnverified, WarningOrange)
        CountSomRow("To‘lov kutilmoqda", summary.awaitingPayment)
    }

    // Orders (created in the selected period)
    FinanceCard(title = "Buyurtmalar", icon = Icons.Default.Receipt) {
        CountSomRow("Yakunlangan", summary.ordersCompleted)
        CountSomRow("Jarayonda", summary.ordersInProgress)
        CountSomRow("Bekor qilingan", summary.ordersCancelled)
    }

    // Platform fee (flat per delivered order, amounts straight from the backend)
    FinanceCard(title = "Xizmat haqi", icon = Icons.Default.CreditCard) {
        val flat = summary.commissionFlatSom
        LabeledValue(
            label = "Har bir yetkazilgan buyurtma",
            value = if (flat != null) FinanceSummary.formatSom(flat) else "—"
        )
        CountSomRow("Shu davrda", summary.commissionAccruedInPeriod)
        CountSomRow("Platformaga to‘lanmagan", summary.commissionOutstanding)
        Text(
            text = "Naqd va o‘z kartangizga tushgan buyurtmalar uchun. Bizning kartaga tushganlari yuqoridagi hisobdan o‘zi ayriladi.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        if (summary.completedOrdersWithoutCommission > 0) {
            Text(
                text = "${summary.completedOrdersWithoutCommission} ta buyurtmaga xizmat haqi yozilmagan.",
                style = MaterialTheme.typography.bodyMedium,
                color = ErrorRed
            )
        }
        if (summary.commissionedOrdersWithRefund > 0) {
            Text(
                text = "${summary.commissionedOrdersWithRefund} ta buyurtmada pul qaytarilgan.",
                style = MaterialTheme.typography.bodyMedium,
                color = WarningOrange
            )
        }
    }

    // Refunds: shown, never netted against received money
    FinanceCard(title = "Pul qaytarish", icon = Icons.Default.Warning) {
        RefundRow("So‘ralgan", summary.refundsRequested)
        RefundRow("Qaytarish kerak", summary.refundsApprovedAwaitingSend)
        RefundRow("Mijoz tasdig‘i kutilmoqda", summary.refundsSentUnconfirmed)
        RefundRow(
            "Tasdiqlangan",
            FinanceRefundAmount(summary.refundsConfirmedCount, summary.refundsConfirmedSom)
        )
        RefundRow("Nizoli", summary.refundsDisputed, if (summary.refundsDisputed.count > 0) ErrorRed else null)
        RefundRow("Rad etilgan", summary.refundsRejected)
        HorizontalDivider(color = MaterialTheme.colorScheme.surfaceVariant)
        RefundRow("Hozir ochiq", summary.refundsOpenNow, if (summary.refundsOpenNow.count > 0) WarningOrange else null)
    }
}

/** "Platformadan olasiz": the figures the administrator pays out by hand, so the restaurant sees the same number he will transfer. */
@Composable
private fun PayoutCard(payout: FinancePayout) {
    FinanceCard(title = "Platformadan olasiz", icon = Icons.Default.AccountBalance) {
        Text(
            text = FinanceSummary.formatSom(payout.unpaidSom),
            style = MaterialTheme.typography.headlineMedium.copy(fontWeight = FontWeight.Bold),
            color = if (payout.unpaidSom > 0) BrandPrimary else MaterialTheme.colorScheme.onSurface
        )
        Text(
            text = if (payout.unpaidSom > 0) {
                "Hozir bizdan olishingiz kerak (${payout.unpaidDays} kunlik, oxirgi ${payout.unpaidWindowDays} kun ichida)"
            } else {
                "Hozircha to‘lanmagan qarz yo‘q"
            },
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        if (payout.unpaidOldestDay != null && payout.unpaidSom > 0) {
            Text(
                text = "Eng eski kun: ${payout.unpaidOldestDay}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        Spacer(modifier = Modifier.height(10.dp))
        HorizontalDivider(color = MaterialTheme.colorScheme.surfaceVariant)
        Text(
            text = "Tanlangan davr (yetkazilgan kun bo‘yicha)",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        LabeledValue("Bizning kartaga tushgan (${payout.orders} ta buyurtma)", FinanceSummary.formatSom(payout.collectedSom))
        LabeledValue("Platforma xizmati", "− ${FinanceSummary.formatSom(payout.commissionSom)}")
        if (payout.refundsSom > 0) {
            LabeledValue("Qaytarilgan pul", "− ${FinanceSummary.formatSom(payout.refundsSom)}", WarningOrange)
        }
        LabeledValue("Shu davr uchun olasiz", FinanceSummary.formatSom(payout.payableSom), BrandPrimary)
        if (payout.paidInPeriodSom > 0) {
            LabeledValue("Shundan to‘lab berilgan", FinanceSummary.formatSom(payout.paidInPeriodSom), SuccessGreen)
        }
        if (payout.inProgressOrders > 0) {
            LabeledValue(
                "Yetkazilmagan buyurtmalar (${payout.inProgressOrders} ta)",
                FinanceSummary.formatSom(payout.inProgressSom)
            )
            Text(
                text = "Bular yetkazilgach hisobga qo‘shiladi.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        Text(
            text = "Hisob: bizning kartaga tushgan summa − platforma xizmati − qaytarilgan pul. Taksi haqini mijoz alohida to‘laydi. Pulni administrator qo‘lda o‘tkazadi.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

@Composable
private fun FinanceCard(
    title: String,
    icon: ImageVector,
    content: @Composable () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(imageVector = icon, contentDescription = null, tint = BrandPrimary, modifier = Modifier.size(18.dp))
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurface
                )
            }
            content()
        }
    }
}

@Composable
private fun LabeledValue(label: String, value: String, valueColor: Color = Color.Unspecified) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(1f)
        )
        Spacer(modifier = Modifier.width(8.dp))
        Text(
            text = value,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.SemiBold,
            color = if (valueColor == Color.Unspecified) MaterialTheme.colorScheme.onSurface else valueColor
        )
    }
}

@Composable
private fun CountSomRow(label: String, value: FinanceCountSom, valueColor: Color = Color.Unspecified) {
    LabeledValue(label, "${value.count} ta (${FinanceSummary.formatSom(value.som)})", valueColor)
}

@Composable
private fun RefundRow(label: String, value: FinanceRefundAmount, valueColor: Color? = null) {
    LabeledValue(
        label = label,
        value = "${value.count} ta (${FinanceSummary.formatSom(value.amountSom)})",
        valueColor = valueColor ?: Color.Unspecified
    )
}

@Composable
private fun NoticeCard(title: String, text: String) {
    Surface(
        color = BrandMint.copy(alpha = 0.35f),
        shape = RoundedCornerShape(10.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    imageVector = Icons.Default.Info,
                    contentDescription = null,
                    tint = BrandPrimary,
                    modifier = Modifier.size(18.dp)
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = title,
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.Bold,
                    color = BrandDark
                )
            }
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = text,
                style = MaterialTheme.typography.bodySmall,
                fontSize = 11.sp,
                color = BrandDark
            )
        }
    }
}

@Composable
private fun FinanceErrorCard(message: String, onRetry: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Icon(
                imageVector = Icons.Default.AccountBalance,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f),
                modifier = Modifier.size(48.dp)
            )
            Spacer(modifier = Modifier.height(12.dp))
            Text(
                text = "Moliya ma'lumotlari yuklanmadi",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onSurface
            )
            Spacer(modifier = Modifier.height(6.dp))
            Text(
                text = message,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                lineHeight = 18.sp
            )
            Spacer(modifier = Modifier.height(14.dp))
            Button(
                onClick = onRetry,
                colors = ButtonDefaults.buttonColors(containerColor = BrandPrimary),
                shape = RoundedCornerShape(8.dp)
            ) {
                Icon(imageVector = Icons.Default.Refresh, contentDescription = null, modifier = Modifier.size(16.dp))
                Spacer(modifier = Modifier.width(6.dp))
                Text("Qayta urinish")
            }
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun FinanceScreenPreview() {
    DSRestaurantTheme {
        // Design-time data only; never reachable at runtime.
        FinanceContent(
            state = FinanceUiState(
                summary = FinanceSummary(
                    verifiedReceived = FinanceCountSom(2, 42000),
                    ordersInProgress = FinanceCountSom(2, 42000),
                    commissionFlatSom = 5000
                )
            ),
            onFilterSelected = {},
            onRefresh = {}
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun FinanceErrorPreview() {
    DSRestaurantTheme {
        FinanceContent(
            state = FinanceUiState(errorMessage = "Tarmoq xatosi"),
            onFilterSelected = {},
            onRefresh = {}
        )
    }
}
