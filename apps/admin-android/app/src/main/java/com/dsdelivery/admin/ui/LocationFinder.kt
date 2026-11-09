package com.dsdelivery.admin.ui

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat

/** One position fix from the phone. [accuracyM] is the radius of doubt in metres. */
data class Fix(val lat: Double, val lng: Double, val accuracyM: Float)

/** Why no position came back; the screen turns it into one Uzbek sentence. */
enum class FixProblem { NO_PERMISSION, NO_PROVIDER, TIMEOUT }

/** The phone's position for "add this place here" (no Google Play services needed: the plain Android LocationManager). */
object LocationFinder {
    val permissions = arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)

    fun hasPermission(context: Context): Boolean =
        permissions.any { ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED }

    /** Asks for one fix (GPS first, then the network). [onResult] runs once, on the main thread. */
    @SuppressLint("MissingPermission")
    fun current(context: Context, timeoutMs: Long = 20_000, onResult: (Fix?, FixProblem?) -> Unit) {
        if (!hasPermission(context)) { onResult(null, FixProblem.NO_PERMISSION); return }
        val lm = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        val provider = when {
            lm.isProviderEnabled(LocationManager.GPS_PROVIDER) -> LocationManager.GPS_PROVIDER
            lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER) -> LocationManager.NETWORK_PROVIDER
            else -> { onResult(null, FixProblem.NO_PROVIDER); return }
        }
        var done = false
        val handler = Handler(Looper.getMainLooper())
        fun finish(loc: Location?) {
            if (done) return
            done = true
            handler.removeCallbacksAndMessages(null)
            if (loc != null) onResult(Fix(loc.latitude, loc.longitude, if (loc.hasAccuracy()) loc.accuracy else Float.MAX_VALUE), null)
            else onResult(null, FixProblem.TIMEOUT)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            lm.getCurrentLocation(provider, null, context.mainExecutor) { loc -> finish(loc) }
        } else {
            val listener = LocationListener { loc -> finish(loc) }
            @Suppress("DEPRECATION")
            lm.requestSingleUpdate(provider, listener, Looper.getMainLooper())
            handler.postDelayed({ lm.removeUpdates(listener) }, timeoutMs)
        }
        handler.postDelayed({ finish(null) }, timeoutMs)
    }
}
