package com.dsdelivery.admin

import android.app.Application
import com.dsdelivery.admin.core.AlarmPlayer
import com.dsdelivery.admin.core.Notifier
import com.dsdelivery.admin.core.Watcher
import com.dsdelivery.admin.data.Repository
import com.dsdelivery.admin.data.SessionStore
import com.dsdelivery.admin.service.WatchService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

/** Process-wide singletons (one polling loop, one alarm). The foreground service keeps this process alive while on duty. */
class AdminApp : Application() {

    lateinit var session: SessionStore private set
    lateinit var repository: Repository private set
    lateinit var alarm: AlarmPlayer private set
    lateinit var notifier: Notifier private set
    lateinit var watcher: Watcher private set

    override fun onCreate() {
        super.onCreate()
        instance = this
        session = SessionStore(this)
        repository = Repository(session)
        alarm = AlarmPlayer(this)
        notifier = Notifier(this)
        watcher = Watcher(
            scope = CoroutineScope(SupervisorJob() + Dispatchers.Default),
            repo = repository, session = session, alarm = alarm, notifier = notifier,
            onSignedOut = { WatchService.stop(this) },
        )
    }

    companion object {
        lateinit var instance: AdminApp private set
    }
}
