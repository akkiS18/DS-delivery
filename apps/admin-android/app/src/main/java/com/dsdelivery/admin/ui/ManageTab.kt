package com.dsdelivery.admin.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier

private val SECTIONS = listOf("Restoranlar", "Komissiya", "Platforma", "Aksiya", "Joylar")

/** "Boshqaruv": what the Telegram commands /restaurants, /commission, /payments, /cash, /fee, /taxi, /ratings and /aksiya did. */
@Composable
fun ManageTab(onMessage: (String) -> Unit) {
    var section by rememberSaveable { mutableIntStateOf(0) }
    Column(Modifier.fillMaxSize()) {
        TabRow(selectedTabIndex = section, containerColor = MaterialTheme.colorScheme.surface) {
            SECTIONS.forEachIndexed { i, label ->
                Tab(selected = section == i, onClick = { section = i }, text = { Text(label) })
            }
        }
        when (section) {
            0 -> RestaurantsPane(onMessage)
            1 -> CommissionPane(onMessage)
            2 -> PlatformPane(onMessage)
            3 -> PromoPane(onMessage)
            else -> LandmarksPane(onMessage)
        }
    }
}
