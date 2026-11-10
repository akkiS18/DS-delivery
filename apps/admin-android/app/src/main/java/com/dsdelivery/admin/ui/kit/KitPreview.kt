package com.dsdelivery.admin.ui.kit

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.dsdelivery.admin.ui.DSAdminTheme
import com.dsdelivery.admin.ui.Tone

/** Gallery of the kit for Android Studio (Preview pane): every component, light and dark. Not used at run time. */
@Composable
private fun Gallery(dark: Boolean) {
    DSAdminTheme(darkTheme = dark) {
        Surface(color = MaterialTheme.colorScheme.background) {
            Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    MetricTile("Bugungi buyurtmalar", "128", Modifier.weight(1f), hint = "9 tasi jarayonda")
                    MetricTile("Tölanmagan komissiya", "1 250 000 söm", Modifier.weight(1f), tone = Tone.WARN)
                }
                Notice("Ulaniş yöq — ma’lumot eskirgan bölişi mumkin", Tone.WARN)
                SectionHeader("Şoşilinç işlar")
                AdminCard {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        StatusChip("Şoşilinç", Tone.URGENT); StatusChip("Kutilmoqda", Tone.WARN); StatusChip("Tölandi", Tone.OK); StatusChip("Ma’lumot", Tone.INFO); StatusChip("Öçiq", Tone.NEUTRAL)
                    }
                    ListRow("Sifat Food", subtitle = "Tölov tasdiqlanmagan · 14 daqiqa", onClick = {})
                    PrimaryButton("Tasdiqlaş", {})
                    SecondaryButton("Bekor qiliş", {})
                    DangerButton("Öçiriş", {})
                }
                FormField("", {}, "Telegram ID", hint = "Faqat raqamlar")
                FormField("12ab", {}, "Summa", error = "Faqat raqamlar bölsin")
                EmptyState("Hali joy qöşilmagan", hint = "“Yangi joy” tugmasi bilan birinçisini qöşing.")
                ErrorState(onRetry = {})
                LoadingSkeleton(cards = 1)
            }
        }
    }
}

@Preview(name = "Kit light", showBackground = true, heightDp = 1100) @Composable private fun GalleryLight() = Gallery(false)
@Preview(name = "Kit dark", showBackground = true, heightDp = 1100) @Composable private fun GalleryDark() = Gallery(true)
