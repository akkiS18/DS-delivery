package com.dsdelivery.restaurant.ui.components

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Velocity
import androidx.compose.ui.unit.dp
import com.dsdelivery.restaurant.ui.theme.BrandPrimary
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Pull down on a list to reload it (the usual phone gesture, so no refresh button is needed in the title bar).
 * Self-contained on purpose: it only uses the nested-scroll system, no library beyond the Compose version already in the project.
 * `isRefreshing` is the screen's own loading flag; the spinner stays until it turns false again, but at most ~8 seconds.
 */
@Composable
fun PullRefresh(
    isRefreshing: Boolean,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit
) {
    val trigger = with(LocalDensity.current) { 72.dp.toPx() }
    val indicator = with(LocalDensity.current) { 40.dp.toPx() }
    var pull by remember { mutableFloatStateOf(0f) }
    var active by remember { mutableStateOf(false) }
    val loading by rememberUpdatedState(isRefreshing)
    val currentOnRefresh by rememberUpdatedState(onRefresh)
    val scope = rememberCoroutineScope()

    val connection = remember(trigger) {
        object : NestedScrollConnection {
            // Scrolling back up first shrinks the pull before the list moves.
            override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
                if (pull > 0f && available.y < 0f) {
                    val used = maxOf(available.y, -pull)
                    pull += used
                    return Offset(0f, used)
                }
                return Offset.Zero
            }

            // The list is already at its top and the finger keeps going down: that leftover drag is the pull.
            override fun onPostScroll(consumed: Offset, available: Offset, source: NestedScrollSource): Offset {
                if (source == NestedScrollSource.Drag && available.y > 0f && !active) {
                    pull = (pull + available.y * 0.5f).coerceAtMost(trigger * 1.5f)
                    return Offset(0f, available.y)
                }
                return Offset.Zero
            }

            override suspend fun onPreFling(available: Velocity): Velocity {
                if (pull >= trigger && !active) {
                    active = true
                    currentOnRefresh()
                    scope.launch {
                        delay(600) // give the screen time to raise its own loading flag
                        withTimeoutOrNull(8_000) { snapshotFlow { loading }.first { !it } }
                        active = false
                    }
                }
                pull = 0f
                return Velocity.Zero
            }
        }
    }

    Box(modifier.nestedScroll(connection)) {
        content()
        if (pull > 0f || active) {
            val y = (if (active) trigger else pull) * 0.75f
            Surface(
                shape = CircleShape,
                shadowElevation = 4.dp,
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .size(40.dp)
                    .graphicsLayer { translationY = y - indicator }
            ) {
                Box(contentAlignment = Alignment.Center) {
                    if (active || pull >= trigger) {
                        CircularProgressIndicator(modifier = Modifier.size(22.dp), strokeWidth = 2.dp, color = BrandPrimary)
                    } else {
                        CircularProgressIndicator(progress = (pull / trigger).coerceIn(0f, 1f), modifier = Modifier.size(22.dp), strokeWidth = 2.dp, color = BrandPrimary)
                    }
                }
            }
        }
    }
}
