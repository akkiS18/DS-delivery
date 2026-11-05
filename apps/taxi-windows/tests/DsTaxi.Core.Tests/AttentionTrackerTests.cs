using DsTaxi.Core.Api;
using DsTaxi.Core.Dispatch;
using Xunit;

namespace DsTaxi.Core.Tests;

public class AttentionTrackerTests
{
    internal static RequestDto Req(string id, string status, bool attention) => new()
    {
        Id = id, OrderCode = "K7M2Q", Status = status, Attention = attention,
        CreatedAt = "2026-01-01T10:00:00Z", UpdatedAt = "2026-01-01T10:00:00Z",
    };

    [Fact]
    public void A_new_request_rings_at_once()
    {
        var t = new AttentionTracker();
        Assert.Equal(new[] { "a:REQUESTED" }, t.Update(new[] { Req("a", "REQUESTED", true) }, now: 0));
    }

    [Fact]
    public void Requests_that_need_no_answer_never_ring()
    {
        var t = new AttentionTracker();
        Assert.Empty(t.Update(new[] { Req("a", "ACCEPTED", false), Req("b", "ASSIGNED", false) }, 0));
    }

    [Fact]
    public void Silence_mutes_for_the_set_time_and_then_it_rings_again()
    {
        var t = new AttentionTracker(silenceMs: 30_000);
        var list = new[] { Req("a", "REQUESTED", true) };
        t.Update(list, 0);
        t.Silence(1_000);
        Assert.Empty(t.Update(list, 5_000));
        Assert.Empty(t.Update(list, 30_999));
        Assert.Equal(new[] { "a:REQUESTED" }, t.Update(list, 31_000));
    }

    [Fact]
    public void A_silenced_request_that_changes_state_rings_again_at_once()
    {
        var t = new AttentionTracker();
        t.Update(new[] { Req("a", "REQUESTED", true) }, 0);
        t.Silence(0);
        Assert.Equal(new[] { "a:CANCELLATION_PENDING" }, t.Update(new[] { Req("a", "CANCELLATION_PENDING", true) }, 1_000));
    }

    [Fact]
    public void A_new_request_rings_even_while_another_one_is_silenced()
    {
        var t = new AttentionTracker();
        t.Update(new[] { Req("a", "REQUESTED", true) }, 0);
        t.Silence(0);
        var ringing = t.Update(new[] { Req("a", "REQUESTED", true), Req("b", "REQUESTED", true) }, 1_000);
        Assert.Equal(new[] { "b:REQUESTED" }, ringing);
        Assert.Equal(new[] { "a:REQUESTED", "b:REQUESTED" }, t.Pending().OrderBy(x => x));
    }

    [Fact]
    public void Answering_stops_the_ringing_and_forgets_the_silence()
    {
        var t = new AttentionTracker();
        t.Update(new[] { Req("a", "REQUESTED", true) }, 0);
        t.Silence(0);
        Assert.Empty(t.Update(new[] { Req("a", "ACCEPTED", false) }, 1_000));
        Assert.Empty(t.Pending());
        // the same id coming back as a new question rings (it is a different key/state)
        Assert.Equal(new[] { "a:NEEDS_HELP" }, t.Update(new[] { Req("a", "NEEDS_HELP", true) }, 2_000));
    }
}
