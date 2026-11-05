using System;
using System.Media;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Media;
using DsTaxi.Core.Dispatch;

namespace DsTaxi.App.Services;

/// <summary>
/// The ringing sound: the owner's new-order ringtone (Resources\new_order.mp3, the same file as the Android apps) played once, a pause, again, until
/// <see cref="SetRinging"/>(false). One play is cut after <see cref="MaxRingMs"/> so a broken file cannot freeze the loop; if the file cannot be
/// played the system "exclamation" sound is used instead, so the operator is never left in silence. Plays on the default output device at the system
/// volume (the program never changes the system volume). WPF's MediaPlayer belongs to the UI thread, so everything is marshalled there.
/// </summary>
public sealed class AlarmPlayer : IAlarm
{
    public const int RepeatMs = 1_200;
    public const int MaxRingMs = 15_000;

    private readonly System.Windows.Threading.Dispatcher _ui;
    private CancellationTokenSource? _ring; // UI thread only

    public AlarmPlayer(System.Windows.Threading.Dispatcher ui) => _ui = ui;

    public void SetRinging(bool ringing) => _ui.BeginInvoke(new Action(() => Apply(ringing)));

    private void Apply(bool ringing)
    {
        if (ringing)
        {
            if (_ring is not null) return;
            _ring = new CancellationTokenSource();
            _ = RingLoopAsync(_ring.Token);
        }
        else
        {
            _ring?.Cancel();
            _ring = null;
        }
    }

    private async Task RingLoopAsync(CancellationToken ct)
    {
        try
        {
            while (!ct.IsCancellationRequested)
            {
                await PlayOnceAsync(ct);
                await Task.Delay(RepeatMs, ct);
            }
        }
        catch (OperationCanceledException) { /* answered or muted */ }
    }

    /// <summary>"Ovozni sinash": one play of the ringtone.</summary>
    public Task TestAsync() => _ui.InvokeAsync(() => PlayOnceAsync(CancellationToken.None)).Task.Unwrap();

    /// <summary>A short different tone: the sign-in was rejected while the program was hidden.</summary>
    public void PlayWarning() => _ui.BeginInvoke(new Action(() => SystemSounds.Hand.Play()));

    private static async Task PlayOnceAsync(CancellationToken ct)
    {
        var done = new TaskCompletionSource();
        var failed = false;
        var player = new MediaPlayer { Volume = 1.0 };
        player.MediaEnded += (_, _) => done.TrySetResult();
        player.MediaFailed += (_, _) => { failed = true; done.TrySetResult(); };
        using var stop = ct.Register(() => done.TrySetResult());
        using var cap = CancellationTokenSource.CreateLinkedTokenSource(ct);
        try
        {
            player.Open(new Uri(AppPaths.Ringtone, UriKind.Absolute));
            player.Play();
            await Task.WhenAny(done.Task, Task.Delay(MaxRingMs, cap.Token));
        }
        catch (Exception e) when (e is UriFormatException or InvalidOperationException)
        {
            failed = true;
            Log.Error("ringtone could not be started", e);
        }
        finally
        {
            cap.Cancel();
            player.Stop();
            player.Close();
        }
        if (failed && !ct.IsCancellationRequested) SystemSounds.Exclamation.Play();
    }
}
