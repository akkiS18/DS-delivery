package com.dsdelivery.restaurant.data.model

data class WorkingDay(
    val dayOfWeek: Int, // 1 = Dushanba, 7 = Yakshanba
    val dayName: String,
    val isOpen: Boolean,
    val openTime: String = "09:00",
    val closeTime: String = "22:00"
)

data class RestaurantOperationsConfig(
    val isPaused: Boolean = false,
    val defaultPrepMinutes: Int = 25,
    val workingDays: List<WorkingDay> = defaultWorkingDays()
) {
    companion object {
        fun defaultWorkingDays(): List<WorkingDay> = listOf(
            WorkingDay(1, "Dushanba", true, "09:00", "22:00"),
            WorkingDay(2, "Seshanba", true, "09:00", "22:00"),
            WorkingDay(3, "Chorshanba", true, "09:00", "22:00"),
            WorkingDay(4, "Payshanba", true, "09:00", "22:00"),
            WorkingDay(5, "Juma", true, "09:00", "23:00"),
            WorkingDay(6, "Shanba", true, "10:00", "23:00"),
            WorkingDay(7, "Yakshanba", true, "10:00", "22:00")
        )
    }
}
