package com.dsdelivery.restaurant.ui.screens.products.form

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import coil.request.ImageRequest
import com.dsdelivery.restaurant.ui.components.LoadingView
import com.dsdelivery.restaurant.ui.preview.SampleData
import com.dsdelivery.restaurant.ui.theme.BrandDark
import com.dsdelivery.restaurant.ui.theme.BrandMint
import com.dsdelivery.restaurant.ui.theme.BrandPrimary
import com.dsdelivery.restaurant.ui.theme.DSRestaurantTheme
import com.dsdelivery.restaurant.ui.theme.ErrorRed
import com.dsdelivery.restaurant.ui.theme.WarningOrange
import java.text.NumberFormat
import java.util.Locale

@Composable
fun ProductFormScreen(
    viewModel: ProductFormViewModel,
    onNavigateBack: () -> Unit,
    modifier: Modifier = Modifier
) {
    val state by viewModel.uiState.collectAsState()

    ProductFormContent(
        state = state,
        onNavigateBack = onNavigateBack,
        onNameChange = viewModel::onNameChange,
        onPriceChange = viewModel::onPriceChange,
        onDescriptionChange = viewModel::onDescriptionChange,
        onCategoryChange = viewModel::onCategoryChange,
        onAvailabilityChange = viewModel::onAvailabilityChange,
        onSaveProduct = { viewModel.saveProduct(onSuccess = onNavigateBack) },
        onReload = viewModel::loadInitialData,
        onDismissError = viewModel::dismissError,
        modifier = modifier
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProductFormContent(
    state: ProductFormUiState,
    onNavigateBack: () -> Unit,
    onNameChange: (String) -> Unit,
    onPriceChange: (String) -> Unit,
    onDescriptionChange: (String) -> Unit,
    onCategoryChange: (String?) -> Unit,
    onAvailabilityChange: (Boolean) -> Unit,
    onSaveProduct: () -> Unit,
    onReload: () -> Unit,
    onDismissError: () -> Unit,
    modifier: Modifier = Modifier
) {
    val scrollState = rememberScrollState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = if (state.isEditMode) "Mahsulotni Tahrirlash" else "Yangi Mahsulot Qo‘shish",
                        style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold)
                    )
                },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "Ortga",
                            tint = Color.White
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = BrandPrimary,
                    titleContentColor = Color.White,
                    navigationIconContentColor = Color.White
                )
            )
        },
        modifier = modifier
    ) { innerPadding ->
        if (state.isLoadingProduct) {
            LoadingView(
                message = "Mahsulot ma'lumotlari yuklanmoqda...",
                modifier = Modifier
                    .fillMaxSize()
                    .padding(innerPadding)
            )
            return@Scaffold
        }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .background(MaterialTheme.colorScheme.background)
                .verticalScroll(scrollState)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Error Banner (if any)
            if (state.errorMessage != null && !state.isVersionConflict) {
                Surface(
                    color = ErrorRed.copy(alpha = 0.1f),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        modifier = Modifier.padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            imageVector = Icons.Default.Warning,
                            contentDescription = null,
                            tint = ErrorRed,
                            modifier = Modifier.size(20.dp)
                        )
                        Spacer(modifier = Modifier.width(10.dp))
                        Text(
                            text = state.errorMessage,
                            style = MaterialTheme.typography.bodySmall,
                            color = ErrorRed,
                            modifier = Modifier.weight(1f)
                        )
                        IconButton(
                            onClick = onDismissError,
                            modifier = Modifier.size(24.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Close,
                                contentDescription = "Yopish",
                                tint = ErrorRed,
                                modifier = Modifier.size(16.dp)
                            )
                        }
                    }
                }
            }

            // Product Name Field
            OutlinedTextField(
                value = state.name,
                onValueChange = onNameChange,
                label = { Text("Mahsulot nomi *") },
                placeholder = { Text("Masalan: Klassik Burger") },
                singleLine = true,
                isError = state.nameError != null,
                supportingText = {
                    if (state.nameError != null) {
                        Text(state.nameError, color = MaterialTheme.colorScheme.error)
                    } else {
                        Text("${state.name.length}/100 belgi")
                    }
                },
                modifier = Modifier.fillMaxWidth()
            )

            // Price Field
            val formattedPricePreview = state.priceInput.toIntOrNull()?.let {
                val fmt = NumberFormat.getNumberInstance(Locale("uz", "UZ"))
                "${fmt.format(it)} so‘m"
            }

            OutlinedTextField(
                value = state.priceInput,
                onValueChange = onPriceChange,
                label = { Text("Narxi (so‘mda) *") },
                placeholder = { Text("Masalan: 25000") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                trailingIcon = { Text("so‘m", modifier = Modifier.padding(end = 12.dp), color = MaterialTheme.colorScheme.onSurfaceVariant) },
                isError = state.priceError != null,
                supportingText = {
                    Column {
                        if (state.priceError != null) {
                            Text(state.priceError, color = MaterialTheme.colorScheme.error)
                        } else if (formattedPricePreview != null) {
                            Text("Ko‘rinishi: $formattedPricePreview", color = BrandPrimary, fontWeight = FontWeight.Medium)
                        }
                        // Server rule (Stage 6F): an existing product's price can only be changed while the restaurant is paused.
                        Text("Mavjud mahsulot narxini o‘zgartirish uchun avval Sozlamalarda restoranni pauzaga qo‘ying.")
                    }
                },
                modifier = Modifier.fillMaxWidth()
            )

            // Category Selection Row
            if (state.categories.isNotEmpty()) {
                Column {
                    Text(
                        text = "Toifa tanlang:",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                    Spacer(modifier = Modifier.height(6.dp))

                    val catScrollState = rememberScrollState()
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(catScrollState),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        state.categories.forEach { cat ->
                            FilterChip(
                                selected = state.categoryId == cat.id,
                                onClick = { onCategoryChange(cat.id) },
                                label = { Text(cat.name) },
                                colors = FilterChipDefaults.filterChipColors(
                                    selectedContainerColor = BrandPrimary,
                                    selectedLabelColor = Color.White
                                )
                            )
                        }
                    }
                }
            }

            // Availability Toggle Card
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.surface
                ),
                elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(14.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = "Sotuvda mavjudligi",
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.SemiBold,
                            color = MaterialTheme.colorScheme.onSurface
                        )
                        Spacer(modifier = Modifier.height(2.dp))
                        Text(
                            text = if (state.isAvailable) "Mijozlar ushbu mahsulotga buyurtma bera oladi" else "Mahsulot menyuda vaqtincha to‘xtatilgan ko‘rinadi",
                            style = MaterialTheme.typography.bodySmall,
                            color = if (state.isAvailable) BrandPrimary else WarningOrange
                        )
                    }

                    Switch(
                        checked = state.isAvailable,
                        onCheckedChange = onAvailabilityChange,
                        colors = SwitchDefaults.colors(
                            checkedThumbColor = Color.White,
                            checkedTrackColor = BrandPrimary,
                            uncheckedThumbColor = Color.White,
                            uncheckedTrackColor = WarningOrange.copy(alpha = 0.5f)
                        )
                    )
                }
            }

            // Description Field
            OutlinedTextField(
                value = state.description,
                onValueChange = onDescriptionChange,
                label = { Text("Tavsif (ixtiyoriy)") },
                placeholder = { Text("Tarkibi, vazni yoki tayyorlanish usuli haqida qisqacha ma'lumot...") },
                minLines = 3,
                maxLines = 5,
                supportingText = {
                    Text("${state.description.length}/1000 belgi")
                },
                modifier = Modifier.fillMaxWidth()
            )

            // Image Preview Card & Read-Only Notice (Stage 5B Contract)
            Column(modifier = Modifier.fillMaxWidth()) {
                Text(
                    text = "Mahsulot fotosi",
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurface
                )
                Spacer(modifier = Modifier.height(8.dp))

                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(180.dp),
                    shape = RoundedCornerShape(12.dp),
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.surfaceVariant
                    ),
                    elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
                ) {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        if (!state.imageUrl.isNullOrBlank()) {
                            AsyncImage(
                                model = ImageRequest.Builder(LocalContext.current)
                                    .data(state.imageUrl)
                                    .crossfade(true)
                                    .build(),
                                contentDescription = "Mahsulot fotosi",
                                contentScale = ContentScale.Crop,
                                modifier = Modifier
                                    .fillMaxSize()
                                    .clip(RoundedCornerShape(12.dp))
                            )
                        } else {
                            Column(
                                horizontalAlignment = Alignment.CenterHorizontally,
                                verticalArrangement = Arrangement.Center
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Image,
                                    contentDescription = null,
                                    tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f),
                                    modifier = Modifier.size(48.dp)
                                )
                                Spacer(modifier = Modifier.height(8.dp))
                                Text(
                                    text = "Rasm mavjud emas",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        }
                    }
                }

                Spacer(modifier = Modifier.height(6.dp))

                Surface(
                    color = BrandMint.copy(alpha = 0.35f),
                    shape = RoundedCornerShape(8.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        modifier = Modifier.padding(10.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            imageVector = Icons.Default.Info,
                            contentDescription = null,
                            tint = BrandPrimary,
                            modifier = Modifier.size(16.dp)
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = "Backend Stage 5B arxitekturasida rasm yuklash API kiritilmagan. Mahsulot fotosi serverda saqlangan bo‘lsa o‘qish rejimida ko‘rsatiladi.",
                            style = MaterialTheme.typography.bodySmall,
                            fontSize = 11.sp,
                            color = BrandDark
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(8.dp))

            // Action Buttons
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                // Cancel Button
                OutlinedButton(
                    onClick = onNavigateBack,
                    enabled = !state.isSubmitting,
                    modifier = Modifier
                        .weight(1f)
                        .height(48.dp),
                    shape = RoundedCornerShape(10.dp)
                ) {
                    Text("Bekor qilish", fontSize = 13.sp)
                }

                // Primary Save / Update Button
                Button(
                    onClick = onSaveProduct,
                    enabled = state.isFormValid && !state.isSubmitting,
                    modifier = Modifier
                        .weight(1.4f)
                        .height(48.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = BrandPrimary),
                    shape = RoundedCornerShape(10.dp)
                ) {
                    if (state.isSubmitting) {
                        CircularProgressIndicator(
                            color = Color.White,
                            modifier = Modifier.size(20.dp),
                            strokeWidth = 2.dp
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Saqlanmoqda...", fontSize = 13.sp)
                    } else {
                        Icon(imageVector = Icons.Default.Check, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(
                            text = if (state.isEditMode) "O‘zgarishni saqlash" else "Mahsulot yaratish",
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(16.dp))
        }

        // Version Conflict Dialog (HTTP 409 VERSION_CONFLICT)
        if (state.isVersionConflict) {
            AlertDialog(
                onDismissRequest = onDismissError,
                icon = {
                    Icon(
                        imageVector = Icons.Default.Warning,
                        contentDescription = null,
                        tint = WarningOrange,
                        modifier = Modifier.size(36.dp)
                    )
                },
                title = {
                    Text(
                        text = "Versiya to‘qnashuvi (Conflict)",
                        style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold)
                    )
                },
                text = {
                    Text(
                        text = "Ushbu mahsulot boshqa sessiyada o‘zgartirilgan (versiya mos kelmadi). O‘zgarishlaringiz ustiga yozilib ketmasligi uchun so‘nggi ma'lumotlarni serverdan qayta yuklang.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                },
                confirmButton = {
                    Button(
                        onClick = onReload,
                        colors = ButtonDefaults.buttonColors(containerColor = BrandPrimary)
                    ) {
                        Icon(imageVector = Icons.Default.Refresh, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Qayta yuklash")
                    }
                },
                dismissButton = {
                    TextButton(onClick = onDismissError) {
                        Text("Yopish")
                    }
                },
                shape = RoundedCornerShape(16.dp)
            )
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun ProductFormScreenPreview() {
    DSRestaurantTheme {
        ProductFormContent(
            state = ProductFormUiState(
                slug = "demo-restoran",
                name = "Klassik Burger",
                priceInput = "25000",
                description = "Suvli mol go‘shti, yangi sous",
                isAvailable = true,
                categories = SampleData.sampleCategories
            ),
            onNavigateBack = {},
            onNameChange = {},
            onPriceChange = {},
            onDescriptionChange = {},
            onCategoryChange = {},
            onAvailabilityChange = {},
            onSaveProduct = {},
            onReload = {},
            onDismissError = {}
        )
    }
}
