package com.dsdelivery.restaurant.data.alarm

import android.content.Context
import android.os.SystemClock
import com.dsdelivery.restaurant.data.model.Order
import com.dsdelivery.restaurant.data.model.Resource
import com.dsdelivery.restaurant.data.repository.RestaurantRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import retrofit2.HttpException

/**
 * Watches the server's `new` bucket every few seconds and rings the kitchen bell while an order waits for the kitchen. It lives in the
 * application process (started by [AlarmController]); the foreground service only keeps that process alive with the screen off.
 * Silence uses the monotonic clock, so a wrong phone clock cannot keep the bell quiet for hours.
 */
class OrderWatcher(
    context: Context,
    private val repository: RestaurantRepository
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val attention = NewOrderAttention()
    private val notifier = AlarmNotifier(context)
    val player = AlarmPlayer(context)
    private var job: Job? = null
    private var lastOrders: List<Order> = emptyList()

    private val _ringing = MutableStateFlow(false)
    /** True while the bell is sounding (the Orders screen shows a "mute" strip). */
    val ringing: StateFlow<Boolean> = _ringing

    @Synchronized
    fun start() {
        if (job?.isActive == true) return
        job = scope.launch {
            while (isActive) {
                when (val result = repository.getOrders("new", null)) {
                    is Resource.Success -> onOrders(result.data.orders)
                    is Resource.Error -> if ((result.cause as? HttpException)?.code() == 401) { stop(); return@launch }
                    Resource.Loading -> {}
                }
                delay(POLL_MS)
            }
        }
    }

    @Synchronized
    fun stop() {
        job?.cancel()
        job = null
        attention.update(emptyList(), SystemClock.elapsedRealtime())
        lastOrders = emptyList()
        player.setRinging(false)
        notifier.clearAlert()
        _ringing.value = false
    }

    /** Mutes the orders waiting now for 30 s (the bell comes back if they are still unanswered). */
    @Synchronized
    fun silence() {
        attention.silence(SystemClock.elapsedRealtime())
        render()
    }

    @Synchronized
    private fun onOrders(orders: List<Order>) {
        lastOrders = orders
        attention.update(orders.map { it.id }, SystemClock.elapsedRealtime())
        render()
    }

    private fun render() {
        val ringingNow = attention.ringing(SystemClock.elapsedRealtime()).isNotEmpty()
        player.setRinging(ringingNow)
        _ringing.value = ringingNow
        notifier.alert(lastOrders.filter { it.id in attention.pending() }, ringingNow)
    }

    private companion object {
        const val POLL_MS = 5_000L
    }
}
