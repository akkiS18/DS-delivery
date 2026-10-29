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
                OutlinedTextField(value = address, onValueChange = { if (it.length <= 200) address = it }, label = { Text("Olib ketish manzili (taksi shu yerga keladi)") }, minLines = 2, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(
                    value = phone, onValueChange = { if (it.length <= 16) phone = it }, label = { Text("Telefon (ixtiyoriy)") }, singleLine = true, isError = !phoneOk,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone), modifier = Modifier.fillMaxWidth(),
                )
                Text(
                    "Restoran «pauza»da boshlanadi: xodimlari kirib, menyu va karta qo‘shgach o‘zlari «Buyurtma qabul qilish»ni yoqadi. Kirish paroli keyingi oynada BIR MARTA ko‘rsatiladi.",
                    style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        },
        confirmButton = { TextButton(enabled = !busy && ready, onClick = { onCreate(name, address, phone) }) { Text("Qo‘shish") } },
        dismissButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text("Bekor qilish") } },
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
                }) { Text(if (copied) "✓ Nusxalandi" else "Nusxalash") }
                Text(
                    "Parol faqat shu yerda va faqat hozir ko‘rinadi: tizim uni saqlamaydi. Restoranga xavfsiz yo‘l bilan yuboring (masalan, shaxsiy Telegram). Yuborgach, boshqa narsani nusxalab qo‘ying.",
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
        text = { Text("Eski parol ishlamaydi va $owner barcha qurilmalari ilovadan chiqarib yuboriladi. Yangi parol keyingi oynada bir marta ko‘rsatiladi.") },
        confirmButton = { TextButton(enabled = !busy, onClick = onConfirm) { Text("Ha, yangi parol") } },
        dismissButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text("Yo‘q") } },
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
                    "Xodim botga /start yozgan bo‘lishi kerak, aks holda xabar bora olmaydi. Telegram ID ni u @userinfobot orqali bilib oladi.",
                    style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        },
        confirmButton = { TextButton(enabled = !busy && ok, onClick = { onLink(id.trim()) }) { Text("Ulash") } },
        dismissButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text("Bekor qilish") } },
    )
}

/** Step two of removal: shows what the server says WOULD happen; the confirm button echoes it back, so a changed situation does nothing. */
@Composable
fun RemovalDialog(name: String, plan: RemovalPlanDto, busy: Boolean, onDismiss: () -> Unit, onConfirm: (expected: String) -> Unit, taxi: Boolean = false) {
    val blocked = plan.result == "BLOCKED"
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text(if (plan.result == "DELETE") "$name: butunlay o‘chirilsinmi?" else if (blocked) "$name: hozir olib bo‘lmaydi" else "$name: arxivlansinmi?") },
        text = {
            Text(
                when (plan.result) {
                    "DELETE" ->
                        if (taxi) "Bu kompaniyada hech qanday taksi buyurtmasi yo‘q. Kompaniya va kirish logini butunlay o‘chadi. Qaytarib bo‘lmaydi."
                        else "Bu restoranda hech qanday buyurtma, to‘lov yoki komissiya yo‘q. Restoran, menyusi va kartalari butunlay o‘chadi. Qaytarib bo‘lmaydi."
                    "ARCHIVE" ->
                        if (taxi) "Tarixi bor (${plan.orders ?: 0} ta yozuv). Yozuvlar o‘chmaydi: kompaniya o‘chiriladi, kirishi yopiladi, nomi bo‘shatiladi."
                        else "Tarixi bor (${plan.orders ?: 0} ta buyurtma" + (if ((plan.dueSom ?: 0) > 0) ", to‘lanmagan komissiya ${somText(plan.dueSom ?: 0)}" else "") +
                            "). Pul va yetkazib berish yozuvlari o‘chmaydi: restoran o‘chiriladi, mijozlarga ko‘rinmaydi, kirishi yopiladi, kartalari o‘chiriladi, nomi bo‘shatiladi."
                    else -> when (plan.reason) {
                        "OPEN_ORDERS" -> "Tugallanmagan ${plan.count ?: ""} ta buyurtma bor. Avval ularni yakunlang yoki bekor qiling."
                        "OPEN_DISPATCHES" -> "Tugallanmagan ${plan.count ?: ""} ta taksi buyurtmasi bor. Avval ularni yakunlang."
                        "OPEN_REFUNDS" -> "Hal qilinmagan ${plan.count ?: ""} ta qaytarish so‘rovi bor."
                        else -> "Tugallanmagan ish bor."
                    }
                },
            )
        },
        confirmButton = {
            if (!blocked) TextButton(enabled = !busy, onClick = { onConfirm(plan.result) }) {
                Text(if (plan.result == "DELETE") "Ha, o‘chirish" else "Ha, arxivlash", color = UrgentColor)
            }
        },
        dismissButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text(if (blocked) "Yopish" else "Yo‘q") } },
    )
}
