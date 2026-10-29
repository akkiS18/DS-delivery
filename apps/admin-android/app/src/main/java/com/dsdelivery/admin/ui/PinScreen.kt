package com.dsdelivery.admin.ui

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
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.dsdelivery.admin.AdminApp
import com.dsdelivery.admin.core.PinLock
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * The local PIN. [create] = first time after signing in (type it twice); otherwise it asks for the PIN again whenever the app was away
 * for a minute. The PIN protects the screen on this phone only; the alarm keeps ringing while the screen is locked.
 */
@Composable
fun PinScreen(create: Boolean, onDone: () -> Unit) {
    val app = AdminApp.instance
    val scope = rememberCoroutineScope()
    var pin by remember { mutableStateOf("") }
    var again by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var lockedUntil by remember { mutableLongStateOf(app.session.pinLockedUntil) }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }

    LaunchedEffect(lockedUntil) {
        while (System.currentTimeMillis() < lockedUntil) {
            now = System.currentTimeMillis()
            delay(500)
        }
        now = System.currentTimeMillis()
    }
    val lockLeft = ((lockedUntil - now + 999) / 1000).coerceAtLeast(0)
    val locked = !create && lockLeft > 0

    fun submitCreate() {
        if (busy) return
        when {
            !PinLock.isValidPin(pin) -> error = "PIN ${PinLock.MIN_LEN}–${PinLock.MAX_LEN} ta raqamdan iborat bo‘lishi kerak."
            pin != again -> error = "PIN lar bir xil emas."
            else -> {
                busy = true
                scope.launch {
                    val salt = PinLock.newSalt()
                    val hash = withContext(Dispatchers.Default) { PinLock.hash(pin, salt) }
                    app.session.savePin(salt, hash)
                    pin = ""; again = ""; busy = false
                    onDone()
                }
            }
        }
    }

    fun submitEnter() {
        if (busy || locked || pin.length < PinLock.MIN_LEN) return
        busy = true
        error = null
        scope.launch {
            val ok = withContext(Dispatchers.Default) { PinLock.matches(pin, app.session.pinSalt, app.session.pinHash) }
            pin = ""
            if (ok) {
                app.session.resetPinFailures()
                busy = false
                onDone()
                return@launch
            }
            val fails = app.session.pinFails + 1
            if (PinLock.shouldWipe(fails)) {
                // Too many wrong tries: close this phone's server session too, then require a new Telegram code.
                app.repository.logout()
                app.watcher.signOutLocally()
                return@launch
            }
            val wait = PinLock.lockoutSeconds(fails)
            val until = if (wait > 0) System.currentTimeMillis() + wait * 1000L else 0L
            app.session.recordPinFailure(fails, until)
            lockedUntil = until
            error = if (wait > 0) "PIN noto‘g‘ri. $wait soniya kuting."
            else "PIN noto‘g‘ri. Qolgan urinish: ${PinLock.WIPE_AFTER - fails}."
            busy = false
        }
    }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp, vertical = 48.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Text(if (create) "PIN o‘rnating" else "PIN kiriting", style = MaterialTheme.typography.titleLarge)
        Text(
            if (create) "Telefon boshqa birovning qo‘liga tushsa, ilovani PIN himoya qiladi. Signal PIN siz ham chalinaveradi."
            else "Ilova bir daqiqadan ko‘p fonda turdi.",
            color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyLarge,
        )
        Spacer(Modifier.height(28.dp))
        OutlinedTextField(
            value = pin, onValueChange = { v -> if (v.length <= PinLock.MAX_LEN && v.all { it.isDigit() }) pin = v },
            label = { Text("PIN") }, singleLine = true, enabled = !locked,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword, imeAction = if (create) ImeAction.Next else ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { submitEnter() }),
            modifier = Modifier.fillMaxWidth(),
        )
        if (create) {
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = again, onValueChange = { v -> if (v.length <= PinLock.MAX_LEN && v.all { it.isDigit() }) again = v },
                label = { Text("PIN ni takrorlang") }, singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { submitCreate() }),
                modifier = Modifier.fillMaxWidth(),
            )
        }
        if (locked) {
            Spacer(Modifier.height(12.dp))
            Text("Qulflangan: $lockLeft soniya", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyLarge)
        }
        error?.let {
            Spacer(Modifier.height(12.dp))
            Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
        }
        Spacer(Modifier.height(24.dp))
        Button(
            onClick = { if (create) submitCreate() else submitEnter() },
            enabled = !busy && !locked && pin.length >= PinLock.MIN_LEN && (!create || again.length >= PinLock.MIN_LEN),
            modifier = Modifier.fillMaxWidth().height(56.dp),
        ) {
            if (busy) CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
            else Text(if (create) "Saqlash" else "Ochish")
        }
        if (!create) {
            Spacer(Modifier.height(12.dp))
            TextButton(
                onClick = {
                    scope.launch {
                        app.repository.logout()
                        app.watcher.signOutLocally()
                    }
                },
                modifier = Modifier.fillMaxWidth(),
            ) { Text("PIN ni unutdim — Telegram kodi bilan qayta kirish") }
        }
    }
}
