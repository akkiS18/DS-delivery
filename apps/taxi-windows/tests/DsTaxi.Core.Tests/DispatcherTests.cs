using DsTaxi.Core.Api;
using DsTaxi.Core.Dispatch;
using Xunit;

namespace DsTaxi.Core.Tests;

internal sealed class ManualClock : TimeProvider
{
    private long _ms;
    private DateTimeOffset _utc = new(2026, 11, 5, 10, 0, 0, TimeSpan.Zero);
    public override long TimestampFrequency => 1000;
    public override long GetTimestamp() => _ms;
    public override DateTimeOffset GetUtcNow() => _utc;
    public void Advance(TimeSpan by) { _ms += (long)by.TotalMilliseconds; _utc += by; }
}

internal sealed class FakeSession : ISession
{
    public bool IsLoggedIn { get; set; } = true;
    public bool Duty { get; set; } = true;
    public void Clear() => IsLoggedIn = false;
}

internal sealed class FakeAlarm : IAlarm
{
    public bool Ringing { get; private set; }
    public void SetRinging(bool ringing) => Ringing = ringing;
}

internal sealed class FakeApi : ITaxiApi
{
    public Queue<ApiResult<RequestsResponse>> Polls { get; } = new();
    public ApiResult<RequestsResponse> LastPoll { get; set; } = ApiResult<RequestsResponse>.Offline();
    public ApiResult<ActionResponse> ActResult { get; set; } = ApiResult<ActionResponse>.Ok(new ActionResponse { Changed = true });
    public int PollCount { get; private set; }
    public List<(string Id, string Action)> Acts { get; } = new();

    public Task<ApiResult<LoginResponse>> LoginAsync(string login, string password, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<ApiResult<bool>> LogoutAsync(CancellationToken ct = default) => Task.FromResult(ApiResult<bool>.Ok(true));

    public Task<ApiResult<RequestsResponse>> RequestsAsync(CancellationToken ct = default)
    {
        PollCount++;
        if (Polls.Count > 0) LastPoll = Polls.Dequeue();
        return Task.FromResult(LastPoll);
    }

    public Task<ApiResult<ActionResponse>> ActAsync(string id, string action, CancellationToken ct = default)
    {
        Acts.Add((id, action));
        return Task.FromResult(ActResult);
    }

    public static ApiResult<RequestsResponse> Ok(params RequestDto[] active) =>
        ApiResult<RequestsResponse>.Ok(new RequestsResponse { ServerNow = "2026-11-05T10:00:00Z", Active = active.ToList() });
}

public class DispatcherTests
{
    private readonly ManualClock _clock = new();
    private readonly FakeSession _session = new();
    private readonly FakeAlarm _alarm = new();
    private readonly FakeApi _api = new();

    private Dispatcher Make() => new(_api, _session, _alarm, _clock);

    private static RequestDto NewRequest(string id = "a") => AttentionTrackerTests.Req(id, "REQUESTED", true);

    [Fact]
    public async Task A_new_request_rings_once_and_announces_itself_once()
    {
        _api.LastPoll = FakeApi.Ok(NewRequest());
        var d = Make();
        var announced = new List<int>();
        d.RingingStarted += list => announced.Add(list.Count);

        await d.PollOnceAsync();
        Assert.True(_alarm.Ringing);
        Assert.True(d.State.Loaded);
        Assert.Single(d.State.Active);

        await d.PollOnceAsync(); // the same request again: still ringing, but not announced again
        Assert.True(_alarm.Ringing);
        Assert.Equal(new[] { 1 }, announced);
    }

    [Fact]
    public async Task Nothing_rings_when_off_duty_and_it_rings_when_duty_is_switched_on()
    {
        _session.Duty = false;
        _api.LastPoll = FakeApi.Ok(NewRequest());
        var d = Make();
        await d.PollOnceAsync();
        Assert.False(_alarm.Ringing);

        _session.Duty = true;
        d.DutyChanged();
        Assert.True(_alarm.Ringing);
    }

    [Fact]
    public async Task Silence_mutes_for_30_seconds_and_then_it_rings_again()
    {
        _api.LastPoll = FakeApi.Ok(NewRequest());
        var d = Make();
        await d.PollOnceAsync();
        d.Silence();
        Assert.False(_alarm.Ringing);

        _clock.Advance(TimeSpan.FromSeconds(29));
        await d.PollOnceAsync();
        Assert.False(_alarm.Ringing);

        _clock.Advance(TimeSpan.FromSeconds(2));
        await d.PollOnceAsync();
        Assert.True(_alarm.Ringing);
    }

    [Fact]
    public async Task Answering_a_request_stops_the_ringing()
    {
        _api.LastPoll = FakeApi.Ok(NewRequest());
        var d = Make();
        await d.PollOnceAsync();
        Assert.True(_alarm.Ringing);

        _api.LastPoll = FakeApi.Ok(AttentionTrackerTests.Req("a", "ACCEPTED", false)); // answered on the phone
        await d.PollOnceAsync();
        Assert.False(_alarm.Ringing);
        Assert.Empty(d.State.Waiting);
    }

    [Fact]
    public async Task Three_failed_polls_in_a_row_mean_offline_and_one_success_clears_it()
    {
        var d = Make();
        _api.LastPoll = ApiResult<RequestsResponse>.Offline();
        await d.PollOnceAsync();
        await d.PollOnceAsync();
        Assert.False(d.State.Offline);
        await d.PollOnceAsync();
        Assert.True(d.State.Offline);

        _api.LastPoll = FakeApi.Ok();
        await d.PollOnceAsync();
        Assert.False(d.State.Offline);
        Assert.True(d.State.Loaded);
    }

    [Fact]
    public async Task A_rejected_session_signs_out_stops_the_sound_and_tells_the_app()
    {
        _api.LastPoll = FakeApi.Ok(NewRequest());
        var d = Make();
        var signedOut = 0;
        d.SignedOut += () => signedOut++;
        await d.PollOnceAsync();
        Assert.True(_alarm.Ringing);

        _api.LastPoll = ApiResult<RequestsResponse>.Unauthorized();
        await d.PollOnceAsync();
        Assert.False(_session.IsLoggedIn);
        Assert.False(_alarm.Ringing);
        Assert.Equal(1, signedOut);
        Assert.False(d.State.Loaded);
    }

    [Fact]
    public async Task No_polling_after_signing_out()
    {
        var d = Make();
        _session.IsLoggedIn = false;
        await d.PollOnceAsync();
        Assert.Equal(0, _api.PollCount);
    }

    [Fact]
    public async Task The_clock_offset_is_server_minus_local()
    {
        var response = new RequestsResponse { ServerNow = "2026-11-05T10:02:00Z" }; // local clock says 10:00:00
        _api.LastPoll = ApiResult<RequestsResponse>.Ok(response);
        var d = Make();
        await d.PollOnceAsync();
        Assert.Equal(120_000, d.State.ClockOffsetMs);
    }

    [Fact]
    public async Task A_successful_action_returns_null_and_refreshes()
    {
        _api.LastPoll = FakeApi.Ok(NewRequest());
        var d = Make();
        var before = _api.PollCount;
        var message = await d.ActAsync("a", TaxiAction.Accept);
        Assert.Null(message);
        Assert.Equal(("a", "ACCEPT"), _api.Acts.Single());
        Assert.Equal(before + 1, _api.PollCount);
    }

    [Fact]
    public async Task A_refused_action_returns_the_servers_message_and_refreshes()
    {
        _api.ActResult = ApiResult<ActionResponse>.Failed(409, "TAKSI_SOROVI_ESKIRGAN", "Bu amal eskirgan. Ro‘yxatni yangilang.");
        _api.LastPoll = FakeApi.Ok(NewRequest());
        var d = Make();
        var before = _api.PollCount;
        var message = await d.ActAsync("a", TaxiAction.Accept);
        Assert.Equal("Bu amal eskirgan. Ro‘yxatni yangilang.", message);
        Assert.Equal(before + 1, _api.PollCount);
    }

    [Theory]
    [InlineData(ApiStatus.Offline, "Internet yo‘q. Qayta urinib ko‘ring.")]
    [InlineData(ApiStatus.Locked, "Biroz kuting.")]
    public async Task Action_failures_without_a_server_message(ApiStatus status, string expected)
    {
        _api.ActResult = status == ApiStatus.Offline ? ApiResult<ActionResponse>.Offline() : ApiResult<ActionResponse>.Locked(10);
        var d = Make();
        Assert.Equal(expected, await d.ActAsync("a", TaxiAction.Accept));
    }

    [Fact]
    public async Task An_action_answered_with_401_signs_out()
    {
        _api.ActResult = ApiResult<ActionResponse>.Unauthorized();
        var d = Make();
        var signedOut = 0;
        d.SignedOut += () => signedOut++;
        Assert.Equal("Sessiya tugagan. Qayta kiring.", await d.ActAsync("a", TaxiAction.Accept));
        Assert.Equal(1, signedOut);
        Assert.False(_session.IsLoggedIn);
    }
}
