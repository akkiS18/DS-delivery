using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;

namespace DsTaxi.Core.Api;

public interface ITaxiApi
{
    Task<ApiResult<LoginResponse>> LoginAsync(string login, string password, CancellationToken ct = default);
    Task<ApiResult<bool>> LogoutAsync(CancellationToken ct = default);
    Task<ApiResult<RequestsResponse>> RequestsAsync(CancellationToken ct = default);
    Task<ApiResult<ActionResponse>> ActAsync(string id, string action, CancellationToken ct = default);
}

/// <summary>
/// All server calls of DS Taxi (/api/v1/taxi). Port of apps/taxi-android/.../data/Repository.kt: 401 = session gone (except on the login screen,
/// where it means a wrong login or password), 429 = locked, other errors keep the server's Uzbek <c>message</c>, network trouble = Offline.
/// The bearer token comes from <paramref name="token"/> on every call (never on login). Passwords and bodies are never logged.
/// </summary>
public sealed class TaxiApi : ITaxiApi
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private readonly HttpClient _http;
    private readonly Func<string?> _token;

    /// <param name="http">BaseAddress must be the server root ending with '/'. Timeout is set by the caller (the poll uses 10 s).</param>
    public TaxiApi(HttpClient http, Func<string?> token)
    {
        _http = http;
        _token = token;
    }

    /// <summary>Builds the HttpClient for a server address such as https://api.example.uz (HTTPS only, except localhost for development).</summary>
    public static HttpClient CreateClient(string baseUrl, HttpMessageHandler? handler = null)
    {
        var url = baseUrl.Trim().TrimEnd('/') + "/";
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)) throw new ArgumentException("Server address is not a valid URL.", nameof(baseUrl));
        var local = uri.IsLoopback;
        if (uri.Scheme != Uri.UriSchemeHttps && !local) throw new ArgumentException("Server address must be https://.", nameof(baseUrl));
        var client = handler is null ? new HttpClient() : new HttpClient(handler);
        client.BaseAddress = uri;
        client.Timeout = TimeSpan.FromSeconds(10);
        client.DefaultRequestHeaders.UserAgent.ParseAdd("DsTaxi-Windows/1.0");
        return client;
    }

    public async Task<ApiResult<LoginResponse>> LoginAsync(string login, string password, CancellationToken ct = default)
    {
        var r = await SendAsync<LoginResponse>(HttpMethod.Post, "api/v1/taxi/auth/login",
            new LoginRequest { Login = login.Trim().ToLowerInvariant(), Password = password }, withToken: false, ct).ConfigureAwait(false);
        // On the login screen a 401 means "wrong login or password", not "session expired".
        return r.Status == ApiStatus.Unauthorized ? ApiResult<LoginResponse>.Failed(401, "INVALID_CREDENTIALS", null) : r;
    }

    public Task<ApiResult<bool>> LogoutAsync(CancellationToken ct = default) =>
        SendAsync<bool>(HttpMethod.Post, "api/v1/taxi/auth/logout", null, withToken: true, ct);

    public Task<ApiResult<RequestsResponse>> RequestsAsync(CancellationToken ct = default) =>
        SendAsync<RequestsResponse>(HttpMethod.Get, "api/v1/taxi/requests", null, withToken: true, ct);

    public Task<ApiResult<ActionResponse>> ActAsync(string id, string action, CancellationToken ct = default)
    {
        if (id.Length == 0 || id.Any(c => !(char.IsAsciiLetterOrDigit(c) || c == '_' || c == '-')))
            return Task.FromResult(ApiResult<ActionResponse>.Failed(0, "BAD_ID", null)); // never put an odd id into a URL
        return SendAsync<ActionResponse>(HttpMethod.Post, $"api/v1/taxi/requests/{id}/action", new ActionRequest { Action = action }, withToken: true, ct);
    }

    private async Task<ApiResult<T>> SendAsync<T>(HttpMethod method, string path, object? body, bool withToken, CancellationToken ct)
    {
        try
        {
            using var req = new HttpRequestMessage(method, path);
            if (withToken)
            {
                var token = _token();
                if (!string.IsNullOrWhiteSpace(token)) req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            }
            if (body is not null) req.Content = JsonContent.Create(body, body.GetType(), options: Json);

            using var resp = await _http.SendAsync(req, ct).ConfigureAwait(false);
            if (resp.IsSuccessStatusCode)
            {
                if (typeof(T) == typeof(bool)) return ApiResult<T>.Ok((T)(object)true);
                var data = await resp.Content.ReadFromJsonAsync<T>(Json, ct).ConfigureAwait(false);
                return data is null ? ApiResult<T>.Failed((int)resp.StatusCode, null, null) : ApiResult<T>.Ok(data);
            }
            if ((int)resp.StatusCode == 401) return ApiResult<T>.Unauthorized();

            ApiErrorBody? err = null;
            try { err = await resp.Content.ReadFromJsonAsync<ApiErrorBody>(Json, ct).ConfigureAwait(false); }
            catch (Exception e) when (e is JsonException or NotSupportedException or InvalidOperationException) { /* not JSON: keep the status only */ }

            if ((int)resp.StatusCode == 429) return ApiResult<T>.Locked(err?.RetryAfterSeconds ?? 900);
            return ApiResult<T>.Failed((int)resp.StatusCode, err?.Error, err?.Message);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            return ApiResult<T>.Offline(); // HttpClient timeout
        }
        catch (HttpRequestException)
        {
            return ApiResult<T>.Offline();
        }
        catch (JsonException)
        {
            return ApiResult<T>.Failed(0, null, null);
        }
    }
}
