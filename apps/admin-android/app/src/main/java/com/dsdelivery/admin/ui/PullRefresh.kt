package com.dsdelivery.admin.ui

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
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Pull down on a list to reload it. Self-contained (only the nested-scroll system, no library beyond the Compose version in the project).
 * The spinner shows for a moment after the pull; [onRefresh] reloads in the background.
 */
@Composable
fun PullRefresh(onRefresh: () -> Unit, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val trigger = with(LocalDensity.current) { 72.dp.toPx() }
    val indicator = with(LocalDensity.current) { 40.dp.toPx() }
    var pull by remember { mutableFloatStateOf(0f) }
    var active by remember { mutableStateOf(false) }
    val currentOnRefresh by rememberUpdatedState(onRefresh)
    val scope = rememberCoroutineScope()

    val connection = remember(trigger) {
        object : NestedScrollConnection {
            override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
                if (pull > 0f && available.y < 0f) {
                    val used = maxOf(available.y, -pull)
                    pull += used
                    return Offset(0f, used)
                }
                return Offset.Zero
            }

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
                    scope.launch { delay(900); active = false }
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
                modifier = Modifier.align(Alignment.TopCenter).size(40.dp).graphicsLayer { translationY = y - indicator }
            ) {
                Box(contentAlignment = Alignment.Center) {
                    if (active || pull >= trigger) CircularProgressIndicator(modifier = Modifier.size(22.dp), strokeWidth = 2.dp)
                    else CircularProgressIndicator(progress = (pull / trigger).coerceIn(0f, 1f), modifier = Modifier.size(22.dp), strokeWidth = 2.dp)
                }
            }
        }
    }
}
