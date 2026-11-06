using DsRestaurant.Core.Api;
using DsRestaurant.Core.Api.Dtos;
using DsRestaurant.Core.Common;

namespace DsRestaurant.Core.Auth;

public class AuthService
{
    private readonly RestaurantApi _api;
    private readonly ISessionStore _sessionStore;

    public SessionData? CurrentSession { get; private set; }
    public bool IsAuthenticated => CurrentSession != null && !string.IsNullOrEmpty(CurrentSession.AccessToken);
    public RestaurantDto? CurrentRestaurant => CurrentSession?.Restaurant;

    public event Action<bool>? AuthStateChanged;

    public AuthService(RestaurantApi api, ISessionStore sessionStore)
    {
        _api = api;
        _sessionStore = sessionStore;
        _api.OnSessionExpired += HandleSessionExpired;
    }

    private void HandleSessionExpired()
    {
        _ = LogoutAsync();
    }

    public async Task<bool> InitializeAsync()
    {
        try
        {
            var saved = await _sessionStore.LoadAsync();
            if (saved == null || string.IsNullOrEmpty(saved.AccessToken))
            {
                CurrentSession = null;
                _api.AccessToken = null;
                AuthStateChanged?.Invoke(false);
                return false;
            }

            _api.AccessToken = saved.AccessToken;
            _api.UpdateBaseUrl(saved.BaseUrl);

            var meResult = await _api.GetMeAsync();
            if (meResult.IsSuccess && meResult.Value?.Restaurant != null)
            {
                CurrentSession = saved with { Restaurant = meResult.Value.Restaurant };
                await _sessionStore.SaveAsync(CurrentSession);
                AuthStateChanged?.Invoke(true);
                return true;
            }

            // Stored session invalid or expired
            await _sessionStore.ClearAsync();
            CurrentSession = null;
            _api.AccessToken = null;
            AuthStateChanged?.Invoke(false);
            return false;
        }
        catch
        {
            return false;
        }
    }

    public async Task<Result<LoginResponse>> LoginAsync(string slug, string password, string? baseUrl = null)
    {
        if (!string.IsNullOrEmpty(baseUrl))
        {
            _api.UpdateBaseUrl(baseUrl);
        }

        var res = await _api.LoginAsync(slug, password);
        if (res.IsSuccess && res.Value != null)
        {
            var session = new SessionData(
                AccessToken: res.Value.AccessToken,
                TokenType: res.Value.TokenType,
                ExpiresAt: res.Value.ExpiresAt,
                Restaurant: res.Value.Restaurant,
                BaseUrl: _api.BaseUrl
            );
            await _sessionStore.SaveAsync(session);
            CurrentSession = session;
            AuthStateChanged?.Invoke(true);
        }

        return res;
    }

    public async Task LogoutAsync()
    {
        try
        {
            await _api.LogoutAsync();
        }
        catch
        {
            // Plan 4.1: always clear the local token afterwards, even if the call fails
        }
        finally
        {
            await _sessionStore.ClearAsync();
            CurrentSession = null;
            _api.AccessToken = null;
            AuthStateChanged?.Invoke(false);
        }
    }
}
