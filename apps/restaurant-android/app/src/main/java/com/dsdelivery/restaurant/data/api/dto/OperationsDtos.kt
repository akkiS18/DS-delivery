package com.dsdelivery.restaurant.data.api.dto

import com.dsdelivery.restaurant.data.model.RestaurantOperationsConfig
import com.dsdelivery.restaurant.data.model.WorkingDay
import com.google.gson.annotations.SerializedName

// Stage 6C: GET/PATCH/PUT /api/v1/restaurant/operations*

data class WorkingDayDto(
    @SerializedName("dayOfWeek") val dayOfWeek: Int,
    @SerializedName("isOpen") val isOpen: Boolean,
    @SerializedName("openTime") val openTime: String,
    @SerializedName("closeTime") val closeTime: String
)

data class OperationsResponseDto(
    @SerializedName("isPaused") val isPaused: Boolean? = null,
    @SerializedName("defaultPrepMinutes") val defaultPrepMinutes: Int? = null,
    @SerializedName("workingDays") val workingDays: List<WorkingDayDto>? = null
)

data class UpdateStatusRequestDto(@SerializedName("isPaused") val isPaused: Boolean)

data class UpdatePrepTimeRequestDto(@SerializedName("defaultPrepMinutes") val defaultPrepMinutes: Int)

data class UpdateWorkingHoursRequestDto(@SerializedName("days") val days: List<WorkingDayDto>)

fun WorkingDay.toDto() = WorkingDayDto(dayOfWeek, isOpen, openTime, closeTime)

fun OperationsResponseDto.toDomain(): RestaurantOperationsConfig {
    val names = RestaurantOperationsConfig.defaultWorkingDays().associate { it.dayOfWeek to it.dayName }
    return RestaurantOperationsConfig(
        isPaused = isPaused ?: false,
        defaultPrepMinutes = defaultPrepMinutes ?: 25,
        workingDays = workingDays
            ?.map { WorkingDay(it.dayOfWeek, names[it.dayOfWeek] ?: "", it.isOpen, it.openTime, it.closeTime) }
            ?.sortedBy { it.dayOfWeek }
            ?: RestaurantOperationsConfig.defaultWorkingDays()
    )
}
