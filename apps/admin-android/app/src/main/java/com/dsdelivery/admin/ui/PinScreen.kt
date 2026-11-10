package com.dsdelivery.admin.ui

import android.os.CancellationSignal
import androidx.compose.foundation.Image
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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.dsdelivery.admin.AdminApp
import com.dsdelivery.admin.R
import com.dsdelivery.admin.core.Biometric
import com.dsdelivery.admin.core.PinLock
import com.dsdelivery.admin.ui.kit.PrimaryButton
import com.dsdelivery.admin.ui.kit.SecondaryButton
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * The local PIN. [create] = first time after signing in (type it twice, then the phone may offer fingerprint / face); otherwise it
 * asks again whenever the app was away for a minute: fingerprint / face first when switched on, then the PIN, which opens the app by
 * itself as soon as the last digit is typed (no confirm button). The PIN protects the screen on this phone only; the alarm keeps ringing
 * while the screen is locked. A failed or cancelled fingerprint never counts as a wrong PIN.
 */
@Composable
fun PinScreen(create: Boolean, onDone: () -> Unit) {
    val app = AdminApp.instance
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var pin by remember { mutableStateOf("") }
    var again by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var lockedUntil by remember { mutableLongStateOf(app.session.pinLockedUntil) }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    var offer by remember { mutableStateOf(false) } // after the PIN was saved: "use fingerprint too?"
    val focus = remember { FocusRequester() }
    var signal by remember { mutableStateOf<CancellationSignal?>(null) }
    // Checked each time the screen opens: a finger removed from the phone switches the fingerprint off by itself.
    val bioReady = remember { Biometric.available(context) }
    val bioOn = !create && bioReady && app.session.biometricEnabled
    val autoOpen = !create && PinLock.autoSubmit(pin.length, app.session.pinLength)

    LaunchedEffect(lockedUntil) {
        while (System.currentTimeMillis() < lockedUntil) {
            now = System.currentTimeMillis()
            delay(500)
        }
        now = System.currentTimeMillis()
    }
    val lockLeft = ((lockedUntil - now + 999) / 1000).coerceAtLeast(0)
    val locked = !create && lockLeft > 0

    fun focusPin() { runCatching { focus.requestFocus() } }

    fun askBiometric() {
        signal?.cancel()
        signal = Biometric.prompt(context, "DS Admin", "Barmoq izi bilan oçiş", "PIN kiritiş") { ok -> if (ok) onDone() else focusPin() }
    }

    // The fingerprint comes before the PIN: it is asked at once; the keypad only gets the focus if it was not recognised.
    LaunchedEffect(Unit) { if (bioOn) askBiometric() else if (!create) focusPin() }
    DisposableEffect(Unit) { onDispose { signal?.cancel() } }

    fun submitCreate() {
        if (busy) return
        when {
            !PinLock.isValidPin(pin) -> error = "PIN ${PinLock.MIN_LEN}–${PinLock.MAX_LEN} ta raqamdan iborat bölişi kerak."
            pin != again -> error = "PIN lar bir xil emas."
            else -> {
                busy = true
                scope.launch {
                    val salt = PinLock.newSalt()
                    val typed = pin
                    val hash = withContext(Dispatchers.Default) { PinLock.hash(typed, salt) }
                    app.session.savePin(salt, hash, typed.length)
                    pin = ""; again = ""; busy = false
                    if (Biometric.available(context)) offer = true else onDone()
                }
            }
        }
    }

    fun submitEnter(typed: String) {
        if (busy || locked || typed.length < PinLock.MIN_LEN) return
        busy = true
        error = null
        scope.launch {
            val ok = withContext(Dispatchers.Default) { PinLock.matches(typed, app.session.pinSalt, app.session.pinHash) }
            pin = ""
            if (ok) {
                app.session.resetPinFailures()
                if (app.session.pinLength == 0) app.session.rememberPinLength(typed.length) // a PIN from an older version: auto-open from now on
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
            error = if (wait > 0) "PIN notöğri. $wait soniya kuting."
            else "PIN notöğri. Qolgan uriniş: ${PinLock.WIPE_AFTER - fails}."
            busy = false
            focusPin()
        }
    }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp, vertical = 48.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Image(painterResource(R.drawable.ic_logo_ds), contentDescription = null, modifier = Modifier.size(56.dp))
        Spacer(Modifier.height(16.dp))

        if (offer) {
            Text("Barmoq izi bilan oçiş", style = MaterialTheme.typography.titleLarge)
            Spacer(Modifier.height(8.dp))
            Text(
                "Keyingi safar PIN terişning orniga barmoq izi (yoki yüz) bilan oçişingiz mumkin. PIN baribir saqlanadi: barmoq izi tanilmasa, PIN söraladi.",
                color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyLarge,
            )
            error?.let {
                Spacer(Modifier.height(12.dp))
                Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
            }
            Spacer(Modifier.height(24.dp))
            PrimaryButton("Yoqiş", {
                error = null
                signal?.cancel()
                signal = Biometric.prompt(context, "Barmoq izini tasdiqlang", "Şu telefonda röyxatdan ötgan barmoq izi", "Bekor qiliş") { ok ->
                    if (ok) { app.session.setBiometricEnabled(true); onDone() }
                    else error = "Tasdiqlanmadi. Qayta urinib köring yoki «Hozir emas»ni bosing."
                }
            })
            Spacer(Modifier.height(8.dp))
            SecondaryButton("Hozir emas", { onDone() })
            return@Column
        }

        Text(if (create) "PIN örnating" else "PIN kiriting", style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(8.dp))
        Text(
            if (create) "Telefon boşqa birovning qöliga tuşsa, ilovani PIN himoya qiladi. Signal PIN siz ham çalinaveradi."
            else if (autoOpen || app.session.pinLength > 0) "PIN ni terişingiz bilan ilova oçiladi."
            else "Ilova bir daqiqadan köp fonda turdi.",
            color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyLarge,
        )
        Spacer(Modifier.height(28.dp))
        OutlinedTextField(
            value = pin,
            onValueChange = { v ->
                if (v.length <= PinLock.MAX_LEN && v.all { it.isDigit() } && !busy) {
                    pin = v
                    // No confirm button: the app opens by itself when as many digits as the saved PIN were typed.
                    if (!create && PinLock.autoSubmit(v.length, app.session.pinLength)) submitEnter(v)
                }
            },
            label = { Text("PIN") }, singleLine = true, enabled = !locked,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword, imeAction = if (create) ImeAction.Next else ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { submitEnter(pin) }),
            modifier = Modifier.fillMaxWidth().focusRequester(focus),
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
        // Saving a new PIN is explicit. Entering one is not: the button only exists for a PIN whose length is not known yet.
        if (create || app.session.pinLength == 0) {
            Spacer(Modifier.height(24.dp))
            PrimaryButton(
                if (create) "Saqlaş" else "Oçiş", { if (create) submitCreate() else submitEnter(pin) },
                enabled = !locked && pin.length >= PinLock.MIN_LEN && (!create || again.length >= PinLock.MIN_LEN), loading = busy,
            )
        }
        if (!create) {
            Spacer(Modifier.height(12.dp))
            if (bioOn) {
                SecondaryButton("Barmoq izi bilan oçiş", { askBiometric() })
                Spacer(Modifier.height(4.dp))
            }
            TextButton(
                onClick = {
                    scope.launch {
                        app.repository.logout()
                        app.watcher.signOutLocally()
                    }
                },
                modifier = Modifier.fillMaxWidth(),
            ) { Text("PIN ni unutdim — Telegram kodi bilan qayta kiriş") }
        }
    }
}
