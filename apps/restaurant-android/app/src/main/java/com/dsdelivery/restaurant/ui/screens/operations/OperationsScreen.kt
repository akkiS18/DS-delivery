package com.dsdelivery.restaurant.ui.screens.operations

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.AccessTime
import androidx.compose.material.icons.filled.CalendarToday
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.PowerSettingsNew
import androidx.compose.material.icons.filled.Storefront
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.dsdelivery.restaurant.data.model.WorkingDay
import com.dsdelivery.restaurant.ui.components.ActionConfirmDialog
import com.dsdelivery.restaurant.ui.components.ServerConfigDialog
import com.dsdelivery.restaurant.ui.theme.BrandDark
import com.dsdelivery.restaurant.ui.theme.BrandMint
import com.dsdelivery.restaurant.ui.theme.BrandPrimary
import com.dsdelivery.restaurant.ui.theme.DSRestaurantTheme
import com.dsdelivery.restaurant.ui.theme.ErrorRed
import com.dsdelivery.restaurant.ui.theme.SuccessGreen
import com.dsdelivery.restaurant.ui.theme.WarningOrange

@Composable
fun OperationsScreen(
    viewModel: OperationsViewModel,
    onLoggedOut: () -> Unit,
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

    OperationsContent(
        state = state,
        snackbarHostState = snackbarHostState,
        onTogglePause = viewModel::requestTogglePause,
        onConfirmTogglePause = viewModel::confirmTogglePause,
        onDismissPauseDialog = viewModel::dismissPauseDialog,
        onPrepMinutesChange = viewModel::onPrepMinutesChange,
        onEditWorkingDay = viewModel::onEditWorkingDay,
        onDismissWorkingDayDialog = viewModel::dismissWorkingDayDialog,
        onSaveWorkingDay = viewModel::onSaveWorkingDay,
        onOpenServerConfig = { viewModel.showServerConfig(true) },
        onCloseServerConfig = { viewModel.showServerConfig(false) },
        onSaveServerUrl = viewModel::updateBaseUrl,
        onOpenLogoutDialog = { viewModel.showLogoutDialog(true) },
        onDismissLogoutDialog = { viewModel.showLogoutDialog(false) },
        onConfirmLogout = { viewModel.logout(onLoggedOut) },
        onDismissNotice = viewModel::dismissNotice,
        modifier = modifier
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OperationsContent(
    state: OperationsUiState,
    snackbarHostState: SnackbarHostState,
    onTogglePause: (Boolean) -> Unit,
    onConfirmTogglePause: () -> Unit,
    onDismissPauseDialog: () -> Unit,
    onPrepMinutesChange: (Int) -> Unit,
    onEditWorkingDay: (WorkingDay) -> Unit,
    onDismissWorkingDayDialog: () -> Unit,
    onSaveWorkingDay: (WorkingDay) -> Unit,
    onOpenServerConfig: () -> Unit,
    onCloseServerConfig: () -> Unit,
    onSaveServerUrl: (String) -> Unit,
    onOpenLogoutDialog: () -> Unit,
    onDismissLogoutDialog: () -> Unit,
    onConfirmLogout: () -> Unit,
    onDismissNotice: () -> Unit,
    modifier: Modifier = Modifier
) {
    val scrollState = rememberScrollState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = "Restoran Operatsiyalari",
                        style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold)
                    )
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = BrandPrimary,
                    titleContentColor = Color.White
                )
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
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
            // Restaurant Active / Paused Status Card
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(
                                imageVector = Icons.Default.PowerSettingsNew,
                                contentDescription = null,
                                tint = if (state.isPaused) WarningOrange else SuccessGreen,
                                modifier = Modifier.size(20.dp)
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(
                                text = if (state.isPaused) "Pauza holati (To‘xtatilgan)" else "Faol qabul holati",
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.Bold,
                                color = if (state.isPaused) WarningOrange else SuccessGreen
                            )
                        }
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = if (state.isPaused) {
                                "Restoran vaqtincha yangi buyurtmalarni qabul qilmaydi."
                            } else {
                                "Restoran ochiq va mijozlardan buyurtma qabul qilishga tayyor."
                            },
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }

                    Switch(
                        checked = !state.isPaused,
                        onCheckedChange = { isChecked ->
                            onTogglePause(!isChecked)
                        },
                        colors = SwitchDefaults.colors(
                            checkedThumbColor = Color.White,
                            checkedTrackColor = BrandPrimary,
                            uncheckedThumbColor = Color.White,
                            uncheckedTrackColor = WarningOrange.copy(alpha = 0.5f)
                        )
                    )
                }
            }

            // Default Preparation Estimate Card
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            imageVector = Icons.Default.AccessTime,
                            contentDescription = null,
                            tint = BrandPrimary,
                            modifier = Modifier.size(20.dp)
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = "Standart tayyorlash vaqti",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.onSurface
                        )
                    }
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = "Yangi buyurtmalarni qabul qilishda boshlang‘ich taklif etiladigan vaqt:",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Text(
                        text = "Namunaviy qiymat: serverga hali saqlanmaydi.",
                        style = MaterialTheme.typography.bodySmall,
                        fontSize = 11.sp,
                        color = WarningOrange
                    )

                    Spacer(modifier = Modifier.height(10.dp))

                    val prepOptions = listOf(15, 20, 25, 30, 40, 50, 60)
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        prepOptions.take(4).forEach { min ->
                            FilterChip(
                                selected = state.defaultPrepMinutes == min,
                                onClick = { onPrepMinutesChange(min) },
                                label = { Text("$min daq", fontSize = 11.sp) },
                                colors = FilterChipDefaults.filterChipColors(
                                    selectedContainerColor = BrandPrimary,
                                    selectedLabelColor = Color.White
                                )
                            )
                        }
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        prepOptions.drop(4).forEach { min ->
                            FilterChip(
                                selected = state.defaultPrepMinutes == min,
                                onClick = { onPrepMinutesChange(min) },
                                label = { Text("$min daq", fontSize = 11.sp) },
                                colors = FilterChipDefaults.filterChipColors(
                                    selectedContainerColor = BrandPrimary,
                                    selectedLabelColor = Color.White
                                )
                            )
                        }
                    }
                }
            }

            // Working Hours Management Card
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(
                                imageVector = Icons.Default.CalendarToday,
                                contentDescription = null,
                                tint = BrandPrimary,
                                modifier = Modifier.size(20.dp)
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(
                                text = "Ish vaqti jadvali",
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.Bold,
                                color = MaterialTheme.colorScheme.onSurface
                            )
                        }
                    }

                    Text(
                        text = "Namunaviy jadval: serverga hali saqlanmaydi.",
                        style = MaterialTheme.typography.bodySmall,
                        fontSize = 11.sp,
                        color = WarningOrange
                    )

                    Spacer(modifier = Modifier.height(12.dp))

                    state.workingDays.forEachIndexed { index, day ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { onEditWorkingDay(day) }
                                .padding(vertical = 8.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = day.dayName,
                                style = MaterialTheme.typography.bodyMedium,
                                fontWeight = FontWeight.Medium,
                                color = MaterialTheme.colorScheme.onSurface,
                                modifier = Modifier.weight(1f)
                            )
                            Text(
                                text = if (day.isOpen) "${day.openTime} – ${day.closeTime}" else "Dam olish kuni",
                                style = MaterialTheme.typography.bodySmall,
                                color = if (day.isOpen) BrandPrimary else ErrorRed,
                                fontWeight = FontWeight.SemiBold
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Icon(
                                imageVector = Icons.Default.Edit,
                                contentDescription = "Tahrirlash",
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.size(16.dp)
                            )
                        }
                        if (index < state.workingDays.size - 1) {
                            HorizontalDivider(color = MaterialTheme.colorScheme.surfaceVariant)
                        }
                    }
                }
            }

            // Restaurant Info & Settings Card
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            imageVector = Icons.Default.Storefront,
                            contentDescription = null,
                            tint = BrandPrimary,
                            modifier = Modifier.size(20.dp)
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = "Restoran ma'lumotlari",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.onSurface
                        )
                    }

                    Spacer(modifier = Modifier.height(10.dp))

                    Text(
                        text = "Restoran nomi: ${state.restaurantName.ifBlank { "DS Restaurant" }}",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                    Text(
                        text = "Identifikator (slug): ${state.restaurantSlug}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )

                    Spacer(modifier = Modifier.height(14.dp))

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        OutlinedButton(
                            onClick = onOpenServerConfig,
                            modifier = Modifier.weight(1f),
                            shape = RoundedCornerShape(8.dp)
                        ) {
                            Icon(imageVector = Icons.Default.Dns, contentDescription = null, modifier = Modifier.size(16.dp))
                            Spacer(modifier = Modifier.width(6.dp))
                            Text("Server sozlamasi", fontSize = 12.sp)
                        }

                        Button(
                            onClick = onOpenLogoutDialog,
                            modifier = Modifier.weight(1f),
                            shape = RoundedCornerShape(8.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = ErrorRed)
                        ) {
                            Icon(imageVector = Icons.AutoMirrored.Filled.Logout, contentDescription = null, modifier = Modifier.size(16.dp))
                            Spacer(modifier = Modifier.width(6.dp))
                            Text("Chiqish", fontSize = 12.sp)
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(80.dp))
        }

        // Pause / Resume Confirmation Dialog
        if (state.showPauseConfirmDialog) {
            ActionConfirmDialog(
                title = if (state.pendingPauseState) "Pauzaga qo‘yish" else "Qabulni faollashtirish",
                message = if (state.pendingPauseState) {
                    "Haqiqatan ham restoranni vaqtincha to‘xtatmoqchimisiz? Yangi mijozlar buyurtma bera olmaydi."
                } else {
                    "Restoran holati faollashtirilsinmi? Mijozlar menyudan buyurtma berishni boshlashi mumkin."
                },
                confirmText = "Ha, tasdiqlash",
                confirmButtonColor = if (state.pendingPauseState) WarningOrange else BrandPrimary,
                onConfirm = onConfirmTogglePause,
                onDismiss = onDismissPauseDialog
            )
        }

        // Edit Working Day Dialog
        state.editingWorkingDay?.let { day ->
            var isOpen by remember { mutableStateOf(day.isOpen) }
            var openTime by remember { mutableStateOf(day.openTime) }
            var closeTime by remember { mutableStateOf(day.closeTime) }
            val hhmm = remember { Regex("^([01]\\d|2[0-3]):[0-5]\\d$") }
            // HH:MM 24h, and the day must close after it opens (same rule as the server).
            val timesError: String? = when {
                !hhmm.matches(openTime) || !hhmm.matches(closeTime) -> "Vaqtni SS:DD ko‘rinishida kiriting (masalan 09:00)."
                closeTime <= openTime -> "Yopilish vaqti ochilish vaqtidan keyin bo‘lishi kerak."
                else -> null
            }

            AlertDialog(
                onDismissRequest = onDismissWorkingDayDialog,
                title = { Text("${day.dayName} ish vaqti", fontWeight = FontWeight.Bold) },
                text = {
                    Column {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text("Ochiq kun (Ish kuni)", style = MaterialTheme.typography.bodyMedium)
                            Switch(
                                checked = isOpen,
                                onCheckedChange = { isOpen = it },
                                colors = SwitchDefaults.colors(checkedThumbColor = Color.White, checkedTrackColor = BrandPrimary)
                            )
                        }

                        if (isOpen) {
                            Spacer(modifier = Modifier.height(10.dp))
                            OutlinedTextField(
                                value = openTime,
                                onValueChange = { openTime = it },
                                label = { Text("Ochilish vaqti") },
                                placeholder = { Text("09:00") },
                                singleLine = true,
                                isError = !hhmm.matches(openTime),
                                modifier = Modifier.fillMaxWidth()
                            )
                            Spacer(modifier = Modifier.height(8.dp))
                            OutlinedTextField(
                                value = closeTime,
                                onValueChange = { closeTime = it },
                                label = { Text("Yopilish vaqti") },
                                placeholder = { Text("22:00") },
                                singleLine = true,
                                isError = !hhmm.matches(closeTime),
                                modifier = Modifier.fillMaxWidth()
                            )
                            if (timesError != null) {
                                Spacer(modifier = Modifier.height(6.dp))
                                Text(timesError, style = MaterialTheme.typography.bodySmall, color = ErrorRed)
                            }
                        }
                    }
                },
                confirmButton = {
                    Button(
                        enabled = !isOpen || timesError == null,
                        onClick = {
                            // A closed day keeps its last valid times: the server still stores HH:MM for it.
                            onSaveWorkingDay(
                                if (isOpen) day.copy(isOpen = true, openTime = openTime, closeTime = closeTime)
                                else day.copy(isOpen = false)
                            )
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = BrandPrimary)
                    ) {
                        Text("Saqlash")
                    }
                },
                dismissButton = {
                    TextButton(onClick = onDismissWorkingDayDialog) {
                        Text("Bekor qilish")
                    }
                },
                shape = RoundedCornerShape(16.dp)
            )
        }

        // Server Config Dialog
        if (state.showServerConfigDialog) {
            ServerConfigDialog(
                currentBaseUrl = state.currentBaseUrl,
                onDismiss = onCloseServerConfig,
                onSave = onSaveServerUrl
            )
        }

        // Logout Confirmation Dialog
        if (state.showLogoutConfirmDialog) {
            ActionConfirmDialog(
                title = "Tizimdan chiqish",
                message = "Haqiqatan ham restoran hisobidan chiqmoqchimisiz?",
                confirmText = "Chiqish",
                confirmButtonColor = ErrorRed,
                onConfirm = onConfirmLogout,
                onDismiss = onDismissLogoutDialog
            )
        }

        // Backend Notice Dialog
        if (state.backendNotice != null) {
            AlertDialog(
                onDismissRequest = onDismissNotice,
                icon = {
                    Icon(imageVector = Icons.Default.Info, contentDescription = null, tint = BrandPrimary, modifier = Modifier.size(36.dp))
                },
                title = { Text("Backend Holati", fontWeight = FontWeight.Bold) },
                text = {
                    Text(
                        text = state.backendNotice ?: "",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                },
                confirmButton = {
                    Button(onClick = onDismissNotice, colors = ButtonDefaults.buttonColors(containerColor = BrandPrimary)) {
                        Text("Tushunarli")
                    }
                },
                shape = RoundedCornerShape(16.dp)
            )
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun OperationsScreenPreview() {
    DSRestaurantTheme {
        OperationsContent(
            state = OperationsUiState(
                restaurantName = "Klassik Burger Express",
                restaurantSlug = "burger-express",
                isPaused = false
            ),
            snackbarHostState = remember { SnackbarHostState() },
            onTogglePause = {},
            onConfirmTogglePause = {},
            onDismissPauseDialog = {},
            onPrepMinutesChange = {},
            onEditWorkingDay = {},
            onDismissWorkingDayDialog = {},
            onSaveWorkingDay = {},
            onOpenServerConfig = {},
            onCloseServerConfig = {},
            onSaveServerUrl = {},
            onOpenLogoutDialog = {},
            onDismissLogoutDialog = {},
            onConfirmLogout = {},
            onDismissNotice = {}
        )
    }
}
