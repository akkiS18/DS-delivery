package com.dsdelivery.restaurant.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Category
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Divider
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.dsdelivery.restaurant.data.model.Category
import com.dsdelivery.restaurant.ui.theme.BrandDark
import com.dsdelivery.restaurant.ui.theme.BrandPrimary
import com.dsdelivery.restaurant.ui.theme.ErrorRed

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CategoryManagementDialog(
    categories: List<Category>,
    onDismiss: () -> Unit,
    onAddCategory: (name: String, position: Int?) -> Unit,
    onEditCategory: (id: String, name: String, position: Int, version: Int) -> Unit,
    onDeleteCategory: (id: String, reassignTo: String?) -> Unit,
    isLoading: Boolean = false,
    errorMessage: String? = null
) {
    var newCategoryName by remember { mutableStateOf("") }
    var editingCategory by remember { mutableStateOf<Category?>(null) }
    var editName by remember { mutableStateOf("") }
    var editPosition by remember { mutableStateOf(0) }

    // Deletion reassignment state
    var categoryToDelete by remember { mutableStateOf<Category?>(null) }
    var reassignMode by remember { mutableStateOf("none") } // "none" or "targetCategory"
    var targetCategoryId by remember { mutableStateOf<String?>(null) }
    var targetDropdownExpanded by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = onDismiss,
        icon = {
            Icon(
                imageVector = Icons.Default.Category,
                contentDescription = null,
                tint = BrandPrimary,
                modifier = Modifier.size(32.dp)
            )
        },
        title = {
            Text(
                text = "Toifalarni Boshqarish",
                style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold)
            )
        },
        text = {
            Column(modifier = Modifier.fillMaxWidth()) {
                if (errorMessage != null) {
                    Text(
                        text = errorMessage,
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.padding(bottom = 8.dp)
                    )
                }

                // Existing Categories List
                Text(
                    text = "Mavjud toifalar (${categories.size}):",
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.SemiBold
                )

                Spacer(modifier = Modifier.height(6.dp))

                LazyColumn(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(180.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    if (categories.isEmpty()) {
                        item {
                            Text(
                                text = "Hozircha toifalar mavjud emas.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(8.dp)
                            )
                        }
                    } else {
                        items(categories, key = { it.id }) { cat ->
                            Card(
                                modifier = Modifier.fillMaxWidth(),
                                shape = RoundedCornerShape(8.dp),
                                colors = CardDefaults.cardColors(
                                    containerColor = MaterialTheme.colorScheme.surfaceVariant
                                )
                            ) {
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(horizontal = 10.dp, vertical = 6.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.SpaceBetween
                                ) {
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(
                                            text = cat.name,
                                            style = MaterialTheme.typography.bodyMedium,
                                            fontWeight = FontWeight.Medium
                                        )
                                        Text(
                                            text = "Tartib: ${cat.position} • Mahsulotlar: ${cat.productCount} ta (v${cat.version})",
                                            style = MaterialTheme.typography.bodySmall,
                                            fontSize = 11.sp,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant
                                        )
                                    }

                                    Row {
                                        IconButton(
                                            onClick = {
                                                editingCategory = cat
                                                editName = cat.name
                                                editPosition = cat.position
                                            },
                                            modifier = Modifier.size(32.dp)
                                        ) {
                                            Icon(
                                                imageVector = Icons.Default.Edit,
                                                contentDescription = "Tahrirlash",
                                                tint = BrandPrimary,
                                                modifier = Modifier.size(16.dp)
                                            )
                                        }

                                        IconButton(
                                            onClick = {
                                                categoryToDelete = cat
                                                val otherCats = categories.filter { it.id != cat.id }
                                                targetCategoryId = otherCats.firstOrNull()?.id
                                                reassignMode = if (cat.productCount > 0 && otherCats.isNotEmpty()) "targetCategory" else "none"
                                            },
                                            modifier = Modifier.size(32.dp)
                                        ) {
                                            Icon(
                                                imageVector = Icons.Default.Delete,
                                                contentDescription = "O‘chirish",
                                                tint = ErrorRed,
                                                modifier = Modifier.size(16.dp)
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                Spacer(modifier = Modifier.height(10.dp))
                Divider()
                Spacer(modifier = Modifier.height(10.dp))

                // If editing a category
                if (editingCategory != null) {
                    Text(
                        text = "Toifani tahrirlash (v${editingCategory!!.version}):",
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.SemiBold
                    )
                    Spacer(modifier = Modifier.height(6.dp))
                    OutlinedTextField(
                        value = editName,
                        onValueChange = { editName = it },
                        label = { Text("Toifa nomi (1-60 belgi)") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    Spacer(modifier = Modifier.height(6.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.End
                    ) {
                        TextButton(onClick = { editingCategory = null }) {
                            Text("Bekor qilish")
                        }
                        Spacer(modifier = Modifier.width(6.dp))
                        Button(
                            onClick = {
                                if (editName.isNotBlank()) {
                                    onEditCategory(
                                        editingCategory!!.id,
                                        editName.trim(),
                                        editPosition,
                                        editingCategory!!.version
                                    )
                                    editingCategory = null
                                }
                            },
                            colors = ButtonDefaults.buttonColors(containerColor = BrandPrimary)
                        ) {
                            Text("Saqlash")
                        }
                    }
                } else {
                    // Add new category
                    Text(
                        text = "Yangi toifa qo‘shish:",
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.SemiBold
                    )

                    Spacer(modifier = Modifier.height(6.dp))

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        OutlinedTextField(
                            value = newCategoryName,
                            onValueChange = { newCategoryName = it },
                            label = { Text("Toifa nomi") },
                            placeholder = { Text("Masalan: Ichimliklar") },
                            singleLine = true,
                            modifier = Modifier.weight(1f)
                        )

                        Button(
                            onClick = {
                                if (newCategoryName.isNotBlank()) {
                                    onAddCategory(newCategoryName.trim(), null)
                                    newCategoryName = ""
                                }
                            },
                            enabled = newCategoryName.isNotBlank() && !isLoading,
                            colors = ButtonDefaults.buttonColors(containerColor = BrandPrimary)
                        ) {
                            if (isLoading) {
                                CircularProgressIndicator(color = androidx.compose.ui.graphics.Color.White, modifier = Modifier.size(16.dp))
                            } else {
                                Icon(imageVector = Icons.Default.Add, contentDescription = null)
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            Button(
                onClick = onDismiss,
                colors = ButtonDefaults.buttonColors(containerColor = BrandPrimary)
            ) {
                Text("Yopish")
            }
        },
        shape = RoundedCornerShape(16.dp)
    )

    // Category Deletion & Reassignment Confirmation Dialog
    if (categoryToDelete != null) {
        val cat = categoryToDelete!!
        val otherCategories = categories.filter { it.id != cat.id }

        AlertDialog(
            onDismissRequest = { categoryToDelete = null },
            icon = {
                Icon(
                    imageVector = Icons.Default.Warning,
                    contentDescription = null,
                    tint = ErrorRed,
                    modifier = Modifier.size(32.dp)
                )
            },
            title = {
                Text(
                    text = "\"${cat.name}\" toifasini o‘chirish",
                    fontWeight = FontWeight.Bold
                )
            },
            text = {
                Column(modifier = Modifier.fillMaxWidth()) {
                    if (cat.productCount > 0) {
                        Text(
                            text = "Diqqat: Ushbu toifada ${cat.productCount} ta faol mahsulot mavjud. Toifani o‘chirish uchun mahsulotlarni nima qilishni tanlang:",
                            style = MaterialTheme.typography.bodySmall,
                            color = BrandDark
                        )

                        Spacer(modifier = Modifier.height(10.dp))

                        // Option 1: Reassign to another category
                        if (otherCategories.isNotEmpty()) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable { reassignMode = "targetCategory" }
                            ) {
                                RadioButton(
                                    selected = reassignMode == "targetCategory",
                                    onClick = { reassignMode = "targetCategory" },
                                    colors = RadioButtonDefaults.colors(selectedColor = BrandPrimary)
                                )
                                Text("Boshqa toifaga ko‘chirish:", style = MaterialTheme.typography.bodySmall)
                            }

                            if (reassignMode == "targetCategory") {
                                ExposedDropdownMenuBox(
                                    expanded = targetDropdownExpanded,
                                    onExpandedChange = { targetDropdownExpanded = it },
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(start = 32.dp, bottom = 8.dp)
                                ) {
                                    val selectedCat = otherCategories.find { it.id == targetCategoryId } ?: otherCategories.first()
                                    OutlinedTextField(
                                        value = selectedCat.name,
                                        onValueChange = {},
                                        readOnly = true,
                                        trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = targetDropdownExpanded) },
                                        modifier = Modifier
                                            .menuAnchor()
                                            .fillMaxWidth()
                                    )
                                    ExposedDropdownMenu(
                                        expanded = targetDropdownExpanded,
                                        onDismissRequest = { targetDropdownExpanded = false }
                                    ) {
                                        otherCategories.forEach { otherCat ->
                                            DropdownMenuItem(
                                                text = { Text(otherCat.name) },
                                                onClick = {
                                                    targetCategoryId = otherCat.id
                                                    targetDropdownExpanded = false
                                                }
                                            )
                                        }
                                    }
                                }
                            }
                        }

                        // Option 2: Leave uncategorized (reassignTo = "none")
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { reassignMode = "none" }
                        ) {
                            RadioButton(
                                selected = reassignMode == "none",
                                onClick = { reassignMode = "none" },
                                colors = RadioButtonDefaults.colors(selectedColor = BrandPrimary)
                            )
                            Text("Toifasiz qoldirish (none)", style = MaterialTheme.typography.bodySmall)
                        }
                    } else {
                        Text(
                            text = "Rostdan ham \"${cat.name}\" toifasini o‘chirmoqchimisiz?",
                            style = MaterialTheme.typography.bodyMedium
                        )
                    }
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        val reassignParam = if (cat.productCount > 0) {
                            if (reassignMode == "targetCategory") targetCategoryId else "none"
                        } else {
                            "none"
                        }
                        onDeleteCategory(cat.id, reassignParam)
                        categoryToDelete = null
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = ErrorRed)
                ) {
                    Text("O‘chirish")
                }
            },
            dismissButton = {
                TextButton(onClick = { categoryToDelete = null }) {
                    Text("Bekor qilish")
                }
            }
        )
    }
}
