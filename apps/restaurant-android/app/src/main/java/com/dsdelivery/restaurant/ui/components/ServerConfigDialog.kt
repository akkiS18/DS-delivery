package com.dsdelivery.restaurant.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SuggestionChip
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.dsdelivery.restaurant.BuildConfig
import com.dsdelivery.restaurant.data.api.ApiConfig
import com.dsdelivery.restaurant.ui.theme.BrandPrimary

@Composable
fun ServerConfigDialog(
    currentBaseUrl: String,
    onDismiss: () -> Unit,
    onSave: (String) -> Unit
) {
    var urlInput by remember { mutableStateOf(currentBaseUrl) }
    var errorText by remember { mutableStateOf<String?>(null) }

    AlertDialog(
        onDismissRequest = onDismiss,
        icon = {
            Icon(
                imageVector = Icons.Default.Dns,
                contentDescription = null,
                tint = BrandPrimary
            )
        },
        title = {
            Text(
                text = "Backend Server Sozlamasi",
                style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold)
            )
        },
        text = {
            Column(modifier = Modifier.fillMaxWidth()) {
                Text(
                    text = if (BuildConfig.DEBUG) {
                        "API Base URL manzilini kiriting. HTTPS tavsiya etiladi; HTTP faqat lokal ishlab chiqish manzillari uchun."
                    } else {
                        "API Base URL manzilini kiriting. Faqat HTTPS (https://...) manzillari qabul qilinadi."
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                Spacer(modifier = Modifier.height(12.dp))

                OutlinedTextField(
                    value = urlInput,
                    onValueChange = {
                        urlInput = it
                        errorText = null
                    },
                    label = { Text("Base URL") },
                    placeholder = { Text(if (BuildConfig.DEBUG) "http://192.168.1.100:4000/" else "https://api.example.com/") },
                    singleLine = true,
                    isError = errorText != null,
                    supportingText = errorText?.let { { Text(it, color = MaterialTheme.colorScheme.error) } },
                    modifier = Modifier.fillMaxWidth()
                )

                if (BuildConfig.DEBUG) {
                    Spacer(modifier = Modifier.height(12.dp))

                    Text(
                        text = "Tezkor variantlar:",
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.SemiBold
                    )

                    Spacer(modifier = Modifier.height(6.dp))

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        SuggestionChip(
                            onClick = { urlInput = ApiConfig.EMULATOR_URL },
                            label = { Text("Emulator (10.0.2.2)", fontSize = 11.sp) }
                        )

                        SuggestionChip(
                            onClick = { urlInput = ApiConfig.LOCALHOST_URL },
                            label = { Text("Localhost", fontSize = 11.sp) }
                        )
                    }
                }
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    if (urlInput.isBlank()) {
                        errorText = "URL bo‘sh bo‘lishi mumkin emas"
                    } else if (ApiConfig.validationError(urlInput) != null) {
                        errorText = ApiConfig.validationError(urlInput)
                    } else {
                        onSave(urlInput)
                        onDismiss()
                    }
                },
                colors = ButtonDefaults.buttonColors(containerColor = BrandPrimary)
            ) {
                Text("Saqlash")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Bekor qilish")
            }
        },
        shape = RoundedCornerShape(16.dp)
    )
}
