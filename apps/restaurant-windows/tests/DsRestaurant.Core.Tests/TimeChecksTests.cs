using DsRestaurant.Core.Common;
using DsRestaurant.Core.Orders;
using FluentAssertions;
using Xunit;

namespace DsRestaurant.Core.Tests;

public class TimeChecksTests
{
    [Fact]
    public void CountdownBeforeEstimate()
    {
        long serverNow = ServerClockHelper.ParseIsoMillis("2026-10-18T10:00:00Z")!.Value;
        long ready = serverNow + 25 * 60_000L;
        long received = 5_000L;
        var prep = new PrepInfo(25, serverNow, ready, serverNow, received);

        long At(long secondsAfterReceive) => received + secondsAfterReceive * 1000;

        prep.Display(At(0))!.Text.Should().Be("Qolgan vaqt: 25:00");
        prep.Display(At(60))!.Text.Should().Be("Qolgan vaqt: 24:00");
        prep.Display(At(25 * 60 - 1))!.Text.Should().Be("Qolgan vaqt: 0:01");
        prep.Display(At(25 * 60 - 1))!.Overdue.Should().BeFalse();
        prep.Display(At(0))!.Detail.Should().Be("Taxminiy tayyor: 15:25");
    }

    [Fact]
    public void WhenReachingZeroAndOverdue()
    {
        long serverNow = ServerClockHelper.ParseIsoMillis("2026-10-18T10:00:00Z")!.Value;
        long ready = serverNow + 25 * 60_000L;
        long received = 5_000L;
        var prep = new PrepInfo(25, serverNow, ready, serverNow, received);

        long At(long secondsAfterReceive) => received + secondsAfterReceive * 1000;

        prep.Display(At(25 * 60))!.Overdue.Should().BeTrue();
        prep.Display(At(25 * 60))!.Text.Should().Be("Kechikish: 1 daqiqa");
        prep.Display(At(25 * 60 + 1))!.Text.Should().Be("Kechikish: 1 daqiqa");
        prep.Display(At(25 * 60 + 59))!.Text.Should().Be("Kechikish: 1 daqiqa");
        prep.Display(At(26 * 60))!.Text.Should().Be("Kechikish: 1 daqiqa");
        prep.Display(At(26 * 60 + 1))!.Text.Should().Be("Kechikish: 2 daqiqa");
        prep.Display(At(32 * 60))!.Text.Should().Be("Kechikish: 7 daqiqa");
        prep.Display(At(32 * 60 + 42))!.Detail.Should().Be("Kechikish 7:42 • rejalashtirilgan 15:25");
        prep.Display(At(25 * 60 + 2 * 3600))!.Text.Should().Be("Kechikish: 120 daqiqa");
    }

    [Fact]
    public void ClockIndependenceAndResume()
    {
        long serverNow = ServerClockHelper.ParseIsoMillis("2026-10-18T10:00:00Z")!.Value;
        long ready = serverNow + 25 * 60_000L;
        long received = 5_000L;
        var prep = new PrepInfo(25, serverNow, ready, serverNow, received);

        long At(long secondsAfterReceive) => received + secondsAfterReceive * 1000;

        prep.Display(At(600))!.Text.Should().Be(prep.Display(At(600))!.Text);
        prep.Display(At(40 * 60))!.Text.Should().Be("Kechikish: 15 daqiqa");

        var refreshed = new PrepInfo(25, serverNow, ready, serverNow + 31 * 60_000L, 900_000L);
        refreshed.Display(900_000L)!.Text.Should().Be("Kechikish: 6 daqiqa");
    }

    [Fact]
    public void EdgeCases()
    {
        long serverNow = ServerClockHelper.ParseIsoMillis("2026-10-18T10:00:00Z")!.Value;
        new PrepInfo(25, null, null, serverNow, 0L).Display(1000L).Should().BeNull();

        ServerClockHelper.OverdueMinutes(0).Should().Be(0L);
        ServerClockHelper.OverdueMinutes(-1).Should().Be(1L);
        ServerClockHelper.OverdueMinutes(-60).Should().Be(1L);
        ServerClockHelper.OverdueMinutes(-61).Should().Be(2L);
    }

    [Fact]
    public void OrderAgeAndTimestamps()
    {
        long serverNow = ServerClockHelper.ParseIsoMillis("2026-10-18T10:00:00Z")!.Value;
        long received = 5_000L;
        var clock = new ServerClock(serverNow, received);
        long created = serverNow - 7 * 60_000L;

        ServerClockHelper.AgeText(created, clock, received).Should().Be("7 daq oldin");
        ServerClockHelper.AgeText(created, clock, received + 60_000L).Should().Be("8 daq oldin");
        ServerClockHelper.AgeText(serverNow - 20_000L, clock, received).Should().Be("hozirgina");
        ServerClockHelper.AgeText(serverNow - 65 * 60_000L, clock, received).Should().Be("1 soat 5 daq oldin");
        ServerClockHelper.AgeText(serverNow - 120 * 60_000L, clock, received).Should().Be("2 soat oldin");
        ServerClockHelper.AgeText(serverNow - 3 * 24 * 3600_000L, clock, received).Should().Be("3 kun oldin");
        ServerClockHelper.AgeText(null, clock, received).Should().BeNull();
        ServerClockHelper.FormatClock(serverNow).Should().Be("15:00");
    }

    [Fact]
    public void UrgencyRules()
    {
        long serverNow = ServerClockHelper.ParseIsoMillis("2026-10-18T10:00:00Z")!.Value;
        long received = 5_000L;
        var clock = new ServerClock(serverNow, received);
        long created = serverNow - 7 * 60_000L;

        ServerClockHelper.AgeMinutes(created, clock, received).Should().Be(7L);
        ServerClockHelper.AgeMinutes(null, clock, received).Should().BeNull();
        ServerClockHelper.AgeMinutes(serverNow + 60_000L, clock, received).Should().Be(0L);

        ServerClockHelper.UrgencyOf(0).Should().Be(Urgency.Calm);
        ServerClockHelper.UrgencyOf(4).Should().Be(Urgency.Calm);
        ServerClockHelper.UrgencyOf(5).Should().Be(Urgency.Soon);
        ServerClockHelper.UrgencyOf(9).Should().Be(Urgency.Soon);
        ServerClockHelper.UrgencyOf(10).Should().Be(Urgency.Late);
        ServerClockHelper.UrgencyOf(null).Should().Be(Urgency.Calm);
    }

    [Fact]
    public void KitchenBellAttention()
    {
        var bell = new NewOrderAttention(silenceMs: 30_000L);

        bell.Update([], 0L).Should().BeEmpty();
        bell.Update(["a"], 1_000L).Should().Equal("a");

        bell.Silence(2_000L);
        bell.Ringing(10_000L).Should().BeEmpty();

        bell.Update(["a", "b"], 10_000L).Should().Equal("b");
        bell.Ringing(40_000L).Should().Contain("a");

        bell.Silence(41_000L);
        bell.Update(["b"], 42_000L).Should().BeEmpty();
        bell.Update(["a", "b"], 43_000L).Should().Equal("a");

        bell.Update([], 44_000L).Should().BeEmpty();
        bell.Pending().Should().BeEmpty();
    }
}
