using DsTaxi.Core.Api;

namespace DsTaxi.Core.Dispatch;

/// <summary>The signed-in account and the "on duty" choice (the app implements it with DPAPI-protected files).</summary>
public interface ISession
{
    bool IsLoggedIn { get; }
    /// <summary>On duty = the program rings. Off = it only shows requests while it is open.</summary>
    bool Duty { get; }
    void Clear();
}

/// <summary>The sound. Implemented by the app (the ringtone loop); tests use a fake.</summary>
public interface IAlarm
{
    void SetRinging(bool ringing);
}

public sealed record DispatchState
{
    public IReadOnlyList<RequestDto> Active { get; init; } = Array.Empty<RequestDto>();
    public IReadOnlyList<RequestDto> History { get; init; } = Array.Empty<RequestDto>();
    /// <summary>True once at least one list has arrived (so the screen can tell "empty" from "not loaded yet").</summary>
    public bool Loaded { get; init; }
    /// <summary>Several polls in a row failed: the program cannot hear new requests right now.</summary>
    public bool Offline { get; init; }
    public bool Ringing { get; init; }
    /// <summary>Keys (id:status) the operator has to answer.</summary>
    public IReadOnlySet<string> Waiting { get; init; } = new HashSet<string>();
    /// <summary>Server clock minus local clock in ms, so countdowns are right even when the PC clock is off.</summary>
    public long ClockOffsetMs { get; init; }
    public DateTimeOffset? LastOkAt { get; init; }
}

/// <summary>
/// The heart of the program: polls the server every few seconds, keeps the screen state, and runs the alarm. Port of core/Dispatcher.kt.
/// The poll is also the "company app is online" signal for the server (it warns the administrators after ~90 s without one), so it keeps running
/// whenever the program is open and signed in, even when the window is hidden in the tray.
/// </summary>
public sealed class Dispatcher
{
    public static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(3);
    public static readonly TimeSpan FastPollInterval = TimeSpan.FromSeconds(2);
    public const int OfflineAfterFailures = 3;

    private readonly ITaxiApi _api;
    private readonly ISession _session;
    private readonly IAlarm _alarm;
    private readonly TimeProvider _clock;
    private readonly AttentionTracker _tracker;
    private readonly object _gate = new();

    private CancellationTokenSource? _loop;
    private int _failures;
    private IReadOnlyList<RequestDto> _latest = Array.Empty<RequestDto>();
    private HashSet<string> _announced = new();
    private DispatchState _state = new();

    public Dispatcher(ITaxiApi api, ISession session, IAlarm alarm, TimeProvider? clock = null, long silenceMs = AttentionTracker.DefaultSilenceMs)
    {
        _api = api;
        _session = session;
        _alarm = alarm;
        _clock = clock ?? TimeProvider.System;
        _tracker = new AttentionTracker(silenceMs);
    }

    public DispatchState State { get { lock (_gate) return _state; } }

    /// <summary>Raised (on a thread-pool thread) after every state change.</summary>
    public event Action<DispatchState>? StateChanged;

    /// <summary>Raised when requests START ringing (a new key appeared): the window should come to the front.</summary>
    public event Action<IReadOnlyList<RequestDto>>? RingingStarted;

    /// <summary>Raised once when the server says the session is gone; the app shows the login screen.</summary>
    public event Action? SignedOut;

    private long NowMs() => (long)(_clock.GetTimestamp() * 1000.0 / _clock.TimestampFrequency);

    public void Start()
    {
        lock (_gate)
        {
            if (_loop is not null || !_session.IsLoggedIn) return;
            _loop = new CancellationTokenSource();
            var ct = _loop.Token;
            _ = Task.Run(() => LoopAsync(ct), ct);
        }
    }

    public void Stop()
    {
        lock (_gate)
        {
            _loop?.Cancel();
            _loop = null;
            _failures = 0;
            _latest = Array.Empty<RequestDto>();
            _announced = new HashSet<string>();
            _state = new DispatchState();
        }
        _alarm.SetRinging(false);
        StateChanged?.Invoke(State);
    }

    private async Task LoopAsync(CancellationToken ct)
    {
        try
        {
            while (!ct.IsCancellationRequested)
            {
                await PollOnceAsync(ct).ConfigureAwait(false);
                if (!_session.IsLoggedIn) break;
                await Task.Delay(State.Ringing ? FastPollInterval : PollInterval, _clock, ct).ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException) { /* Stop() */ }
    }

    /// <summary>Pull-to-refresh equivalent and the "window came back" refresh.</summary>
    public Task RefreshNowAsync() => PollOnceAsync(CancellationToken.None);

    public void Silence()
    {
        _tracker.Silence(NowMs());
        Publish();
    }

    /// <summary>Re-evaluates the alarm when the duty switch changes.</summary>
    public void DutyChanged() => Publish();

    /// <summary>Presses a button. Returns the server's Uzbek message on a refusal, or null on success.</summary>
    public async Task<string?> ActAsync(string id, string action, CancellationToken ct = default)
    {
        var r = await _api.ActAsync(id, action, ct).ConfigureAwait(false);
        switch (r.Status)
        {
            case ApiStatus.Ok:
                await PollOnceAsync(ct).ConfigureAwait(false);
                return null;
            case ApiStatus.Unauthorized:
                HandleSignedOut();
                return "Sessiya tugagan. Qayta kiring.";
            case ApiStatus.Offline:
                return "Internet yo‘q. Qayta urinib ko‘ring.";
            case ApiStatus.Locked:
                return "Biroz kuting.";
            default:
                await PollOnceAsync(ct).ConfigureAwait(false);
                return r.Message ?? "Amal bajarilmadi.";
        }
    }

    public async Task PollOnceAsync(CancellationToken ct = default)
    {
        if (!_session.IsLoggedIn) return;
        var r = await _api.RequestsAsync(ct).ConfigureAwait(false);
        if (!_session.IsLoggedIn) return; // signed out while the answer was on its way: it must not bring the screen back
        switch (r.Status)
        {
            case ApiStatus.Ok when r.Data is not null:
            {
                var local = _clock.GetUtcNow();
                var server = DateTimeOffset.TryParse(r.Data.ServerNow, null, System.Globalization.DateTimeStyles.AssumeUniversal, out var s) ? s : local;
                lock (_gate)
                {
                    _failures = 0;
                    _latest = r.Data.Active;
                    _state = _state with
                    {
                        Active = r.Data.Active, History = r.Data.History, Loaded = true, Offline = false,
                        LastOkAt = local, ClockOffsetMs = (long)(server - local).TotalMilliseconds,
                    };
                }
                Publish();
                break;
            }
            case ApiStatus.Unauthorized:
                HandleSignedOut();
                break;
            default:
            {
                bool changed;
                lock (_gate)
                {
                    _failures++;
                    changed = _failures >= OfflineAfterFailures && !_state.Offline;
                    if (changed) _state = _state with { Offline = true };
                }
                if (changed) StateChanged?.Invoke(State);
                break;
            }
        }
    }

    /// <summary>Recomputes who is ringing and updates the sound.</summary>
    private void Publish()
    {
        IReadOnlyList<RequestDto> started = Array.Empty<RequestDto>();
        DispatchState snapshot;
        bool ring;
        lock (_gate)
        {
            var ringingKeys = _tracker.Update(_latest, NowMs());
            var waiting = _tracker.Pending();
            ring = _session.Duty && ringingKeys.Count > 0;
            if (_session.Duty)
            {
                var fresh = ringingKeys.Where(k => !_announced.Contains(k)).ToHashSet();
                if (fresh.Count > 0) started = _latest.Where(r => fresh.Contains(AttentionTracker.KeyOf(r))).ToList();
                _announced = ringingKeys.ToHashSet();
            }
            else
            {
                _announced = new HashSet<string>();
            }
            _state = _state with { Ringing = ring, Waiting = waiting };
            snapshot = _state;
        }
        _alarm.SetRinging(ring);
        StateChanged?.Invoke(snapshot);
        if (started.Count > 0) RingingStarted?.Invoke(started);
    }

    private void HandleSignedOut()
    {
        _session.Clear();
        Stop();
        SignedOut?.Invoke();
    }
}
