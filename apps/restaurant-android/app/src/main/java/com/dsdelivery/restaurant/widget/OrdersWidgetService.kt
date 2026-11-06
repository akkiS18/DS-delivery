package com.dsdelivery.restaurant.widget

import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import com.dsdelivery.restaurant.R
import com.dsdelivery.restaurant.data.model.Order
import com.dsdelivery.restaurant.data.model.OrderStatus
import com.dsdelivery.restaurant.data.model.formatClock

/** Feeds the widget's stack of cards: one card per order, oldest first. */
class OrdersWidgetService : RemoteViewsService() {
    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory = Factory(applicationContext)

    private class Factory(private val context: Context) : RemoteViewsFactory {
        private var orders: List<Order> = emptyList()

        override fun onCreate() {}

        override fun onDataSetChanged() {
            orders = WidgetOrders.forTab(OrdersWidget.tab(context))
        }

        override fun onDestroy() {
            orders = emptyList()
        }

        override fun getCount(): Int = orders.size

        override fun getViewAt(position: Int): RemoteViews {
            val views = RemoteViews(context.packageName, R.layout.widget_order_card)
            val order = orders.getOrNull(position) ?: return views

            views.setTextViewText(R.id.card_code, order.orderNumberDisplay)
            val clock = order.createdAtMillis?.let { formatClock(it) }
            views.setTextViewText(R.id.card_time, listOfNotNull(clock, stateText(order)).joinToString(" • "))
            views.setTextViewText(R.id.card_total, order.formattedTotal)

            // The dishes, big, one line each: "3×  Hot dog o'rtacha". More than fit: the last line says how many are left.
            views.removeAllViews(R.id.card_items)
            val limit = OrdersWidget.maxLines(context).coerceAtLeast(2)
            val shown = if (order.items.size > limit) limit - 1 else order.items.size
            for (item in order.items.take(shown)) {
                val line = RemoteViews(context.packageName, R.layout.widget_order_item)
                line.setTextViewText(R.id.item_qty, "${item.quantity}×")
                line.setTextViewText(R.id.item_name, item.name)
                views.addView(R.id.card_items, line)
            }
            val hidden = order.items.size - shown
            if (hidden > 0) {
                val more = RemoteViews(context.packageName, R.layout.widget_order_more)
                more.setTextViewText(R.id.more_text, "+ yana $hidden ta taom")
                views.addView(R.id.card_items, more)
            }
            if (order.items.isEmpty()) {
                val line = RemoteViews(context.packageName, R.layout.widget_order_more)
                line.setTextViewText(R.id.more_text, "${order.itemsCount} ta mahsulot")
                views.addView(R.id.card_items, line)
            }

            views.setOnClickFillInIntent(R.id.card_root, Intent().putExtra(OrdersWidget.EXTRA_ORDER_ID, order.id))
            return views
        }

        private fun stateText(order: Order): String = when {
            order.status == OrderStatus.PREPARING && order.needsPrepChoice -> "To‘langan, qabul qiling"
            order.status == OrderStatus.WAITING_RESTAURANT -> "Yangi"
            order.status == OrderStatus.PREPARING -> "Tayyorlanmoqda"
            else -> order.status.title
        }

        override fun getLoadingView(): RemoteViews? = null
        override fun getViewTypeCount(): Int = 1
        override fun getItemId(position: Int): Long = (orders.getOrNull(position)?.id?.hashCode() ?: position).toLong()
        override fun hasStableIds(): Boolean = true
    }
}
