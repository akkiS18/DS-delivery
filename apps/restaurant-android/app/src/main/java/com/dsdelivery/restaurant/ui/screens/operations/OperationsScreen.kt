package com.dsdelivery.restaurant.ui.screens.operations

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronRight
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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
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
import com.dsdelivery.restaurant.BuildConfig
import com.dsdelivery.restaurant.data.model.PayeeCard
import com.dsdelivery.restaurant.data.model.WorkingDay
import com.dsdelivery.restaurant.ui.components.ActionConfirmDialog
import com.dsdelivery.restaurant.ui.components.PullRefresh
import com.dsdelivery.restaurant.ui.components.ServerConfigDialog
import com.dsdelivery.restaurant.ui.screens.reservations.ReservationsViewModel
import com.dsdelivery.restaurant.ui.theme.BrandPrimary
import com.dsdelivery.restaurant.ui.theme.DSRestaurantTheme
import com.dsdelivery.restaurant.ui.theme.ErrorRed
import com.dsdelivery.restaurant.ui.theme.WarningOrange

@Composable
fun OperationsScreen(
    viewModel: OperationsViewModel,
    reservationsViewModel: ReservationsViewModel,
    onLoggedOut: () -> Unit,
    modifier: Modifier = Modifier,
    onOpenRatings: () -> Unit = {}
) {
    val state by viewModel.uiState.collectAsState()
    val reservations by reservationsViewModel.uiState.collectAsState()
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
        onAddCard = { viewModel.showAddCard(true) },
        onDismissAddCard = { viewModel.showAddCard(false) },
        onSubmitCard = viewModel::submitCard,
        onToggleCard = viewModel::toggleCard,
        onReloadCards = { viewModel.loadOperations(); viewModel.loadCards() },
        onOpenRatings = onOpenRatings,
        onSaveSchedule = viewModel::saveShownWorkingHours,
        reservationSection = {
            ReservationSettingsSection(
                settings = reservations.settings,
                busy = reservations.settingsBusy,
                error = reservations.settingsError,
                onSave = reservationsViewModel::saveSettings,
                onDismissError = reservationsViewModel::dismissSettingsError
            )
        },
        modifier = modifier
    )
}

/** A titled group of rows, like a grouped list in system settings: the title says what it is, the card holds the controls. */
@Composable
internal fun SettingsSection(
    title: String,
    modifier: Modifier = Modifier,
    footer: String? = null,
    content: @Composable ColumnScope.() -> Unit
) {
    Column(modifier = modifier.fillMaxWidth()) {
        Text(
            text = title,
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(start = 4.dp, bottom = 6.dp)
        )
        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(14.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
        ) {
            Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), content = content)
        }
        if (footer != null) {
            Text(
                text = footer,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(start = 4.dp, top = 6.dp)
            )
        }
    }
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
    onAddCard: () -> Unit,
    onDismissAddCard: () -> Unit,
    onSubmitCard: (String, String) -> Unit,
    onToggleCard: (PayeeCard) -> Unit,
    onReloadCards: () -> Unit,
    modifier: Modifier = Modifier,
    onOpenRatings: () -> Unit = {},
    onSaveSchedule: () -> Unit = {},
    reservationSection: @Composable () -> Unit = {}
) {
    val scrollState = rememberScrollState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(text = "Sozlamalar", fontWeight = FontWeight.Bold) },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = BrandPrimary,
                    titleContentColor = Color.White
                )
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
        modifier = modifier
    ) { innerPadding ->
        PullRefresh(
            isRefreshing = state.cardsLoading,
            onRefresh = onReloadCards,
            modifier = Modifier.fillMaxSize().padding(innerPadding).background(MaterialTheme.colorScheme.background)
        ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(scrollState)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp)
        ) {
            // 1. Are we taking orders right now?
            SettingsSection(title = "Qabul") {
                Row(
                    modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Buyurtma qabul qilish", style = MaterialTheme.typography.bodyLarge)
                        if (state.isPaused) {
                            Text("To‘xtatilgan", style = MaterialTheme.typography.bodyMedium, color = WarningOrange)
                        }
                    }
                    Switch(
                        checked = !state.isPaused,
                        onCheckedChange = { isChecked -> onTogglePause(!isChecked) },
                        colors = SwitchDefaults.colors(
                            checkedThumbColor = Color.White,
                            checkedTrackColor = BrandPrimary,
                            uncheckedThumbColor = Color.White,
                            uncheckedTrackColor = WarningOrange.copy(alpha = 0.5f)
                        )
                    )
                }
            }

            // 1b. The kitchen bell
            BellSection()

            // 2. Where the customers' money goes
            PayeeCardsSection(
                cards = state.cards,
                loading = state.cardsLoading,
                error = state.cardsError,
                busyCardId = state.busyCardId,
                onAdd = onAddCard,
                onToggle = onToggleCard,
                onRetry = onReloadCards
            )

            // 2b. Table reservations
            reservationSection()

            // 2c. Customers' ratings of the food (was a bottom tab)
            SettingsSection(title = "Baholar") {
                Row(
                    modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp).clickable { onOpenRatings() },
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("Mijozlar baholari", style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
                    Icon(
                        imageVector = Icons.Default.ChevronRight,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(20.dp)
                    )
                }
            }

            // 3. Working hours
            SettingsSection(title = "Ish vaqti") {
                if (!state.workingHoursSet) {
                    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(
                            "Ish vaqti hali saqlanmagan: hozir restoran kechayu-kunduz ochiq hisoblanadi va mijozlar istalgan soatda buyurtma bera oladi. Pastdagi soatlar ko‘rsatma xolos.",
                            style = MaterialTheme.typography.bodySmall,
                            color = WarningOrange
                        )
                        Button(onClick = onSaveSchedule, colors = ButtonDefaults.buttonColors(containerColor = BrandPrimary)) {
                            Text("Shu soatlarni saqlash")
                        }
                    }
                    HorizontalDivider(color = MaterialTheme.colorScheme.surfaceVariant)
                }
                state.workingDays.forEachIndexed { index, day ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(min = 48.dp)
                            .clickable { onEditWorkingDay(day) },
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(day.dayName, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
                        Text(
                            text = if (day.isOpen) "${day.openTime} – ${day.closeTime}" else "Yopiq",
                            style = MaterialTheme.typography.bodyMedium,
                            color = if (day.isOpen) MaterialTheme.colorScheme.onSurfaceVariant else ErrorRed
                        )
                        Icon(
                            imageVector = Icons.Default.ChevronRight,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.size(20.dp)
                        )
                    }
                    if (index < state.workingDays.size - 1) {
                        HorizontalDivider(color = MaterialTheme.colorScheme.surfaceVariant)
                    }
                }
            }

            // 5. Account
            SettingsSection(title = "Hisob") {
                Row(
                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("Restoran", style = MaterialTheme.typography.bodyLarge)
                    Text(
                        state.restaurantName.ifBlank { "—" },
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.surfaceVariant)
                // The server address is a developer setting: it does not exist in the release app.
                if (BuildConfig.DEBUG) {
                    Row(
                        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable { onOpenServerConfig() },
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("Server", style = MaterialTheme.typography.bodyLarge)
                        Icon(
                            imageVector = Icons.Default.ChevronRight,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.size(20.dp)
                        )
                    }
                    HorizontalDivider(color = MaterialTheme.colorScheme.surfaceVariant)
                }
                TextButton(
                    onClick = onOpenLogoutDialog,
                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                ) {
                    Text("Chiqish", color = ErrorRed, style = MaterialTheme.typography.bodyLarge)
                }
            }

            Spacer(modifier = Modifier.height(24.dp))
        }
        }

        if (state.showAddCardDialog) {
            AddCardDialog(
                busy = state.addCardBusy,
                error = state.addCardError,
                onDismiss = onDismissAddCard,
                onSubmit = onSubmitCard
            )
        }

        if (state.showPauseConfirmDialog) {
            ActionConfirmDialog(
                title = if (state.pendingPauseState) "Qabulni to‘xtatasizmi?" else "Qabulni yoqasizmi?",
                message = if (state.pendingPauseState) "Yangi buyurtmalar kelmaydi." else "Mijozlar yana buyurtma bera oladi.",
                confirmText = if (state.pendingPauseState) "To‘xtatish" else "Yoqish",
                confirmButtonColor = if (state.pendingPauseState) WarningOrange else BrandPrimary,
                onConfirm = onConfirmTogglePause,
                onDismiss = onDismissPauseDialog
            )
        }

        state.editingWorkingDay?.let { day ->
            var isOpen by remember { mutableStateOf(day.isOpen) }
            var openTime by remember { mutableStateOf(day.openTime) }
            var closeTime by remember { mutableStateOf(day.closeTime) }
            val hhmm = remember { Regex("^([01]\\d|2[0-3]):[0-5]\\d$") }
            // HH:MM 24h, and the day must close after it opens (same rule as the server).
            val timesError: String? = when {
                !hhmm.matches(openTime) || !hhmm.matches(closeTime) -> "Vaqtni 09:00 ko‘rinishida yozing."
                closeTime <= openTime -> "Yopilish vaqti ochilishdan keyin bo‘lsin."
                else -> null
            }

            AlertDialog(
                onDismissRequest = onDismissWorkingDayDialog,
                title = { Text(day.dayName, fontWeight = FontWeight.Bold) },
                text = {
                    Column {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text("Ochiq", style = MaterialTheme.typography.bodyLarge)
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
                                label = { Text("Ochilish") },
                                placeholder = { Text("09:00") },
                                singleLine = true,
                                isError = !hhmm.matches(openTime),
                                modifier = Modifier.fillMaxWidth()
                            )
                            Spacer(modifier = Modifier.height(8.dp))
                            OutlinedTextField(
                                value = closeTime,
                                onValueChange = { closeTime = it },
                                label = { Text("Yopilish") },
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
                        Text("Yopish")
                    }
                },
                shape = RoundedCornerShape(16.dp)
            )
        }

        if (state.showServerConfigDialog) {
            ServerConfigDialog(
                currentBaseUrl = state.currentBaseUrl,
                onDismiss = onCloseServerConfig,
                onSave = onSaveServerUrl
            )
        }

        if (state.showLogoutConfirmDialog) {
            ActionConfirmDialog(
                title = "Chiqasizmi?",
                message = "Qayta kirish uchun parol kerak bo‘ladi.",
                confirmText = "Chiqish",
                confirmButtonColor = ErrorRed,
                onConfirm = onConfirmLogout,
                onDismiss = onDismissLogoutDialog
            )
        }

        // Anything the server refused to save, in one sentence.
        if (state.backendNotice != null) {
            AlertDialog(
                onDismissRequest = onDismissNotice,
                title = { Text("Saqlanmadi", fontWeight = FontWeight.Bold) },
                text = { Text(text = state.backendNotice ?: "", style = MaterialTheme.typography.bodyMedium) },
                confirmButton = {
                    Button(onClick = onDismissNotice, colors = ButtonDefaults.buttonColors(containerColor = BrandPrimary)) {
                        Text("Yaxshi")
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
            onDismissNotice = {},
            onAddCard = {},
            onDismissAddCard = {},
            onSubmitCard = { _, _ -> },
            onToggleCard = {},
            onReloadCards = {}
        )
    }
}
