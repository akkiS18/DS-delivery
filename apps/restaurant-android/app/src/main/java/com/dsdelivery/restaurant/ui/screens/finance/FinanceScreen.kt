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
import com.dsdelivery.restaurant.data.model.FinanceRefundAmount
import com.dsdelivery.restaurant.data.model.FinanceSummary
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
                        text = "Moliya va Tushumlar",
                        style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold)
                    )
                },
                actions = {
                    IconButton(onClick = onRefresh, enabled = !state.isLoading) {
                        if (state.isLoading) {
                            CircularProgressIndicator(
                                color = Color.White,
                                modifier = Modifier.size(20.dp),
                                strokeWidth = 2.dp
                            )
                        } else {
                            Icon(imageVector = Icons.Default.Refresh, contentDescription = "Yangilash", tint = Color.White)
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
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .background(MaterialTheme.colorScheme.background)
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
                        label = { Text(filter.title, fontSize = 12.sp) },
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
                    message = state.errorMessage ?: "Moliya ma'lumotlarini yuklab bo‘lmadi.",
                    onRetry = onRefresh
                )
            }

            Spacer(modifier = Modifier.height(80.dp))
        }
    }
}

@Composable
private fun FinanceSummaryCards(summary: FinanceSummary) {
    // Delivery proof: until the backend can confirm delivery no commission is earned.
    if (!summary.deliveryConfirmationImplemented) {
        NoticeCard(
            title = "Yetkazib berish tasdiqlanmaydi",
            text = "Hozircha serverda yetkazib berishni tasdiqlash mavjud emas, shuning uchun komissiya hisoblanmaydi va qarz yo‘q."
        )
    }

    // Money actually received (restaurant-verified payments only)
    FinanceCard(title = "Tasdiqlangan tushum", icon = Icons.Default.AccountBalance) {
        Text(
            text = FinanceSummary.formatSom(summary.verifiedReceived.som),
            style = MaterialTheme.typography.headlineMedium.copy(fontWeight = FontWeight.Bold),
            color = BrandPrimary
        )
        Text(
            text = "${summary.verifiedReceived.count} ta to‘lov — restoran xodimi tasdiqlagan",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Spacer(modifier = Modifier.height(10.dp))
        HorizontalDivider(color = MaterialTheme.colorScheme.surfaceVariant)
        CountSomRow("Tekshirilmagan (pochta mos kelgan)", summary.pendingUnverified, WarningOrange)
        CountSomRow("To‘lov kutilmoqda", summary.awaitingPayment)
        Text(
            text = "Tekshirilmagan va kutilayotgan to‘lovlar qabul qilingan pul hisoblanmaydi.",
            style = MaterialTheme.typography.bodySmall,
            fontSize = 11.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }

    // Orders (created in the selected period)
    FinanceCard(title = "Buyurtmalar", icon = Icons.Default.Receipt) {
        CountSomRow("Yakunlangan", summary.ordersCompleted)
        CountSomRow("Jarayonda", summary.ordersInProgress)
        CountSomRow("Bekor qilingan / rad etilgan", summary.ordersCancelled)
        Text(
            text = "Tanlangan davrda yaratilgan buyurtmalar.",
            style = MaterialTheme.typography.bodySmall,
            fontSize = 11.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }

    // Platform commission (flat fee, amounts straight from the backend)
    FinanceCard(title = "DS Delivery xizmat haqi", icon = Icons.Default.CreditCard) {
        val flat = summary.commissionFlatSom
        LabeledValue(
            label = "Yetkazilgan buyurtma uchun belgilangan summa",
            value = if (flat != null) FinanceSummary.formatSom(flat) else "Server sozlamasi noto‘g‘ri"
        )
        CountSomRow("Davrda hisoblangan", summary.commissionAccruedInPeriod)
        CountSomRow("To‘lanmagan jami qarz", summary.commissionOutstanding)
        Text(
            text = "Komissiya har bir yetkazilgani tasdiqlangan, to‘lovi restoran tomonidan tasdiqlangan, sinov (test) bo‘lmagan buyurtma uchun qat’iy belgilangan summa (foiz emas). Bekor qilingan, to‘lanmagan va sinov buyurtmalar uchun hisoblanmaydi. " +
                "Platforma pulni avtomatik yechib olmaydi" +
                if (!summary.settlementTrackingImplemented) "; to‘lovlarni qayd etish hali mavjud emas." else ".",
            style = MaterialTheme.typography.bodySmall,
            fontSize = 11.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        if (summary.completedOrdersWithoutCommission > 0) {
            Text(
                text = "Diqqat: ${summary.completedOrdersWithoutCommission} ta yakunlangan buyurtmaga komissiya yozilmagan (tekshirish kerak).",
                style = MaterialTheme.typography.bodySmall,
                color = ErrorRed
            )
        }
        if (summary.commissionedOrdersWithRefund > 0) {
            Text(
                text = "Diqqat: ${summary.commissionedOrdersWithRefund} ta komissiyali buyurtma bo‘yicha qaytarish mavjud (ko‘rib chiqish kerak).",
                style = MaterialTheme.typography.bodySmall,
                color = WarningOrange
            )
        }
    }

    // Refunds: shown, never netted against received money
    FinanceCard(title = "Qaytarishlar (Refunds)", icon = Icons.Default.Warning) {
        RefundRow("So‘ralgan", summary.refundsRequested)
        RefundRow("Tasdiqlangan, yuborilishi kutilmoqda", summary.refundsApprovedAwaitingSend)
        RefundRow("Restoran yubordi deydi (tasdiqlanmagan)", summary.refundsSentUnconfirmed)
        RefundRow(
            "Mijoz/admin tasdiqlagan",
            FinanceRefundAmount(summary.refundsConfirmedCount, summary.refundsConfirmedSom)
        )
        RefundRow("Nizoli", summary.refundsDisputed, if (summary.refundsDisputed.count > 0) ErrorRed else null)
        RefundRow("Rad etilgan", summary.refundsRejected)
        HorizontalDivider(color = MaterialTheme.colorScheme.surfaceVariant)
        RefundRow("Hozir ochiq (barcha vaqt)", summary.refundsOpenNow, if (summary.refundsOpenNow.count > 0) WarningOrange else null)
        Text(
            text = if (summary.refundsBankVerified) {
                "Bank tomonidan tasdiqlangan."
            } else {
                "Qaytarishlar bank tomonidan tasdiqlanmagan. Tushumdan ayirilmaydi."
            },
            style = MaterialTheme.typography.bodySmall,
            fontSize = 11.sp,
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
