package com.dsdelivery.restaurant

import android.app.Application
import com.dsdelivery.restaurant.data.api.ApiClient
import com.dsdelivery.restaurant.data.alarm.AlarmController
import com.dsdelivery.restaurant.data.alarm.AlarmSettings
import com.dsdelivery.restaurant.data.api.ApiConfig
import com.dsdelivery.restaurant.data.auth.SessionManager
import com.dsdelivery.restaurant.data.repository.RestaurantRepository
import com.dsdelivery.restaurant.data.repository.RestaurantRepositoryImpl

class RestaurantApp : Application() {

    lateinit var apiConfig: ApiConfig
        private set

    lateinit var sessionManager: SessionManager
        private set

    lateinit var apiClient: ApiClient
        private set

    lateinit var repository: RestaurantRepository
        private set

    /** The kitchen bell: rings while an order waits for the kitchen, with the screen off too (see data/alarm). */
    lateinit var alarm: AlarmController
        private set

    override fun onCreate() {
        super.onCreate()
        instance = this

        apiConfig = ApiConfig(this)
        sessionManager = SessionManager(this)
        apiClient = ApiClient(apiConfig, sessionManager)
        repository = RestaurantRepositoryImpl(apiClient, sessionManager)
        alarm = AlarmController(this, repository, AlarmSettings(this))
        alarm.init()
    }

    companion object {
        lateinit var instance: RestaurantApp
            private set
    }
}
