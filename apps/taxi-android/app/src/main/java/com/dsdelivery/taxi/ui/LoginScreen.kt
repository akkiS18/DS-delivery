package com.dsdelivery.taxi.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.dsdelivery.taxi.TaxiApp
import com.dsdelivery.taxi.data.ApiResult
import kotlinx.coroutines.launch

@Composable
fun LoginScreen(onSignedIn: () -> Unit) {
    val app = TaxiApp.instance
    val scope = rememberCoroutineScope()
    var login by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    fun submit() {
        if (busy || login.isBlank() || password.isEmpty()) return
        busy = true
        error = null
        scope.launch {
            when (val r = app.repository.login(login, password)) {
                is ApiResult.Ok -> {
                    app.session.save(r.data.accessToken, r.data.company.name, r.data.company.login)
                    password = ""
                    onSignedIn()
                }
                is ApiResult.Locked -> error = "Juda ko‘p noto‘g‘ri urinish. ${(r.retryAfterSeconds + 59) / 60} daqiqadan keyin qayta urinib ko‘ring."
                is ApiResult.Offline -> error = "Internet yo‘q. Ulanishni tekshiring."
                is ApiResult.Failed -> error = if (r.code == 401) "Login yoki parol noto‘g‘ri." else if (r.code == 403) "Bu kompaniya o‘chirilgan. Administrator bilan bog‘laning." else "Kirib bo‘lmadi. Birozdan keyin qayta urinib ko‘ring."
                is ApiResult.Unauthorized -> error = "Login yoki parol noto‘g‘ri."
            }
            busy = false
        }
    }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp, vertical = 48.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Text("DS Taxi", style = MaterialTheme.typography.titleLarge)
        Text("Taksi operatori uchun", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyLarge)
        Spacer(Modifier.height(32.dp))
        OutlinedTextField(
            value = login, onValueChange = { login = it.trim() }, label = { Text("Login") }, singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii, imeAction = ImeAction.Next),
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
            value = password, onValueChange = { password = it }, label = { Text("Parol") }, singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
            keyboardActions = androidx.compose.foundation.text.KeyboardActions(onDone = { submit() }),
            modifier = Modifier.fillMaxWidth(),
        )
        error?.let {
            Spacer(Modifier.height(12.dp))
            Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
        }
        Spacer(Modifier.height(24.dp))
        Button(
            onClick = { submit() }, enabled = !busy && login.isNotBlank() && password.isNotEmpty(),
            colors = ButtonDefaults.buttonColors(containerColor = TaxiYellow, contentColor = androidx.compose.ui.graphics.Color(0xFF1B1B1F)),
            modifier = Modifier.fillMaxWidth().height(56.dp),
        ) {
            if (busy) CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp, color = androidx.compose.ui.graphics.Color(0xFF1B1B1F))
            else Text("Kirish")
        }
        Spacer(Modifier.height(16.dp))
        Text(
            "Login va parolni DS Delivery administratori beradi.",
            color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.align(Alignment.CenterHorizontally),
        )
    }
}
