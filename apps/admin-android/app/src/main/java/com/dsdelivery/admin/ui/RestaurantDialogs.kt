package com.dsdelivery.admin.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.dsdelivery.admin.data.CredentialResponse
import com.dsdelivery.admin.data.FinancePinResponse
import com.dsdelivery.admin.data.RemovalPlanDto

/** Add a restaurant: the same three fields the Telegram /newrestaurant asked for. The photo is added afterwards from the restaurant's card. */
@Composable
fun NewRestaurantDialog(busy: Boolean, onDismiss: () -> Unit, onCreate: (name: String, address: String, phone: String) -> Unit) {
    var name by remember { mutableStateOf("") }
    var address by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }
    val phoneOk = phone.isBlank() || Regex("^\\+?\\d{9,15}$").matches(phone.trim())
    val ready = name.trim().length >= 2 && address.trim().length >= 3 && phoneOk
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text("Yangi restoran") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(value = name, onValueChange = { if (it.length <= 80) name = it }, label = { Text("Nomi") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(value = address, onValueChange = { if (it.length <= 200) address = it }, label = { Text("Olib ketiş manzili (taksi şu yerga keladi)") }, minLines = 2, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(
                    value = phone, onValueChange = { if (it.length <= 16) phone = it }, label = { Text("Telefon (ixtiyoriy)") }, singleLine = true, isError = !phoneOk,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone), modifier = Modifier.fillMaxWidth(),
                )
                Text(
                    "Restoran «pauza»da boşlanadi: xodimlari kirib, menyu va karta qöşgaç özlari «Buyurtma qabul qiliş»ni yoqadi. Kiriş paroli keyingi oynada BIR MARTA körsatiladi.",
                    style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        },
        confirmButton = { TextButton(enabled = !busy && ready, onClick = { onCreate(name, address, phone) }) { Text("Qöşiş") } },
        dismissButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text("Bekor qiliş") } },
    )
}

/**
 * The generated login, shown once. It cannot be dismissed by tapping outside: the only way out is "Yozib oldim", so a stray tap never
 * loses a password that exists nowhere else.
 */
@Composable
fun SecretDialog(credential: CredentialResponse, onDone: () -> Unit) {
    val clipboard = LocalClipboardManager.current
    var copied by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = {},
        title = { Text(credential.name) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Login:", style = MaterialTheme.typography.bodyMedium)
                Text(credential.slug, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
                Text("Parol:", style = MaterialTheme.typography.bodyMedium)
                Text(credential.password, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
                OutlinedButton(onClick = {
                    clipboard.setText(AnnotatedString("Login: ${credential.slug}\nParol: ${credential.password}"))
                    copied = true
                }) { Text(if (copied) "✓ Nusxalandi" else "Nusxalaş") }
                Text(
                    "Parol faqat şu yerda va faqat hozir körinadi: tizim uni saqlamaydi. Restoranga xavfsiz yöl bilan yuboring (masalan, şaxsiy Telegram). Yuborgaç, boşqa narsani nusxalab qöying.",
                    style = MaterialTheme.typography.bodyMedium, color = WarnColor,
                )
            }
        },
        confirmButton = { TextButton(onClick = onDone) { Text("Yozib oldim") } },
    )
}

/** Asks before issuing: a new code replaces the old one at once and closes the restaurant's open Moliya screens. */
@Composable
fun IssueFinancePinDialog(name: String, hasPin: Boolean, busy: Boolean, onDismiss: () -> Unit, onConfirm: () -> Unit) {
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text(if (hasPin) "$name: yangi moliya kodi berilsinmi?" else "$name: moliya kodi berilsinmi?") },
        text = {
            Text(
                (if (hasPin) "Eski kod işlamaydi va oçiq turgan Moliya sahifalari yopiladi. " else "") +
                    "4 xonali kod keyingi oynada bir marta körsatiladi. Uni faqat restoran egasiga özingiz ayting; kassirlarga bermang."
            )
        },
        confirmButton = { TextButton(enabled = !busy, onClick = onConfirm) { Text("Ha, kod beriş") } },
        dismissButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text("Yöq") } },
    )
}

/** The generated Moliya code, shown once. Like [SecretDialog] it cannot be dismissed by a stray tap. */
@Composable
fun FinancePinDialog(result: FinancePinResponse, onDone: () -> Unit) {
    val clipboard = LocalClipboardManager.current
    var copied by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = {},
        title = { Text(result.name) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Moliya kodi:", style = MaterialTheme.typography.bodyMedium)
                Text(result.pin, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.displaySmall)
                OutlinedButton(onClick = {
                    clipboard.setText(AnnotatedString(result.pin))
                    copied = true
                }) { Text(if (copied) "✓ Nusxalandi" else "Nusxalaş") }
                Text(
                    "Kod faqat şu yerda va faqat hozir körinadi: tizim uni saqlamaydi. Restoran egasiga özingiz ayting; kassirlarga bermang. Yozib olgaç, boşqa narsani nusxalab qöying.",
                    style = MaterialTheme.typography.bodyMedium, color = WarnColor,
                )
            }
        },
        confirmButton = { TextButton(onClick = onDone) { Text("Yozib oldim") } },
    )
}

@Composable
fun ResetPasswordDialog(name: String, busy: Boolean, onDismiss: () -> Unit, onConfirm: () -> Unit, owner: String = "restoranning") {
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text("$name: yangi parol berilsinmi?") },
        text = { Text("Eski parol işlamaydi va $owner barça qurilmalari ilovadan çiqarib yuboriladi. Yangi parol keyingi oynada bir marta körsatiladi.") },
        confirmButton = { TextButton(enabled = !busy, onClick = onConfirm) { Text("Ha, yangi parol") } },
        dismissButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text("Yöq") } },
    )
}

/** Telegram alerts ("yangi to‘langan buyurtma") for this restaurant go to this account. One Telegram account serves one restaurant. */
@Composable
fun LinkStaffDialog(name: String, busy: Boolean, onDismiss: () -> Unit, onLink: (telegramId: String) -> Unit) {
    var id by remember { mutableStateOf("") }
    val ok = Regex("^\\d{5,20}$").matches(id.trim())
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text("$name: Telegram xodimi") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = id, onValueChange = { if (it.length <= 20) id = it }, label = { Text("Telegram ID (raqamlar)") }, singleLine = true, isError = id.isNotEmpty() && !ok,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.fillMaxWidth(),
                )
                Text(
                    "Xodim botga /start yozgan bölişi kerak, aks holda xabar bora olmaydi. Telegram ID ni u @userinfobot orqali bilib oladi.",
                    style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        },
        confirmButton = { TextButton(enabled = !busy && ok, onClick = { onLink(id.trim()) }) { Text("Ulaş") } },
        dismissButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text("Bekor qiliş") } },
    )
}

/** Step two of removal: shows what the server says WOULD happen; the confirm button echoes it back, so a changed situation does nothing. */
@Composable
fun RemovalDialog(name: String, plan: RemovalPlanDto, busy: Boolean, onDismiss: () -> Unit, onConfirm: (expected: String) -> Unit, taxi: Boolean = false) {
    val blocked = plan.result == "BLOCKED"
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text(if (plan.result == "DELETE") "$name: butunlay öçirilsinmi?" else if (blocked) "$name: hozir olib bölmaydi" else "$name: arxivlansinmi?") },
        text = {
            Text(
                when (plan.result) {
                    "DELETE" ->
                        if (taxi) "Bu kompaniyada heç qanday taksi buyurtmasi yöq. Kompaniya va kiriş logini butunlay öçadi. Qaytarib bölmaydi."
                        else "Bu restoranda heç qanday buyurtma, tölov yoki komissiya yöq. Restoran, menyusi va kartalari butunlay öçadi. Qaytarib bölmaydi."
                    "ARCHIVE" ->
                        if (taxi) "Tarixi bor (${plan.orders ?: 0} ta yozuv). Yozuvlar öçmaydi: kompaniya öçiriladi, kirişi yopiladi, nomi böşatiladi."
                        else "Tarixi bor (${plan.orders ?: 0} ta buyurtma" + (if ((plan.dueSom ?: 0) > 0) ", tölanmagan komissiya ${somText(plan.dueSom ?: 0)}" else "") +
                            "). Pul va yetkazib beriş yozuvlari öçmaydi: restoran öçiriladi, mijozlarga körinmaydi, kirişi yopiladi, kartalari öçiriladi, nomi böşatiladi."
                    else -> when (plan.reason) {
                        "OPEN_ORDERS" -> "Tugallanmagan ${plan.count ?: ""} ta buyurtma bor. Avval ularni yakunlang yoki bekor qiling."
                        "OPEN_DISPATCHES" -> "Tugallanmagan ${plan.count ?: ""} ta taksi buyurtmasi bor. Avval ularni yakunlang."
                        "OPEN_REFUNDS" -> "Hal qilinmagan ${plan.count ?: ""} ta qaytariş sörovi bor."
                        else -> "Tugallanmagan iş bor."
                    }
                },
            )
        },
        confirmButton = {
            if (!blocked) TextButton(enabled = !busy, onClick = { onConfirm(plan.result) }) {
                Text(if (plan.result == "DELETE") "Ha, öçiriş" else "Ha, arxivlaş", color = UrgentColor)
            }
        },
        dismissButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text(if (blocked) "Yopiş" else "Yöq") } },
    )
}
