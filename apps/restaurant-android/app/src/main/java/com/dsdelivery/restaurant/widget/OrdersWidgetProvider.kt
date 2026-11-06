package com.dsdelivery.restaurant.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.os.Bundle

/** The widget's entry point: the system calls it when the widget is added, resized or due for its slow periodic refresh. */
class OrdersWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        // Draw at once from what the app already knows, then load fresh lists.
        OrdersWidget.render(context)
        OrdersWidget.refresh(context)
    }

    override fun onEnabled(context: Context) {
        OrdersWidget.refresh(context)
    }

    override fun onAppWidgetOptionsChanged(context: Context, appWidgetManager: AppWidgetManager, appWidgetId: Int, newOptions: Bundle) {
        OrdersWidget.render(context)
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        when (intent.action) {
            OrdersWidget.ACTION_TAB -> {
                val tab = if (intent.getStringExtra(OrdersWidget.EXTRA_TAB) == OrdersWidget.TAB_COOKING) OrdersWidget.TAB_COOKING else OrdersWidget.TAB_NEW
                OrdersWidget.setTab(context, tab)
                OrdersWidget.render(context)   // instant, from memory
                OrdersWidget.refresh(context)  // then the server's current state
            }
            OrdersWidget.ACTION_REFRESH -> OrdersWidget.refresh(context)
        }
    }
}
