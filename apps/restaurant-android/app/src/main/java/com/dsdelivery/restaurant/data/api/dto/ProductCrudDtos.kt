package com.dsdelivery.restaurant.data.api.dto

import com.google.gson.TypeAdapter
import com.google.gson.annotations.JsonAdapter
import com.google.gson.annotations.SerializedName
import com.google.gson.stream.JsonReader
import com.google.gson.stream.JsonWriter

// Stage 5B strict product create payload: no imageUrl, no id, no restaurantId
data class CreateProductRequestDto(
    @SerializedName("name")
    val name: String,
    @SerializedName("priceSom")
    val priceSom: Int,
    @SerializedName("description")
    val description: String? = null,
    @SerializedName("categoryId")
    val categoryId: String? = null,
    @SerializedName("isAvailable")
    val isAvailable: Boolean = true
)

// Stage 5B strict product update payload: requires version for optimistic concurrency; no imageUrl.
// PUT is a full replace and the backend schema requires the keys "description" and "categoryId" to be PRESENT
// (value may be null). Gson omits null fields by default, which made every edit of a product without a
// description or category fail validation, so this DTO is always written with explicit nulls.
@JsonAdapter(UpdateProductRequestAdapter::class)
data class UpdateProductRequestDto(
    @SerializedName("name")
    val name: String,
    @SerializedName("priceSom")
    val priceSom: Int,
    @SerializedName("description")
    val description: String? = null,
    @SerializedName("categoryId")
    val categoryId: String? = null,
    @SerializedName("version")
    val version: Int
)

// Stage 5B strict availability patch: idempotent set
data class UpdateAvailabilityRequestDto(
    @SerializedName("isAvailable")
    val isAvailable: Boolean,
    @SerializedName("version")
    val version: Int? = null
)

// Stage 5B category create payload
data class CreateCategoryRequestDto(
    @SerializedName("name")
    val name: String,
    @SerializedName("position")
    val position: Int? = null
)

// Stage 5B category update payload: requires version
data class UpdateCategoryRequestDto(
    @SerializedName("name")
    val name: String,
    @SerializedName("position")
    val position: Int,
    @SerializedName("version")
    val version: Int
)

/** Writes all five keys of the update contract, emitting explicit JSON null for a cleared description/category. */
class UpdateProductRequestAdapter : TypeAdapter<UpdateProductRequestDto>() {
    override fun write(out: JsonWriter, value: UpdateProductRequestDto?) {
        if (value == null) {
            out.nullValue()
            return
        }
        val previous = out.serializeNulls
        out.serializeNulls = true
        try {
            out.beginObject()
            out.name("name").value(value.name)
            out.name("priceSom").value(value.priceSom.toLong())
            out.name("description").value(value.description)
            out.name("categoryId").value(value.categoryId)
            out.name("version").value(value.version.toLong())
            out.endObject()
        } finally {
            out.serializeNulls = previous
        }
    }

    override fun read(reader: JsonReader): UpdateProductRequestDto =
        throw UnsupportedOperationException("UpdateProductRequestDto is request-only")
}
