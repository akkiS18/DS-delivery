package com.dsdelivery.admin.ui

import android.os.Build
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.dsdelivery.admin.AdminApp
import com.dsdelivery.admin.data.ApiResult
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Step 1: the administrator's Telegram id. Step 2: the 6-digit code the DS bot sends to that Telegram account. */
@Composable
fun LoginScreen(onSignedIn: () -> Unit) {
    val app = AdminApp.instance
    val scope = rememberCoroutineScope()
    var telegramId by remember { mutableStateOf(app.session.lastTelegramId) }
    var code by remember { mutableStateOf("") }
    var codeSent by remember { mutableStateOf(false) }
    var validMinutes by remember { mutableIntStateOf(10) }
    var resendIn by remember { mutableIntStateOf(0) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(resendIn) {
        if (resendIn > 0) { delay(1000); resendIn -= 1 }
    }

    fun minutes(seconds: Int) = (seconds + 59) / 60

    fun requestCode() {
        if (busy || telegramId.isBlank()) return
        busy = true
        error = null
        scope.launch {
            when (val r = app.repository.requestCode(telegramId)) {
                is ApiResult.Ok -> {
                    app.session.rememberTelegramId(telegramId)
                    validMinutes = r.data.validMinutes
                    codeSent = true
                    code = ""
                    resendIn = 60
                }
                is ApiResult.Locked -> error = "Juda köp uriniş. ${minutes(r.retryAfterSeconds)} daqiqadan keyin qayta urinib köring."
                is ApiResult.Offline -> error = "Internet yöq. Ulanişni tekşiring."
                is ApiResult.Unauthorized, is ApiResult.Failed -> error = "Sörov bajarilmadi. Telegram ID ni tekşirib, qayta urinib köring."
            }
            busy = false
        }
    }

    fun verify() {
        if (busy || code.length != 6) return
        busy = true
        error = null
        scope.launch {
            val device = "${Build.MANUFACTURER} ${Build.MODEL}".trim().take(100)
            when (val r = app.repository.verify(telegramId, code, device)) {
                is ApiResult.Ok -> {
                    app.session.save(r.data.accessToken, r.data.admin.telegramUserId)
                    code = ""
                    onSignedIn()
                }
                is ApiResult.Locked -> error = "Juda köp notöğri uriniş. ${minutes(r.retryAfterSeconds)} daqiqadan keyin qayta urinib köring."
                is ApiResult.Offline -> error = "Internet yöq. Ulanişni tekşiring."
                is ApiResult.Unauthorized -> error = "Kod notöğri yoki muddati ötgan."
                is ApiResult.Failed -> error = if (r.code == 401) "Kod notöğri yoki muddati ötgan." else "Kirib bölmadi. Birozdan keyin qayta urinib köring."
            }
            busy = false
        }
    }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp, vertical = 48.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Text("DS Admin", style = MaterialTheme.typography.titleLarge)
        Text("Administrator uçun", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyLarge)
        Spacer(Modifier.height(32.dp))

        if (!codeSent) {
            OutlinedTextField(
                value = telegramId, onValueChange = { v -> if (v.length <= 20 && v.all { it.isDigit() }) telegramId = v },
                label = { Text("Telegram ID") }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { requestCode() }),
                modifier = Modifier.fillMaxWidth(),
            )
            error?.let {
                Spacer(Modifier.height(12.dp))
                Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
            }
            Spacer(Modifier.height(24.dp))
            Button(onClick = { requestCode() }, enabled = !busy && telegramId.isNotBlank(), modifier = Modifier.fillMaxWidth().height(56.dp)) {
                if (busy) CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
                else Text("Kod yuboriş")
            }
            Spacer(Modifier.height(16.dp))
            Text(
                "Kod DS Delivery botidagi Telegram çatingizga keladi. Bot bilan avval „/start“ bosilgan bölişi kerak.",
                color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium,
            )
        } else {
            Text("Telegramga 6 xonali kod yuborildi ($validMinutes daqiqa amal qiladi).", style = MaterialTheme.typography.bodyLarge)
            Spacer(Modifier.height(16.dp))
            OutlinedTextField(
                value = code, onValueChange = { v -> if (v.length <= 6 && v.all { it.isDigit() }) code = v },
                label = { Text("Kod") }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { verify() }),
                modifier = Modifier.fillMaxWidth(),
            )
            error?.let {
                Spacer(Modifier.height(12.dp))
                Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
            }
            Spacer(Modifier.height(24.dp))
            Button(onClick = { verify() }, enabled = !busy && code.length == 6, modifier = Modifier.fillMaxWidth().height(56.dp)) {
                if (busy) CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
                else Text("Kiriş")
            }
            Spacer(Modifier.height(8.dp))
            TextButton(onClick = { requestCode() }, enabled = !busy && resendIn == 0, modifier = Modifier.fillMaxWidth()) {
                Text(if (resendIn > 0) "Kodni qayta yuboriş ($resendIn)" else "Kodni qayta yuboriş")
            }
            TextButton(onClick = { codeSent = false; code = ""; error = null }, modifier = Modifier.fillMaxWidth()) { Text("Telegram ID ni özgartiriş") }
        }
    }
}
