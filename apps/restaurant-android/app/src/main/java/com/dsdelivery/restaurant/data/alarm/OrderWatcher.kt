package com.dsdelivery.restaurant.data.alarm

import android.content.Context
import android.os.SystemClock
import com.dsdelivery.restaurant.data.model.Order
import com.dsdelivery.restaurant.data.model.Reservation
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
    private var notifiedReservations: Set<String> = emptySet()

    private val _ringing = MutableStateFlow(false)
    /** True while the bell is sounding (the Orders screen shows a "mute" strip). */
    val ringing: StateFlow<Boolean> = _ringing

    @Synchronized
    fun start() {
        if (job?.isActive == true) return
        job = scope.launch {
            var tick = 0
            while (isActive) {
                when (val result = repository.getOrders("new", null)) {
                    is Resource.Success -> onOrders(result.data.orders)
                    is Resource.Error -> if ((result.cause as? HttpException)?.code() == 401) { stop(); return@launch }
                    Resource.Loading -> {}
                }
                // Reservations change rarely: look every third round (about every 15 s), with the same sign-out rule.
                if (tick++ % RESERVATION_EVERY == 0) {
                    when (val result = repository.getReservations()) {
                        is Resource.Success -> onReservations(result.data.upcoming)
                        is Resource.Error -> if ((result.cause as? HttpException)?.code() == 401) { stop(); return@launch }
                        Resource.Loading -> {}
                    }
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
        notifier.clearReservationAlert()
        notifiedReservations = emptySet()
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

    /** Reservations that are paid (or need the payment confirmed) and that nobody has opened yet. Sound only for ones not announced before. */
    @Synchronized
    private fun onReservations(upcoming: List<Reservation>) {
        val waiting = upcoming.filter { !it.cancelled && (!it.seen || it.awaitingConfirm) }
        val ids = waiting.map { it.id }.toSet()
        val soundAgain = !notifiedReservations.containsAll(ids)
        notifiedReservations = ids
        notifier.reservationAlert(waiting, soundAgain)
    }

    private fun render() {
        val ringingNow = attention.ringing(SystemClock.elapsedRealtime()).isNotEmpty()
        player.setRinging(ringingNow)
        _ringing.value = ringingNow
        notifier.alert(lastOrders.filter { it.id in attention.pending() }, ringingNow)
    }

    private companion object {
        const val POLL_MS = 5_000L
        const val RESERVATION_EVERY = 3
    }
}
