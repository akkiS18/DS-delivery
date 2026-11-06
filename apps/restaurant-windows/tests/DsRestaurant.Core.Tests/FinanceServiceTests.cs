using System.Net;
using DsRestaurant.Core.Api;
using DsRestaurant.Core.Finance;
using FluentAssertions;
using RichardSzalay.MockHttp;
using Xunit;

namespace DsRestaurant.Core.Tests;

public class FinanceServiceTests
{
    private const string BaseUrl = "https://api.sultonxoja.uz/";

    [Fact]
    public async Task RefreshState_WhenNoPin_TransitionsToNoPinPhase()
    {
        var mockHttp = new MockHttpMessageHandler();
        mockHttp.When(HttpMethod.Get, $"{BaseUrl}api/v1/restaurant/finance/state")
            .Respond("application/json", """{"hasPin": false, "unlocked": false}""");

        var api = new RestaurantApi(mockHttp.ToHttpClient(), BaseUrl);
        var service = new FinanceService(api);

        var phase = await service.RefreshStateAsync();

        phase.Should().Be(FinancePhase.NoPin);
        service.CurrentPhase.Should().Be(FinancePhase.NoPin);
        service.CurrentOverview.Should().BeNull();
    }

    [Fact]
    public async Task RefreshState_WhenLocked_TransitionsToLockedPhase()
    {
        var mockHttp = new MockHttpMessageHandler();
        mockHttp.When(HttpMethod.Get, $"{BaseUrl}api/v1/restaurant/finance/state")
            .Respond("application/json", """{"hasPin": true, "unlocked": false}""");

        var api = new RestaurantApi(mockHttp.ToHttpClient(), BaseUrl);
        var service = new FinanceService(api);

        var phase = await service.RefreshStateAsync();

        phase.Should().Be(FinancePhase.Locked);
        service.CurrentPhase.Should().Be(FinancePhase.Locked);
        service.CurrentOverview.Should().BeNull();
    }

    [Fact]
    public async Task RefreshState_WhenAlreadyUnlocked_TransitionsToOpen_AndLoadsOverview()
    {
        var mockHttp = new MockHttpMessageHandler();
        mockHttp.When(HttpMethod.Get, $"{BaseUrl}api/v1/restaurant/finance/state")
            .Respond("application/json", """{"hasPin": true, "unlocked": true, "unlockedUntil": "2026-11-06T12:00:00Z"}""");
        mockHttp.When(HttpMethod.Get, $"{BaseUrl}api/v1/restaurant/finance/overview")
            .Respond("application/json", """
            {
                "collectsToPlatform": true,
                "platformCard": {
                    "orders": 12,
                    "collectedSom": 1200000,
                    "restaurantEarnedSom": 1000000,
                    "platformFeeSom": 200000,
                    "paidOutSom": 400000,
                    "remainingSom": 600000
                }
            }
            """);

        var api = new RestaurantApi(mockHttp.ToHttpClient(), BaseUrl);
        var service = new FinanceService(api);

        var phase = await service.RefreshStateAsync();

        phase.Should().Be(FinancePhase.Open);
        service.CurrentPhase.Should().Be(FinancePhase.Open);
        service.CurrentOverview.Should().NotBeNull();
        service.CurrentOverview!.PlatformCard!.RemainingSom.Should().Be(600000);
    }

    [Fact]
    public async Task Unlock_Success_SetsPhaseOpen_AndLoadsOverview()
    {
        var mockHttp = new MockHttpMessageHandler();
        mockHttp.When(HttpMethod.Post, $"{BaseUrl}api/v1/restaurant/finance/unlock")
            .Respond("application/json", """{"unlocked": true, "unlockedUntil": "2026-11-06T12:10:00Z"}""");
        mockHttp.When(HttpMethod.Get, $"{BaseUrl}api/v1/restaurant/finance/overview")
            .Respond("application/json", """
            {
                "collectsToPlatform": true,
                "platformCard": {
                    "remainingSom": 850000
                }
            }
            """);

        var api = new RestaurantApi(mockHttp.ToHttpClient(), BaseUrl);
        var service = new FinanceService(api);

        var res = await service.UnlockAsync("1234");

        res.Should().BeOfType<UnlockResult.Success>();
        service.CurrentPhase.Should().Be(FinancePhase.Open);
        service.CurrentOverview.Should().NotBeNull();
        service.CurrentOverview!.PlatformCard!.RemainingSom.Should().Be(850000);
    }

    [Fact]
    public async Task Unlock_WrongPin_ReturnsWrongPin()
    {
        var mockHttp = new MockHttpMessageHandler();
        mockHttp.When(HttpMethod.Post, $"{BaseUrl}api/v1/restaurant/finance/unlock")
            .Respond(HttpStatusCode.Forbidden, "application/json", """
            {
                "code": "FINANCE_PIN_WRONG",
                "message": "Kod noto‘g‘ri",
                "attemptsLeft": 3
            }
            """);

        var api = new RestaurantApi(mockHttp.ToHttpClient(), BaseUrl);
        var service = new FinanceService(api);

        var res = await service.UnlockAsync("0000");

        res.Should().BeOfType<UnlockResult.WrongPin>();
        service.CurrentPhase.Should().Be(FinancePhase.Checking); // Not open
        service.CurrentOverview.Should().BeNull();
    }

    [Fact]
    public async Task Unlock_Blocked_ReturnsBlockedWithRetrySeconds()
    {
        var mockHttp = new MockHttpMessageHandler();
        mockHttp.When(HttpMethod.Post, $"{BaseUrl}api/v1/restaurant/finance/unlock")
            .Respond((HttpStatusCode)429, "application/json", """
            {
                "code": "FINANCE_PIN_BLOCKED",
                "message": "Juda ko‘p urinish",
                "retryAfterSeconds": 600
            }
            """);

        var api = new RestaurantApi(mockHttp.ToHttpClient(), BaseUrl);
        var service = new FinanceService(api);

        var res = await service.UnlockAsync("0000");

        res.Should().BeOfType<UnlockResult.Blocked>();
        ((UnlockResult.Blocked)res).RetryAfterSeconds.Should().Be(600);
    }

    [Fact]
    public async Task Lock_ImmediatelyWipesNumbersFromMemory()
    {
        var mockHttp = new MockHttpMessageHandler();
        mockHttp.When(HttpMethod.Post, $"{BaseUrl}api/v1/restaurant/finance/unlock")
            .Respond("application/json", """{"unlocked": true}""");
        mockHttp.When(HttpMethod.Get, $"{BaseUrl}api/v1/restaurant/finance/overview")
            .Respond("application/json", """{"platformCard": {"remainingSom": 500000}}""");
        mockHttp.When(HttpMethod.Post, $"{BaseUrl}api/v1/restaurant/finance/lock")
            .Respond(HttpStatusCode.NoContent);

        var api = new RestaurantApi(mockHttp.ToHttpClient(), BaseUrl);
        var service = new FinanceService(api);

        await service.UnlockAsync("1234");
        service.CurrentOverview.Should().NotBeNull();

        await service.LockAsync();

        service.CurrentPhase.Should().Be(FinancePhase.Locked);
        service.CurrentOverview.Should().BeNull();
        service.UnlockedUntil.Should().BeNull();
    }

    [Fact]
    public async Task RefreshOverview_When423Locked_WipesMemoryAndLocks()
    {
        var mockHttp = new MockHttpMessageHandler();
        mockHttp.When(HttpMethod.Post, $"{BaseUrl}api/v1/restaurant/finance/unlock")
            .Respond("application/json", """{"unlocked": true}""");
        mockHttp.When(HttpMethod.Get, $"{BaseUrl}api/v1/restaurant/finance/overview")
            .Respond((HttpStatusCode)423, "application/json", """
            {
                "code": "FINANCE_LOCKED",
                "message": "PIN-kod talab qilinadi"
            }
            """);

        var api = new RestaurantApi(mockHttp.ToHttpClient(), BaseUrl);
        var service = new FinanceService(api);

        var res = await service.RefreshOverviewAsync();

        res.IsSuccess.Should().BeFalse();
        service.CurrentPhase.Should().Be(FinancePhase.Locked);
        service.CurrentOverview.Should().BeNull();
    }
}
