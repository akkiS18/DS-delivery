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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier

private val SECTIONS = listOf("Murojaatlar")

/** "Yordam": what the Telegram commands /tickets (and, in the next steps, the taxi and refund commands) did. */
@Composable
fun HelpTab(onMessage: (String) -> Unit) {
    var section by rememberSaveable { mutableIntStateOf(0) }
    Column(Modifier.fillMaxSize()) {
        TabRow(selectedTabIndex = section, containerColor = MaterialTheme.colorScheme.surface) {
            SECTIONS.forEachIndexed { i, label ->
                Tab(selected = section == i, onClick = { section = i }, text = { Text(label) })
            }
        }
        when (section) {
            else -> SupportPane(onMessage)
        }
    }
}
