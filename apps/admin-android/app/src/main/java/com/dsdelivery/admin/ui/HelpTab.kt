package com.dsdelivery.admin.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

private val SECTIONS = listOf("Murojaatlar", "Taksi")

/**
 * "Yordam": what the Telegram commands /tickets, /taxiadmin, /newtaxi, /taxiapp and /deletetaxi did (the refund commands follow).
 * The selected part is owned by the caller so an item in "Diqqat" can open the right one.
 */
@Composable
fun HelpTab(section: Int, onSection: (Int) -> Unit, onMessage: (String) -> Unit) {
    Column(Modifier.fillMaxSize()) {
        TabRow(selectedTabIndex = section.coerceIn(0, SECTIONS.lastIndex), containerColor = MaterialTheme.colorScheme.surface) {
            SECTIONS.forEachIndexed { i, label ->
                Tab(selected = section == i, onClick = { onSection(i) }, text = { Text(label) })
            }
        }
        when (section) {
            1 -> TaxiPane(onMessage)
            else -> SupportPane(onMessage)
        }
    }
}
