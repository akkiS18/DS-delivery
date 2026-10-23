package com.dsdelivery.restaurant.ui.components

import androidx.compose.foundation.layout.Box
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.PullToRefreshContainer
import androidx.compose.material3.rememberPullToRefreshState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedScroll
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Pull down on a list to reload it (the usual phone gesture, so no refresh button is needed in the title bar).
 * `isRefreshing` is the screen's own loading flag; the spinner stays until it turns false again, but at most ~8 seconds.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PullRefresh(
    isRefreshing: Boolean,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit
) {
    val state = rememberPullToRefreshState()
    val loading by rememberUpdatedState(isRefreshing)
    if (state.isRefreshing) {
        LaunchedEffect(Unit) {
            onRefresh()
            delay(600) // give the screen time to raise its own loading flag
            withTimeoutOrNull(8_000) { snapshotFlow { loading }.first { !it } }
            state.endRefresh()
        }
    }
    Box(modifier.nestedScroll(state.nestedScrollConnection)) {
        content()
        PullToRefreshContainer(state = state, modifier = Modifier.align(Alignment.TopCenter))
    }
}
