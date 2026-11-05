using System.Net;
using System.Text;
using DsTaxi.Core.Api;
using Xunit;

namespace DsTaxi.Core.Tests;

internal sealed class StubHandler : HttpMessageHandler
{
    public Func<HttpRequestMessage, HttpResponseMessage> Respond { get; set; } = _ => new HttpResponseMessage(HttpStatusCode.OK);
    public List<(HttpMethod Method, string Path, string? Auth, string? Body)> Calls { get; } = new();

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var body = request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken);
        Calls.Add((request.Method, request.RequestUri!.AbsolutePath, request.Headers.Authorization?.ToString(), body));
        return Respond(request);
    }

    public static HttpResponseMessage Json(HttpStatusCode code, string json) =>
        new(code) { Content = new StringContent(json, Encoding.UTF8, "application/json") };
}

public class TaxiApiTests
{
    private readonly StubHandler _h = new();
    private string? _token = "tok-123";

    private TaxiApi Make() => new(TaxiApi.CreateClient("https://api.example.uz", _h), () => _token);

    [Fact]
    public async Task Login_trims_and_lowercases_the_login_and_sends_no_token()
    {
        _h.Respond = _ => StubHandler.Json(HttpStatusCode.OK,
            """{"accessToken":"abc","tokenType":"Bearer","expiresAt":"2027-01-01T00:00:00Z","company":{"id":"c1","name":"Joxa taxi","login":"joxa"}}""");
        var r = await Make().LoginAsync("  JoXa ", "secret");
        Assert.True(r.IsOk);
        Assert.Equal("abc", r.Data!.AccessToken);
        Assert.Equal("Joxa taxi", r.Data.Company.Name);
        var call = _h.Calls.Single();
        Assert.Equal("/api/v1/taxi/auth/login", call.Path);
        Assert.Null(call.Auth);
        Assert.Contains("\"login\":\"joxa\"", call.Body);
    }

    [Fact]
    public async Task Login_401_is_wrong_credentials_not_an_expired_session()
    {
        _h.Respond = _ => StubHandler.Json(HttpStatusCode.Unauthorized, """{"error":"INVALID_CREDENTIALS"}""");
        var r = await Make().LoginAsync("joxa", "bad");
        Assert.Equal(ApiStatus.Failed, r.Status);
        Assert.Equal(401, r.HttpStatus);
        Assert.Equal("INVALID_CREDENTIALS", r.Error);
    }

    [Fact]
    public async Task Too_many_attempts_is_locked_with_the_wait_time()
    {
        _h.Respond = _ => StubHandler.Json((HttpStatusCode)429, """{"error":"TOO_MANY_ATTEMPTS","retryAfterSeconds":600}""");
        var r = await Make().LoginAsync("joxa", "x");
        Assert.Equal(ApiStatus.Locked, r.Status);
        Assert.Equal(600, r.RetryAfterSeconds);
    }

    [Fact]
    public async Task A_suspended_company_is_a_403_failure()
    {
        _h.Respond = _ => StubHandler.Json(HttpStatusCode.Forbidden, """{"error":"COMPANY_INACTIVE"}""");
        var r = await Make().LoginAsync("joxa", "x");
        Assert.Equal(ApiStatus.Failed, r.Status);
        Assert.Equal(403, r.HttpStatus);
    }

    [Fact]
    public async Task Requests_sends_the_bearer_token_and_reads_a_response_with_missing_fields()
    {
        _h.Respond = _ => StubHandler.Json(HttpStatusCode.OK, """
            {"serverNow":"2026-11-05T10:00:00Z","company":{"id":"c1","name":"Joxa taxi","login":"joxa"},
             "active":[{"id":"d1","orderCode":"K7M2Q","status":"REQUESTED","attention":true,"createdAt":"2026-11-05T09:59:00Z","answerBy":"2026-11-05T10:03:00Z",
               "updatedAt":"2026-11-05T09:59:00Z","isTest":false,
               "restaurant":{"name":"Sifat Food","address":"Osh","phone":"+998901112233"},
               "delivery":{"address":"Manzil 1","lat":41.3,"lng":69.2,"customerPhone":"+998909998877"},
               "food":{"ready":false,"status":"PREPARING","totalSom":55000},
               "actions":["ACCEPT","NO_TAXI"],"deliverBlockedReason":null,"someNewField":123}],
             "history":[]}
            """);
        var r = await Make().RequestsAsync();
        Assert.True(r.IsOk);
        var req = r.Data!.Active.Single();
        Assert.Equal("Bearer tok-123", _h.Calls.Single().Auth);
        Assert.Equal("K7M2Q", req.OrderCode);
        Assert.True(req.Attention);
        Assert.Null(req.Payment); // an older server sends no payment block
        Assert.Equal(new[] { "ACCEPT", "NO_TAXI" }, req.Actions);
        Assert.Equal(41.3, req.Delivery.Lat);
        Assert.Equal(55_000, req.Food.TotalSom);
    }

    [Fact]
    public async Task A_cash_payment_block_is_read()
    {
        _h.Respond = _ => StubHandler.Json(HttpStatusCode.OK,
            """{"serverNow":"2026-11-05T10:00:00Z","active":[{"id":"d1","status":"ACCEPTED","payment":{"method":"CASH","payRestaurantSom":55000},"actions":["SENT"]}],"history":[]}""");
        var r = await Make().RequestsAsync();
        Assert.Equal("CASH", r.Data!.Active.Single().Payment!.Method);
        Assert.Equal(55_000, r.Data.Active.Single().Payment!.PayRestaurantSom);
    }

    [Fact]
    public async Task A_401_on_a_protected_call_means_the_session_is_gone()
    {
        _h.Respond = _ => StubHandler.Json(HttpStatusCode.Unauthorized, """{"error":"UNAUTHENTICATED"}""");
        Assert.Equal(ApiStatus.Unauthorized, (await Make().RequestsAsync()).Status);
    }

    [Fact]
    public async Task An_action_posts_the_wire_name_and_a_409_keeps_the_servers_uzbek_message()
    {
        _h.Respond = _ => StubHandler.Json(HttpStatusCode.Conflict, """{"error":"TAKSI_SOROVI_ESKIRGAN","message":"Bu amal eskirgan. Ro‘yxatni yangilang."}""");
        var r = await Make().ActAsync("d1", TaxiAction.Sent);
        var call = _h.Calls.Single();
        Assert.Equal("/api/v1/taxi/requests/d1/action", call.Path);
        Assert.Contains("\"action\":\"SENT\"", call.Body);
        Assert.Equal(ApiStatus.Failed, r.Status);
        Assert.Equal(409, r.HttpStatus);
        Assert.Equal("Bu amal eskirgan. Ro‘yxatni yangilang.", r.Message);
    }

    [Fact]
    public async Task An_odd_request_id_never_reaches_the_url()
    {
        var r = await Make().ActAsync("../../auth/logout", TaxiAction.Accept);
        Assert.Equal(ApiStatus.Failed, r.Status);
        Assert.Empty(_h.Calls);
    }

    [Fact]
    public async Task A_network_error_is_offline()
    {
        _h.Respond = _ => throw new HttpRequestException("no route");
        Assert.Equal(ApiStatus.Offline, (await Make().RequestsAsync()).Status);
    }

    [Fact]
    public async Task A_timeout_is_offline()
    {
        _h.Respond = _ => throw new TaskCanceledException("timeout");
        Assert.Equal(ApiStatus.Offline, (await Make().RequestsAsync()).Status);
    }

    [Fact]
    public async Task A_caller_cancellation_is_not_swallowed()
    {
        using var cts = new CancellationTokenSource();
        cts.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => Make().RequestsAsync(cts.Token));
    }

    [Fact]
    public async Task An_error_page_that_is_not_json_still_gives_the_status()
    {
        _h.Respond = _ => new HttpResponseMessage(HttpStatusCode.BadGateway) { Content = new StringContent("<html>bad gateway</html>", Encoding.UTF8, "text/html") };
        var r = await Make().RequestsAsync();
        Assert.Equal(ApiStatus.Failed, r.Status);
        Assert.Equal(502, r.HttpStatus);
        Assert.Null(r.Message);
    }

    [Fact]
    public async Task Logout_204_is_ok()
    {
        _h.Respond = _ => new HttpResponseMessage(HttpStatusCode.NoContent);
        Assert.True((await Make().LogoutAsync()).IsOk);
    }

    [Theory]
    [InlineData("http://api.example.uz")]
    [InlineData("not a url")]
    public void Only_https_servers_are_accepted(string url) => Assert.Throws<ArgumentException>(() => TaxiApi.CreateClient(url));

    [Fact]
    public void Localhost_is_allowed_for_development() => Assert.NotNull(TaxiApi.CreateClient("http://localhost:4000"));
}
