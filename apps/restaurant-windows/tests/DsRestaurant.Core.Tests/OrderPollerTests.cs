using System.Net;
using DsRestaurant.Core.Api;
using DsRestaurant.Core.Orders;
using FluentAssertions;
using RichardSzalay.MockHttp;
using Xunit;

namespace DsRestaurant.Core.Tests;

public class TestAlarmSink : IAlarmSink
{
    public bool IsRinging { get; private set; }
    public int RingCallCount { get; private set; }
    public int StopCallCount { get; private set; }
    public int TestSoundCount { get; private set; }

    public void StartRinging()
    {
        IsRinging = true;
        RingCallCount++;
    }

    public void StopRinging()
    {
        IsRinging = false;
        StopCallCount++;
    }

    public void PlayTestSound()
    {
        TestSoundCount++;
    }
}

public class OrderPollerTests
{
    private const string BaseUrl = "https://api.sultonxoja.uz/";

    [Fact]
    public async Task Poller_NewOrderArrives_TriggersAlarmSink()
    {
        var mockHttp = new MockHttpMessageHandler();
        mockHttp.When(HttpMethod.Get, $"{BaseUrl}api/v1/restaurant/orders*")
            .Respond("application/json", """
            {
                "orders": [
                    {
                        "id": "ord_101",
                        "code": "A101",
                        "status": "WAITING_RESTAURANT",
                        "totalSom": 120000,
                        "createdAt": "2026-11-06T10:00:00Z",
                        "serverNow": "2026-11-06T10:05:00Z"
                    }
                ],
                "counts": {
                    "new": 1,
                    "cooking": 0,
                    "ready": 0,
                    "waiting": 0
                }
            }
            """);

        var httpClient = mockHttp.ToHttpClient();
        var api = new RestaurantApi(httpClient, BaseUrl) { AccessToken = "valid-token" };
        var attention = new NewOrderAttention();
        var alarmSink = new TestAlarmSink();

        long simulatedTime = 10_000L;
        var poller = new OrderPoller(api, attention, alarmSink, () => simulatedTime);

        var tcs = new TaskCompletionSource<bool>();
        poller.OnOrdersUpdated += () => tcs.TrySetResult(true);

        poller.Start();

        var completed = await Task.WhenAny(tcs.Task, Task.Delay(2000));
        completed.Should().Be(tcs.Task);

        poller.LatestNewOrders.Should().HaveCount(1);
        poller.LatestNewOrders[0].Code.Should().Be("A101");
        poller.LatestCounts.New.Should().Be(1);
        alarmSink.RingCallCount.Should().BeGreaterThan(0);

        poller.Stop();
        poller.ConnectionState.Should().Be(PollerConnectionState.Offline); // After stop
    }

    [Fact]
    public async Task Poller_Silence_MutesAlarmSink()
    {
        var mockHttp = new MockHttpMessageHandler();
        mockHttp.When(HttpMethod.Get, $"{BaseUrl}api/v1/restaurant/orders*")
            .Respond("application/json", """
            {
                "orders": [
                    {
                        "id": "ord_101",
                        "code": "A101",
                        "status": "WAITING_RESTAURANT",
                        "totalSom": 120000,
                        "createdAt": "2026-11-06T10:00:00Z",
                        "serverNow": "2026-11-06T10:05:00Z"
                    }
                ],
                "counts": { "new": 1 }
            }
            """);

        var httpClient = mockHttp.ToHttpClient();
        var api = new RestaurantApi(httpClient, BaseUrl) { AccessToken = "valid-token" };
        var attention = new NewOrderAttention();
        var alarmSink = new TestAlarmSink();

        long simulatedTime = 10_000L;
        var poller = new OrderPoller(api, attention, alarmSink, () => simulatedTime);

        poller.Start();
        await Task.Delay(200);

        alarmSink.IsRinging.Should().BeTrue();

        // Silence the alarm
        poller.Silence();

        alarmSink.IsRinging.Should().BeFalse();
        alarmSink.StopCallCount.Should().BeGreaterThan(0);

        poller.Stop();
    }

    [Fact]
    public async Task Poller_401_StopsPollingImmediately()
    {
        var mockHttp = new MockHttpMessageHandler();
        mockHttp.When(HttpMethod.Get, $"{BaseUrl}api/v1/restaurant/orders*")
            .Respond(HttpStatusCode.Unauthorized, "application/json", """
            {
                "error": "UNAUTHENTICATED"
            }
            """);

        var httpClient = mockHttp.ToHttpClient();
        var api = new RestaurantApi(httpClient, BaseUrl) { AccessToken = "bad-token" };
        var attention = new NewOrderAttention();
        var alarmSink = new TestAlarmSink();

        var poller = new OrderPoller(api, attention, alarmSink);

        poller.Start();
        await Task.Delay(200);

        poller.IsRunning.Should().BeFalse();
        poller.ConnectionState.Should().Be(PollerConnectionState.Offline);
    }
}
