package com.dsdelivery.admin.ui

import com.dsdelivery.admin.ui.kit.EmptyState
import com.dsdelivery.admin.ui.kit.SecondaryButton
import com.dsdelivery.admin.ui.kit.ListPlaceholder
import android.graphics.BitmapFactory
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.dsdelivery.admin.AdminApp
import com.dsdelivery.admin.data.ApiResult
import com.dsdelivery.admin.data.PromoDto
import com.dsdelivery.admin.data.PromoOverviewDto
import com.dsdelivery.admin.data.RestaurantRefDto
import com.dsdelivery.admin.data.SlideDto
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * "Aksiya": the 1+1 offers (which dishes, on/off, cap per order) and the slides on the customers' home screen (news and offers: picture, order,
 * on/off). Replaces the /aksiya bot command. Anything that changes what customers pay asks first; the server audits every change.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun PromoPane(onMessage: (String) -> Unit) {
    val app = AdminApp.instance
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var data by remember { mutableStateOf<PromoOverviewDto?>(null) }
    var loading by remember { mutableStateOf(false) }
    var offline by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }

    var confirmToggle by remember { mutableStateOf<Pair<PromoDto, Boolean>?>(null) }
    var dishesFor by remember { mutableStateOf<PromoDto?>(null) }
    var capFor by remember { mutableStateOf<PromoDto?>(null) }
    var deletePromo by remember { mutableStateOf<PromoDto?>(null) }
    var newPromo by remember { mutableStateOf(false) }
    var newSlide by remember { mutableStateOf(false) }
    var deleteSlide by remember { mutableStateOf<SlideDto?>(null) }
    var photoFor by remember { mutableStateOf<String?>(null) }

    suspend fun load() {
        if (loading) return
        loading = true
        when (val r = app.repository.promo()) {
            is ApiResult.Ok -> { data = r.data; offline = false }
            is ApiResult.Unauthorized -> app.watcher.signOutLocally()
            else -> offline = true
        }
        loading = false
    }

    LaunchedEffect(Unit) {
        while (true) {
            load()
            delay(30_000)
        }
    }

    /** One server change: tells the administrator the result (or why not) and reloads the list. */
    fun run(done: String?, block: suspend () -> ApiResult<*>) {
        if (saving) return
        saving = true
        scope.launch {
            val r = block()
            if (r is ApiResult.Ok<*>) {
                if (done != null) onMessage(done)
            } else {
                unwrap(r, onMessage)
            }
            saving = false
            load()
        }
    }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        val id = photoFor
        photoFor = null
        if (uri == null || id == null || saving) return@rememberLauncherForActivityResult
        saving = true
        scope.launch {
            val jpeg = withContext(Dispatchers.IO) { ImagePrep.prepare(context, uri) }
            if (jpeg == null) {
                onMessage("Rasmni öqib bölmadi. Boşqa rasm tanlang.")
            } else if (unwrap(app.repository.setSlideImage(id, jpeg), onMessage) != null) {
                onMessage("Slayd rasmi saqlandi.")
            }
            saving = false
            load()
        }
    }

    fun move(list: List<SlideDto>, i: Int, delta: Int) {
        val j = i + delta
        if (j !in list.indices) return
        val order = list.toMutableList()
        val t = order[i]
        order[i] = order[j]
        order[j] = t
        run(null) {
            var last: ApiResult<*> = ApiResult.Ok(Unit)
            order.forEachIndexed { idx, s ->
                if (s.position != idx && last is ApiResult.Ok<*>) last = app.repository.setSlidePosition(s.id, idx)
            }
            last
        }
    }

    PullRefresh(onRefresh = { scope.launch { load() } }, modifier = Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (offline) item { Banner("Ulaniş yöq — röyxat eskirgan bölişi mumkin") }
            val d = data
            if (d == null) {
                item { ListPlaceholder(offline) { scope.launch { load() } } }
            } else {
                item { Text("Aksiyalar (1+1)", style = MaterialTheme.typography.titleLarge) }
                item {
                    Text(
                        "Har ikki donadan arzonroği bepul, puli restoran hisobidan. Aksiyali buyurtmada platforma xizmati olinmaydi (çizilib körsatiladi).",
                        style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (d.promotions.isEmpty()) item { EmptyState(title = "Aksiya yöq") }
                items(d.promotions.size) { i ->
                    val p = d.promotions[i]
                    val chosen = p.dishes.filter { it.id in p.productIds }
                    Card {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(p.title, style = MaterialTheme.typography.titleMedium)
                                Text(p.restaurantName, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            Switch(checked = p.isActive, enabled = !saving, onCheckedChange = { confirmToggle = p to it })
                        }
                        Text(
                            if (p.isActive) "Yoqilgan" else "Öçiq", fontWeight = FontWeight.SemiBold,
                            color = if (p.isActive) OkColor else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Text(
                            if (chosen.isEmpty()) "Taom tanlanmagan" else "Taomlar: " + chosen.joinToString(", ") { it.name },
                            style = MaterialTheme.typography.bodyMedium,
                        )
                        Text(
                            p.maxFreePerOrder?.let { "Bitta buyurtmada eng köpi bilan $it ta bepul" } ?: "Bitta buyurtmadagi bepul donalar çeklanmagan",
                            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            SecondaryButton("Taomlarni tanlaş", { dishesFor = p }, Modifier, enabled = !saving)
                            SecondaryButton("Limit", { capFor = p }, Modifier, enabled = !saving)
                            OutlinedButton(enabled = !saving, onClick = { deletePromo = p }) { Text("Öçiriş", color = UrgentColor) }
                        }
                    }
                }
                item { PrimaryButton("Yangi aksiya", enabled = !saving) { newPromo = true } }

                item { Text("Slaydlar (boş sahifa)", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 12.dp)) }
                item {
                    Text(
                        "Yangilik va çegirmalar qidiruv ustida aylanib turadi. Rasm 2:1 (masalan 1024×512) bölsa, töliq körinadi.",
                        style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (d.banners.isEmpty()) item { EmptyState(title = "Slayd yöq") }
                items(d.banners.size) { i ->
                    val s = d.banners[i]
                    Card {
                        SlidePreview(s)
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(s.title, style = MaterialTheme.typography.titleMedium)
                                Text(
                                    s.promotionTitle?.let { "Aksiya: $it" } ?: s.restaurantName?.let { "Restoran: $it" } ?: "Heç qayerga ötmaydi",
                                    style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            Switch(checked = s.isActive, enabled = !saving && s.hasImage, onCheckedChange = { on -> run(null) { app.repository.setSlideActive(s.id, on) } })
                        }
                        Text(
                            when {
                                !s.hasImage -> "Rasm yöq"
                                s.live -> "Mijozlarga körinmoqda"
                                s.isActive -> "Yoqilgan, lekin hozir körinmaydi (aksiyasi öçiq yoki taomi yöq)"
                                else -> "Öçiq"
                            },
                            fontWeight = FontWeight.SemiBold,
                            color = if (s.live) OkColor else MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium,
                        )
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            SecondaryButton("Rasm", { photoFor = s.id; picker.launch("image/*") }, Modifier, enabled = !saving)
                            SecondaryButton("⬆", { move(d.banners, i, -1) }, Modifier, enabled = !saving && i > 0)
                            SecondaryButton("", { move(d.banners, i, 1) }, Modifier, enabled = !saving && i < d.banners.size - 1)
                            OutlinedButton(enabled = !saving, onClick = { deleteSlide = s }) { Text("Öçiriş", color = UrgentColor) }
                        }
                    }
                }
                item { PrimaryButton("Yangi slayd", enabled = !saving) { newSlide = true } }
            }
        }
    }

    confirmToggle?.let { (p, on) ->
        AlertDialog(
            onDismissRequest = { if (!saving) confirmToggle = null },
            title = { Text(if (on) "${p.title}: yoqilsinmi?" else "${p.title}: öçirilsinmi?") },
            text = {
                Text(
                    if (on) "Mijozlar ${p.restaurantName} menyusida «Çegirmalar» toifasini köradi va har ikki donadan arzonroği bepul böladi (puli restoran hisobidan)."
                    else "«Çegirmalar» toifasi va aksiya slaydi yöqoladi, savatdagi bepul donalar narxga qaytadi.",
                )
            },
            confirmButton = {
                TextButton(enabled = !saving, onClick = {
                    confirmToggle = null
                    run(if (on) "${p.title} yoqildi." else "${p.title} öçirildi.") { app.repository.setPromotionActive(p.id, on) }
                }) { Text(if (on) "Ha, yoqiş" else "Ha, öçiriş") }
            },
            dismissButton = { TextButton(enabled = !saving, onClick = { confirmToggle = null }) { Text("Yöq") } },
        )
    }

    dishesFor?.let { p ->
        DishesDialog(
            promo = p, busy = saving, onDismiss = { dishesFor = null },
            onSave = { ids ->
                dishesFor = null
                run("${p.title}: ${ids.size} ta taom tanlandi.") { app.repository.setPromotionDishes(p.id, ids) }
            },
        )
    }

    capFor?.let { p ->
        CapDialog(
            promo = p, busy = saving, onDismiss = { capFor = null },
            onSave = { cap ->
                capFor = null
                run(if (cap == 0) "Limit olib taşlandi." else "Limit: $cap ta.") { app.repository.setPromotionCap(p.id, cap) }
            },
        )
    }

    deletePromo?.let { p ->
        AlertDialog(
            onDismissRequest = { if (!saving) deletePromo = null },
            title = { Text("${p.title}: öçirilsinmi?") },
            text = { Text("Aksiya butunlay öçadi, uning slaydi ham öçiriladi. Berilgan buyurtmalarga ta’sir qilmaydi.") },
            confirmButton = {
                TextButton(enabled = !saving, onClick = {
                    deletePromo = null
                    run("${p.title} öçirildi.") { app.repository.deletePromotion(p.id) }
                }) { Text("Ha, öçiriş", color = UrgentColor) }
            },
            dismissButton = { TextButton(enabled = !saving, onClick = { deletePromo = null }) { Text("Yöq") } },
        )
    }

    deleteSlide?.let { s ->
        AlertDialog(
            onDismissRequest = { if (!saving) deleteSlide = null },
            title = { Text("«${s.title}» slaydi öçirilsinmi?") },
            text = { Text("Slayd va uning rasmi öçadi.") },
            confirmButton = {
                TextButton(enabled = !saving, onClick = {
                    deleteSlide = null
                    run("Slayd öçirildi.") { app.repository.deleteSlide(s.id) }
                }) { Text("Ha, öçiriş", color = UrgentColor) }
            },
            dismissButton = { TextButton(enabled = !saving, onClick = { deleteSlide = null }) { Text("Yöq") } },
        )
    }

    if (newPromo) {
        NewPromoDialog(
            restaurants = data?.restaurants.orEmpty(), busy = saving, onDismiss = { newPromo = false },
            onCreate = { restaurantId, title ->
                newPromo = false
                run("Aksiya qöşildi (öçiq). Taomlarini tanlang.") { app.repository.createPromotion(restaurantId, title) }
            },
        )
    }

    if (newSlide) {
        NewSlideDialog(
            restaurants = data?.restaurants.orEmpty(), promos = data?.promotions.orEmpty(), busy = saving, onDismiss = { newSlide = false },
            onCreate = { title, restaurantId, promotionId ->
                newSlide = false
                saving = true
                scope.launch {
                    val res = unwrap(app.repository.createSlide(title, restaurantId, promotionId), onMessage)
                    saving = false
                    load()
                    if (res != null) {
                        onMessage("Slayd qöşildi (öçiq). Endi rasm tanlang.")
                        photoFor = res.id
                        picker.launch("image/*")
                    }
                }
            },
        )
    }
}

/** The slide's own picture (read from the server, so what the administrator sees is exactly what is stored). */
@Composable
private fun SlidePreview(slide: SlideDto) {
    val app = AdminApp.instance
    var bitmap by remember(slide.id, slide.imageVersion) { mutableStateOf<ImageBitmap?>(null) }
    LaunchedEffect(slide.id, slide.imageVersion) {
        bitmap = if (!slide.hasImage) null else withContext(Dispatchers.IO) {
            val bytes = app.repository.slideImage(slide.id)
            if (bytes == null) null else BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = 2 })?.asImageBitmap()
        }
    }
    val b = bitmap
    val shape = RoundedCornerShape(12.dp)
    if (b != null) {
        Image(bitmap = b, contentDescription = slide.title, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxWidth().aspectRatio(2f).clip(shape))
    } else {
        Box(Modifier.fillMaxWidth().aspectRatio(2f).clip(shape).background(MaterialTheme.colorScheme.surfaceVariant), contentAlignment = Alignment.Center) {
            Text(if (slide.hasImage) "Rasm yuklanmoqda…" else "Rasm yöq", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun DishesDialog(promo: PromoDto, busy: Boolean, onDismiss: () -> Unit, onSave: (List<String>) -> Unit) {
    var chosen by remember { mutableStateOf(promo.productIds.toSet()) }
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text("${promo.title}: taomlar") },
        text = {
            Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState())) {
                Text(
                    "1+1 faqat şu taomlarga amal qiladi. Ikki xil taom birga olinsa, arzonroği bepul böladi.",
                    style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                var lastCategory: String? = "\u0000"
                promo.dishes.forEach { dish ->
                    if (dish.category != lastCategory) {
                        lastCategory = dish.category
                        Text(dish.category ?: "Toifasiz", fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 10.dp))
                    }
                    val on = dish.id in chosen
                    val toggle = { chosen = if (on) chosen - dish.id else chosen + dish.id }
                    Row(Modifier.fillMaxWidth().clickable { toggle() }, verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(checked = on, onCheckedChange = { toggle() })
                        Column {
                            Text(dish.name)
                            Text(somText(dish.priceSom.toLong()), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(enabled = !busy && chosen.isNotEmpty(), onClick = { onSave(promo.dishes.map { it.id }.filter { it in chosen }) }) { Text("Saqlaş") } },
        dismissButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text("Bekor qiliş") } },
    )
}

@Composable
private fun CapDialog(promo: PromoDto, busy: Boolean, onDismiss: () -> Unit, onSave: (Int) -> Unit) {
    var text by remember { mutableStateOf(promo.maxFreePerOrder?.toString() ?: "") }
    val value = if (text.isBlank()) 0 else text.toIntOrNull()
    val ok = value != null && value in 0..100
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text("${promo.title}: limit") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Bitta buyurtmada eng köpi bilan neçta bepul dona berilsin? Böş yoki 0 = çeklovsiz.", style = MaterialTheme.typography.bodyMedium)
                OutlinedTextField(
                    value = text, onValueChange = { if (it.length <= 3 && it.all(Char::isDigit)) text = it }, label = { Text("Bepul donalar soni") },
                    singleLine = true, isError = !ok, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = { TextButton(enabled = !busy && ok, onClick = { onSave(value ?: 0) }) { Text("Saqlaş") } },
        dismissButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text("Bekor qiliş") } },
    )
}

@Composable
private fun NewPromoDialog(restaurants: List<RestaurantRefDto>, busy: Boolean, onDismiss: () -> Unit, onCreate: (restaurantId: String, title: String) -> Unit) {
    var title by remember { mutableStateOf("") }
    var restaurantId by remember { mutableStateOf<String?>(null) }
    val ready = title.trim().length >= 2 && restaurantId != null
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text("Yangi aksiya (1+1)") },
        text = {
            Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(value = title, onValueChange = { if (it.length <= 60) title = it }, label = { Text("Nomi (masalan: Lavaş)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Text("Qaysi restoranda?", fontWeight = FontWeight.SemiBold)
                restaurants.forEach { r ->
                    Row(Modifier.fillMaxWidth().clickable { restaurantId = r.id }, verticalAlignment = Alignment.CenterVertically) {
                        RadioButton(selected = restaurantId == r.id, onClick = { restaurantId = r.id })
                        Text(r.name)
                    }
                }
                Text("Aksiya öçiq holda qöşiladi: avval taomlarini tanlang, keyin yoqing.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        },
        confirmButton = { TextButton(enabled = !busy && ready, onClick = { onCreate(restaurantId!!, title) }) { Text("Qöşiş") } },
        dismissButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text("Bekor qiliş") } },
    )
}

@Composable
private fun NewSlideDialog(
    restaurants: List<RestaurantRefDto>, promos: List<PromoDto>, busy: Boolean, onDismiss: () -> Unit,
    onCreate: (title: String, restaurantId: String?, promotionId: String?) -> Unit,
) {
    var title by remember { mutableStateOf("") }
    // "none", "r:<restaurant id>" or "p:<promotion id>": where a tap on the slide goes.
    var target by remember { mutableStateOf("none") }
    val ready = title.trim().length >= 2
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text("Yangi slayd") },
        text = {
            Column(Modifier.heightIn(max = 440.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                OutlinedTextField(value = title, onValueChange = { if (it.length <= 60) title = it }, label = { Text("Sarlavha (mijozga körinmaydi)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Text("Bosilganda nima oçilsin?", fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 8.dp))
                Row(Modifier.fillMaxWidth().clickable { target = "none" }, verticalAlignment = Alignment.CenterVertically) {
                    RadioButton(selected = target == "none", onClick = { target = "none" })
                    Text("Heç narsa (faqat yangilik)")
                }
                promos.forEach { p ->
                    Row(Modifier.fillMaxWidth().clickable { target = "p:${p.id}" }, verticalAlignment = Alignment.CenterVertically) {
                        RadioButton(selected = target == "p:${p.id}", onClick = { target = "p:${p.id}" })
                        Text("Aksiya: ${p.title} (${p.restaurantName})")
                    }
                }
                restaurants.forEach { r ->
                    Row(Modifier.fillMaxWidth().clickable { target = "r:${r.id}" }, verticalAlignment = Alignment.CenterVertically) {
                        RadioButton(selected = target == "r:${r.id}", onClick = { target = "r:${r.id}" })
                        Text("Restoran: ${r.name}")
                    }
                }
                Text(
                    "Slayd öçiq holda qöşiladi. Rasm tanlagaç, uni yoqing.",
                    style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 8.dp),
                )
            }
        },
        confirmButton = {
            TextButton(enabled = !busy && ready, onClick = {
                onCreate(
                    title,
                    if (target.startsWith("r:")) target.removePrefix("r:") else null,
                    if (target.startsWith("p:")) target.removePrefix("p:") else null,
                )
            }) { Text("Rasm tanlaş") }
        },
        dismissButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text("Bekor qiliş") } },
    )
}
