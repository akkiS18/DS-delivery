package com.dsdelivery.taxi

import android.app.Application
import com.dsdelivery.taxi.core.AlarmPlayer
import com.dsdelivery.taxi.core.Dispatcher
import com.dsdelivery.taxi.core.Notifier
import com.dsdelivery.taxi.data.Repository
import com.dsdelivery.taxi.data.SessionStore
import com.dsdelivery.taxi.service.DispatchService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

/** Process-wide singletons (one polling loop, one alarm). The foreground service keeps this process alive while on duty. */
class TaxiApp : Application() {

    lateinit var session: SessionStore private set
    lateinit var repository: Repository private set
    lateinit var alarm: AlarmPlayer private set
    lateinit var notifier: Notifier private set
    lateinit var dispatcher: Dispatcher private set

    override fun onCreate() {
        super.onCreate()
        instance = this
        session = SessionStore(this)
        repository = Repository(session)
        alarm = AlarmPlayer(this)
        notifier = Notifier(this)
        dispatcher = Dispatcher(
            scope = CoroutineScope(SupervisorJob() + Dispatchers.Default),
            repo = repository, session = session, alarm = alarm, notifier = notifier,
            onSignedOut = { DispatchService.stop(this) },
        )
    }

    companion object {
        lateinit var instance: TaxiApp private set
    }
}
