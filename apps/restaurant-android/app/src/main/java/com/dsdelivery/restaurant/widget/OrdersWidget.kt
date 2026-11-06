package com.dsdelivery.restaurant.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.widget.RemoteViews
import com.dsdelivery.restaurant.MainActivity
import com.dsdelivery.restaurant.R
import com.dsdelivery.restaurant.RestaurantApp
import com.dsdelivery.restaurant.data.auth.SessionState
import com.dsdelivery.restaurant.data.model.Order
import com.dsdelivery.restaurant.data.model.OrdersPage
import com.dsdelivery.restaurant.data.model.Resource
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * What the home-screen widget shows, kept in the app's memory (the widget's list service runs in the same process).
 * Both lists are sorted OLDEST FIRST: the order that arrived first stays in front until the kitchen has dealt with it, a later one never
 * pushes it away (the server sends newest first, so the app re-sorts).
 */
object WidgetOrders {
    @Volatile var newOrders: List<Order> = emptyList()
        private set
    @Volatile var cookingOrders: List<Order> = emptyList()
        private set
    @Volatile var signedIn: Boolean = true
    /** Set when the last refresh could not reach the server. */
    @Volatile var offline: Boolean = false

    private fun oldestFirst(orders: List<Order>): List<Order> =
        orders.sortedWith(compareBy<Order>({ it.createdAtMillis ?: Long.MAX_VALUE }, { it.createdAt }))

    fun setNew(orders: List<Order>) { newOrders = oldestFirst(orders) }
    fun setCooking(orders: List<Order>) { cookingOrders = oldestFirst(orders) }
    fun clear() { newOrders = emptyList(); cookingOrders = emptyList() }

    fun forTab(tab: String): List<Order> = if (tab == OrdersWidget.TAB_COOKING) cookingOrders else newOrders

    /** Changes whenever the cards would look different (an order came, left or changed state). The cards show the clock time, not an age, so time passing is not part of it. */
    fun signature(): String =
        (newOrders + cookingOrders).joinToString("|") { "${it.id}:${it.status}:${it.items.size}:${it.totalSom}" } + "/$signedIn/$offline"
}

/**
 * The restaurant home-screen widget: a wide card (like a weather widget) with the orders that wait for the kitchen. One order is in front at a time;
 * a vertical swipe moves to the next. The two tabs on top switch between "Yangi" (waiting for the kitchen) and "Tayyorlanmoqda" (being cooked).
 * Android widgets cannot read a horizontal swipe (the launcher keeps it for changing home-screen pages), so the tabs are tapped.
 */
object OrdersWidget {
    const val TAB_NEW = "new"
    const val TAB_COOKING = "cooking"
    const val ACTION_TAB = "com.dsdelivery.restaurant.widget.TAB"
    const val ACTION_REFRESH = "com.dsdelivery.restaurant.widget.REFRESH"
    const val EXTRA_TAB = "tab"
    const val EXTRA_ORDER_ID = "orderId"

    private const val PREFS = "orders_widget"
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    @Volatile private var lastSignature: String = ""
    private val renderLock = Any()

    fun tab(context: Context): String =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("tab", TAB_NEW) ?: TAB_NEW

    fun setTab(context: Context, tab: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("tab", tab).apply()
    }

    /** How many dish lines fit on a card at the widget's current height. */
    fun maxLines(context: Context): Int = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getInt("lines", 2)

    private fun saveLines(context: Context, lines: Int) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putInt("lines", lines).apply()
    }

    private fun ids(context: Context): IntArray =
        AppWidgetManager.getInstance(context).getAppWidgetIds(ComponentName(context, OrdersWidgetProvider::class.java))

    fun hasWidgets(context: Context): Boolean = ids(context).isNotEmpty()

    /** Taller widget = more dish lines on the card (a 4x2 widget has room for two, 4x3 for four, taller for six). */
    private fun updateLinesFor(context: Context, manager: AppWidgetManager, id: Int) {
        val heightDp = manager.getAppWidgetOptions(id).getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 110)
        saveLines(context, when {
            heightDp < 150 -> 2
            heightDp < 220 -> 4
            else -> 6
        })
    }

    /** Called by the bell's watcher after every poll with the fresh "new" list: no extra request. Redraws only when something changed. */
    fun onNewOrders(context: Context, page: OrdersPage) {
        if (!hasWidgets(context)) return
        WidgetOrders.signedIn = true
        WidgetOrders.offline = false
        WidgetOrders.setNew(page.orders)
        renderIfChanged(context, page.newCount, page.cookingCount)
    }

    /** Loads both lists from the server (widget added, tab switched, refresh button, every 30 s from the watcher). */
    fun refresh(context: Context) {
        val app = context.applicationContext as? RestaurantApp ?: return
        scope.launch {
            if (!hasWidgets(app)) return@launch
            if (app.sessionManager.sessionState.value !is SessionState.LoggedIn) {
                WidgetOrders.signedIn = false
                WidgetOrders.clear()
                renderIfChanged(app, 0, 0)
                return@launch
            }
            WidgetOrders.signedIn = true
            var newCount = WidgetOrders.newOrders.size
            var cookingCount = WidgetOrders.cookingOrders.size
            var reached = false
            val fresh = app.repository.getOrders("new", null)
            if (fresh is Resource.Success) {
                WidgetOrders.setNew(fresh.data.orders)
                newCount = fresh.data.newCount
                cookingCount = fresh.data.cookingCount
                reached = true
            }
            val cooking = app.repository.getOrders("cooking", null)
            if (cooking is Resource.Success) {
                WidgetOrders.setCooking(cooking.data.orders)
                cookingCount = cooking.data.cookingCount
                reached = true
            }
            WidgetOrders.offline = !reached
            renderIfChanged(app, newCount, cookingCount)
        }
    }

    private fun renderIfChanged(context: Context, newCount: Int, cookingCount: Int) {
        val signature = WidgetOrders.signature() + "#$newCount/$cookingCount/${tab(context)}"
        synchronized(renderLock) {
            if (signature == lastSignature) return
            lastSignature = signature
        }
        render(context, newCount, cookingCount)
    }

    /** Full redraw (also used when the widget is first added or resized): header, adapter, and the cards. */
    fun render(context: Context, newCount: Int = WidgetOrders.newOrders.size, cookingCount: Int = WidgetOrders.cookingOrders.size) {
        val manager = AppWidgetManager.getInstance(context)
        val ids = ids(context)
        if (ids.isEmpty()) return
        for (id in ids) {
            updateLinesFor(context, manager, id)
            manager.updateAppWidget(id, buildViews(context, id, newCount, cookingCount))
        }
        manager.notifyAppWidgetViewDataChanged(ids, R.id.widget_stack)
    }

    private fun buildViews(context: Context, widgetId: Int, newCount: Int, cookingCount: Int): RemoteViews {
        val views = RemoteViews(context.packageName, R.layout.widget_orders)
        val newOn = tab(context) == TAB_NEW

        val adapter = Intent(context, OrdersWidgetService::class.java).apply {
            putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
            data = Uri.parse(toUri(Intent.URI_INTENT_SCHEME))
        }
        views.setRemoteAdapter(R.id.widget_stack, adapter)
        views.setEmptyView(R.id.widget_stack, R.id.widget_empty)

        // A tap on a card opens the app (the card's fill-in intent carries the order id).
        val open = Intent(context, MainActivity::class.java).apply { flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP }
        val mutable = if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0
        views.setPendingIntentTemplate(R.id.widget_stack, PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT or mutable))
        views.setOnClickPendingIntent(R.id.widget_open, PendingIntent.getActivity(context, 1, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))

        views.setTextViewText(R.id.widget_tab_new, "Yangi $newCount")
        views.setTextViewText(R.id.widget_tab_cooking, "Tayyorlanmoqda $cookingCount")
        views.setInt(R.id.widget_tab_new, "setBackgroundResource", if (newOn) R.drawable.widget_tab_on else R.drawable.widget_tab_off)
        views.setInt(R.id.widget_tab_cooking, "setBackgroundResource", if (newOn) R.drawable.widget_tab_off else R.drawable.widget_tab_on)
        views.setTextColor(R.id.widget_tab_new, if (newOn) 0xFFFFFFFF.toInt() else 0xFF1B3031.toInt())
        views.setTextColor(R.id.widget_tab_cooking, if (newOn) 0xFF1B3031.toInt() else 0xFFFFFFFF.toInt())

        views.setOnClickPendingIntent(R.id.widget_tab_new, tabIntent(context, TAB_NEW, widgetId * 4 + 1))
        views.setOnClickPendingIntent(R.id.widget_tab_cooking, tabIntent(context, TAB_COOKING, widgetId * 4 + 2))
        val refresh = Intent(context, OrdersWidgetProvider::class.java).apply { action = ACTION_REFRESH }
        views.setOnClickPendingIntent(
            R.id.widget_refresh,
            PendingIntent.getBroadcast(context, widgetId * 4 + 3, refresh, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        )

        views.setTextViewText(
            R.id.widget_empty,
            when {
                !WidgetOrders.signedIn -> "Kirish uchun ilovani oching"
                WidgetOrders.offline -> "Internetga ulanib bo‘lmadi. Yangilash tugmasini bosing"
                newOn -> "Yangi buyurtma yo‘q"
                else -> "Tayyorlanayotgan buyurtma yo‘q"
            }
        )
        return views
    }

    private fun tabIntent(context: Context, tab: String, requestCode: Int): PendingIntent {
        val intent = Intent(context, OrdersWidgetProvider::class.java).apply {
            action = ACTION_TAB
            putExtra(EXTRA_TAB, tab)
        }
        return PendingIntent.getBroadcast(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }
}
