using System.Diagnostics;
using DsRestaurant.Core.Api;
using DsRestaurant.Core.Api.Dtos;
using DsRestaurant.Core.Common;

namespace DsRestaurant.Core.Orders;

public enum PollerConnectionState
{
    Connected,
    Retrying,
    Offline
}

public class OrderPoller
{
    private readonly RestaurantApi _api;
    private readonly NewOrderAttention _attention;
    private readonly IAlarmSink _alarmSink;
    private readonly Func<long> _getElapsedMs;

    private CancellationTokenSource? _cts;
    private Task? _pollTask;
    private int _consecutiveFailures = 0;

    public const int DefaultPollIntervalMs = 5000;
    public const int BackoffPollIntervalMs = 30000;

    public bool IsRunning => _pollTask != null && !_pollTask.IsCompleted;
    public bool IsRinging => _alarmSink.IsRinging;

    public PollerConnectionState ConnectionState { get; private set; } = PollerConnectionState.Offline;
    public DateTimeOffset? LastSuccessfulPollTime { get; private set; }
    public OrderCountsDto LatestCounts { get; private set; } = new();
    public IReadOnlyList<OrderDto> LatestNewOrders { get; private set; } = [];
    public ServerClock? LatestServerClock { get; private set; }

    public event Action? OnOrdersUpdated;
    public event Action<PollerConnectionState>? OnConnectionStateChanged;
    public event Action<IReadOnlyList<OrderDto>>? OnNewOrdersArrived;
    public event Action<bool>? OnRingingStateChanged;

    public OrderPoller(
        RestaurantApi api,
        NewOrderAttention attention,
        IAlarmSink alarmSink,
        Func<long>? getElapsedMs = null)
    {
        _api = api;
        _attention = attention;
        _alarmSink = alarmSink;
        _getElapsedMs = getElapsedMs ?? (() => Environment.TickCount64);
    }

    public void Start()
    {
        if (IsRunning) return;

        _cts = new CancellationTokenSource();
        _pollTask = Task.Run(() => PollLoopAsync(_cts.Token));
    }

    public void Stop()
    {
        _cts?.Cancel();
        _cts?.Dispose();
        _cts = null;
        _pollTask = null;

        _alarmSink.StopRinging();
        _attention.Update([], _getElapsedMs());
        LatestNewOrders = [];
        SetConnectionState(PollerConnectionState.Offline);
        OnRingingStateChanged?.Invoke(false);
    }

    public void Silence()
    {
        long now = _getElapsedMs();
        _attention.Silence(now);
        bool stillRinging = _attention.Ringing(now).Count > 0;
        if (!stillRinging)
        {
            _alarmSink.StopRinging();
            OnRingingStateChanged?.Invoke(false);
        }
    }

    private void SetConnectionState(PollerConnectionState state)
    {
        if (ConnectionState != state)
        {
            ConnectionState = state;
            OnConnectionStateChanged?.Invoke(state);
        }
    }

    private async Task PollLoopAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            var sw = Stopwatch.StartNew();
            long receivedElapsed = _getElapsedMs();

            try
            {
                using var timeoutCts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
                using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(ct, timeoutCts.Token);

                var result = await _api.GetOrdersAsync("new", limit: 20, cursor: null, ct: linkedCts.Token);

                if (result.IsSuccess && result.Value != null)
                {
                    _consecutiveFailures = 0;
                    LastSuccessfulPollTime = DateTimeOffset.UtcNow;
                    SetConnectionState(PollerConnectionState.Connected);

                    var response = result.Value;
                    var orders = response.Orders ?? [];
                    LatestCounts = response.Counts ?? new OrderCountsDto();
                    LatestNewOrders = orders;

                    long serverNowMillis = ServerClockHelper.ParseIsoMillis(orders.FirstOrDefault()?.ServerNow)
                                           ?? DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                    LatestServerClock = new ServerClock(serverNowMillis, receivedElapsed);

                    // Check for newly arrived ids
                    var previousPending = _attention.Pending().ToHashSet();
                    var newIds = orders.Select(o => o.Id).ToList();
                    var newlyArrived = orders.Where(o => !previousPending.Contains(o.Id)).ToList();

                    // Update attention bell
                    var ringingIds = _attention.Update(newIds, receivedElapsed);
                    bool shouldRing = ringingIds.Count > 0;

                    if (shouldRing)
                    {
                        _alarmSink.StartRinging();
                        OnRingingStateChanged?.Invoke(true);
                    }
                    else
                    {
                        _alarmSink.StopRinging();
                        OnRingingStateChanged?.Invoke(false);
                    }

                    if (newlyArrived.Count > 0)
                    {
                        OnNewOrdersArrived?.Invoke(newlyArrived);
                    }

                    OnOrdersUpdated?.Invoke();
                }
                else
                {
                    HandlePollFailure(result.StatusCode);
                }
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                break;
            }
            catch
            {
                HandlePollFailure(null);
            }

            int nextDelay = _consecutiveFailures > 1 ? BackoffPollIntervalMs : DefaultPollIntervalMs;
            sw.Stop();
            int remainingDelay = (int)Math.Max(100, nextDelay - sw.ElapsedMilliseconds);

            try
            {
                await Task.Delay(remainingDelay, ct);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    private void HandlePollFailure(int? statusCode)
    {
        _consecutiveFailures++;

        // 401 stops polling (handled by RestaurantApi.OnSessionExpired)
        if (statusCode == 401)
        {
            Stop();
            return;
        }

        SetConnectionState(_consecutiveFailures > 2 ? PollerConnectionState.Offline : PollerConnectionState.Retrying);
    }
}
