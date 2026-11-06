using System.Net;
using DsRestaurant.Core.Api;
using DsRestaurant.Core.Auth;
using FluentAssertions;
using RichardSzalay.MockHttp;
using Xunit;

namespace DsRestaurant.Core.Tests;

public class InMemorySessionStore : ISessionStore
{
    public SessionData? StoredSession { get; set; }

    public Task<SessionData?> LoadAsync() => Task.FromResult(StoredSession);
    public Task SaveAsync(SessionData session)
    {
        StoredSession = session;
        return Task.CompletedTask;
    }
    public Task ClearAsync()
    {
        StoredSession = null;
        return Task.CompletedTask;
    }
}

public class AuthAndApiTests
{
    private const string BaseUrl = "https://api.sultonxoja.uz/";

    [Fact]
    public async Task Login_Success_SavesSession_AndSetsToken()
    {
        var mockHttp = new MockHttpMessageHandler();
        mockHttp.When(HttpMethod.Post, $"{BaseUrl}api/v1/restaurant/auth/login")
            .Respond("application/json", """
            {
                "accessToken": "test-jwt-token",
                "tokenType": "Bearer",
                "expiresAt": "2026-11-06T12:00:00Z",
                "restaurant": {
                    "id": "rest_1",
                    "slug": "osh-markazi",
                    "name": "Osh Markazi"
                }
            }
            """);

        var httpClient = mockHttp.ToHttpClient();
        var api = new RestaurantApi(httpClient, BaseUrl);
        var sessionStore = new InMemorySessionStore();
        var authService = new AuthService(api, sessionStore);

        bool authChanged = false;
        authService.AuthStateChanged += isAuth => authChanged = isAuth;

        var result = await authService.LoginAsync("osh-markazi", "secret123");

        result.IsSuccess.Should().BeTrue();
        result.Value!.AccessToken.Should().Be("test-jwt-token");
        api.AccessToken.Should().Be("test-jwt-token");
        authService.IsAuthenticated.Should().BeTrue();
        authService.CurrentRestaurant!.Name.Should().Be("Osh Markazi");
        authChanged.Should().BeTrue();

        sessionStore.StoredSession.Should().NotBeNull();
        sessionStore.StoredSession!.AccessToken.Should().Be("test-jwt-token");
    }

    [Fact]
    public async Task Login_InvalidCredentials_ReturnsUzbekError()
    {
        var mockHttp = new MockHttpMessageHandler();
        mockHttp.When(HttpMethod.Post, $"{BaseUrl}api/v1/restaurant/auth/login")
            .Respond(HttpStatusCode.Unauthorized, "application/json", """
            {
                "error": "INVALID_CREDENTIALS"
            }
            """);

        var httpClient = mockHttp.ToHttpClient();
        var api = new RestaurantApi(httpClient, BaseUrl);
        var sessionStore = new InMemorySessionStore();
        var authService = new AuthService(api, sessionStore);

        var result = await authService.LoginAsync("osh-markazi", "wrongpass");

        result.IsSuccess.Should().BeFalse();
        result.ErrorMessage.Should().Be("Restoran kodi yoki parol noto‘g‘ri.");
        authService.IsAuthenticated.Should().BeFalse();
        sessionStore.StoredSession.Should().BeNull();
    }

    [Fact]
    public async Task Login_RestaurantInactive_ReturnsUzbekError()
    {
        var mockHttp = new MockHttpMessageHandler();
        mockHttp.When(HttpMethod.Post, $"{BaseUrl}api/v1/restaurant/auth/login")
            .Respond(HttpStatusCode.Forbidden, "application/json", """
            {
                "error": "RESTAURANT_INACTIVE"
            }
            """);

        var httpClient = mockHttp.ToHttpClient();
        var api = new RestaurantApi(httpClient, BaseUrl);
        var sessionStore = new InMemorySessionStore();
        var authService = new AuthService(api, sessionStore);

        var result = await authService.LoginAsync("osh-markazi", "secret");

        result.IsSuccess.Should().BeFalse();
        result.ErrorMessage.Should().Be("Restoran to‘xtatilgan. Administrator bilan bog‘laning.");
        authService.IsAuthenticated.Should().BeFalse();
    }

    [Fact]
    public async Task ApiCall_401OnNormalEndpoint_TriggersSessionExpired()
    {
        var mockHttp = new MockHttpMessageHandler();
        mockHttp.When(HttpMethod.Get, $"{BaseUrl}api/v1/restaurant/orders*")
            .Respond(HttpStatusCode.Unauthorized, "application/json", """
            {
                "error": "UNAUTHENTICATED"
            }
            """);

        var httpClient = mockHttp.ToHttpClient();
        var api = new RestaurantApi(httpClient, BaseUrl) { AccessToken = "expired-token" };
        var sessionStore = new InMemorySessionStore
        {
            StoredSession = new SessionData("expired-token", "Bearer", null, null, BaseUrl)
        };
        var authService = new AuthService(api, sessionStore);

        bool expiredFired = false;
        api.OnSessionExpired += () => expiredFired = true;

        var result = await api.GetOrdersAsync();

        result.IsSuccess.Should().BeFalse();
        result.StatusCode.Should().Be(401);
        expiredFired.Should().BeTrue();
    }

    [Fact]
    public async Task FinanceUnlock_403WrongPin_DoesNotTriggerSessionExpired()
    {
        var mockHttp = new MockHttpMessageHandler();
        mockHttp.When(HttpMethod.Post, $"{BaseUrl}api/v1/restaurant/finance/unlock")
            .Respond(HttpStatusCode.Forbidden, "application/json", """
            {
                "error": "FINANCE_PIN_WRONG",
                "attemptsLeft": 3
            }
            """);

        var httpClient = mockHttp.ToHttpClient();
        var api = new RestaurantApi(httpClient, BaseUrl) { AccessToken = "valid-token" };

        bool expiredFired = false;
        api.OnSessionExpired += () => expiredFired = true;

        var result = await api.UnlockFinanceAsync("9999");

        result.IsSuccess.Should().BeFalse();
        result.StatusCode.Should().Be(403);
        result.ErrorMessage.Should().Be("Moliya kodi noto‘g‘ri.");
        expiredFired.Should().BeFalse(); // Crucial rule: 403 on unlock must NOT expire session!
    }

    [Fact]
    public async Task Logout_ClearsTokenAndStorage()
    {
        var mockHttp = new MockHttpMessageHandler();
        mockHttp.When(HttpMethod.Post, $"{BaseUrl}api/v1/restaurant/auth/logout")
            .Respond(HttpStatusCode.NoContent);

        var httpClient = mockHttp.ToHttpClient();
        var api = new RestaurantApi(httpClient, BaseUrl) { AccessToken = "valid-token" };
        var sessionStore = new InMemorySessionStore
        {
            StoredSession = new SessionData("valid-token", "Bearer", null, null, BaseUrl)
        };
        var authService = new AuthService(api, sessionStore);

        await authService.LogoutAsync();

        api.AccessToken.Should().BeNull();
        authService.IsAuthenticated.Should().BeFalse();
        sessionStore.StoredSession.Should().BeNull();
    }
}
