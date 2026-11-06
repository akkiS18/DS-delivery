using System.IO;
using System.Windows;
using System.Windows.Media;
using DsRestaurant.Core.Orders;
using Serilog;

namespace DsRestaurant.App.Audio;

public class AlarmPlayer : IAlarmSink
{
    private readonly string _soundFilePath;
    private MediaPlayer? _mediaPlayer;
    private CancellationTokenSource? _ringCts;
    private Task? _ringTask;
    private readonly object _lock = new();

    public bool IsRinging { get; private set; }

    public AlarmPlayer()
    {
        var baseDir = AppDomain.CurrentDomain.BaseDirectory;
        var path = Path.Combine(baseDir, "Resources", "new_order.mp3");
        if (!File.Exists(path))
        {
            path = Path.Combine(baseDir, "new_order.mp3");
        }
        _soundFilePath = path;
    }

    public void StartRinging()
    {
        lock (_lock)
        {
            if (IsRinging) return;
            IsRinging = true;

            _ringCts = new CancellationTokenSource();
            _ringTask = Task.Run(() => RingLoopAsync(_ringCts.Token));
        }
    }

    public void StopRinging()
    {
        lock (_lock)
        {
            if (!IsRinging) return;
            IsRinging = false;

            _ringCts?.Cancel();
            _ringCts?.Dispose();
            _ringCts = null;
            _ringTask = null;

            StopMedia();
        }
    }

    public void PlayTestSound()
    {
        Task.Run(async () =>
        {
            try
            {
                await PlayOnceAsync(CancellationToken.None);
            }
            catch (Exception ex)
            {
                Log.Warning(ex, "Failed to play test sound");
            }
        });
    }

    private async Task RingLoopAsync(CancellationToken ct)
    {
        Log.Information("Alarm ring loop started");
        try
        {
            while (!ct.IsCancellationRequested && IsRinging)
            {
                await PlayOnceAsync(ct);

                // Pause 1.2s between rings (Plan section 131)
                await Task.Delay(1200, ct);
            }
        }
        catch (OperationCanceledException)
        {
            // Expected on stop
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Error in alarm ring loop");
        }
        finally
        {
            StopMedia();
            Log.Information("Alarm ring loop ended");
        }
    }

    private async Task PlayOnceAsync(CancellationToken ct)
    {
        if (!File.Exists(_soundFilePath))
        {
            Log.Warning("Alarm sound file not found at {Path}", _soundFilePath);
            await Task.Delay(2000, ct);
            return;
        }

        var tcs = new TaskCompletionSource<bool>();

        Application.Current?.Dispatcher.Invoke(() =>
        {
            try
            {
                _mediaPlayer?.Stop();
                _mediaPlayer?.Close();

                _mediaPlayer = new MediaPlayer();
                _mediaPlayer.Open(new Uri(_soundFilePath, UriKind.Absolute));

                _mediaPlayer.MediaEnded += (s, e) => tcs.TrySetResult(true);
                _mediaPlayer.MediaFailed += (s, e) => tcs.TrySetResult(false);

                _mediaPlayer.Play();
            }
            catch (Exception ex)
            {
                Log.Warning(ex, "MediaPlayer invocation failed");
                tcs.TrySetResult(false);
            }
        });

        // Cap one play at 15s (Plan section 131)
        using var timeoutCts = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(ct, timeoutCts.Token);

        linkedCts.Token.Register(() => tcs.TrySetResult(false));

        await tcs.Task;
    }

    private void StopMedia()
    {
        Application.Current?.Dispatcher.Invoke(() =>
        {
            try
            {
                _mediaPlayer?.Stop();
                _mediaPlayer?.Close();
                _mediaPlayer = null;
            }
            catch
            {
                // Ignore
            }
        });
    }
}
