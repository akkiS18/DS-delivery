using DsRestaurant.Core.Finance;
using FluentAssertions;
using Xunit;

namespace DsRestaurant.Core.Tests;

public class HistoryFilterTests
{
    [Fact]
    public void AllPeriod_ReturnsNullBounds()
    {
        var (from, to) = HistoryPeriod.All.GetRange();
        from.Should().BeNull();
        to.Should().BeNull();
    }

    [Fact]
    public void TodayPeriod_ReturnsSameDate()
    {
        var refDate = new DateOnly(2026, 11, 6);
        var (from, to) = HistoryPeriod.Today.GetRange(refDate);
        from.Should().Be("2026-11-06");
        to.Should().Be("2026-11-06");
    }

    [Fact]
    public void Last7Days_IncludesTodayAndSixDaysPrior()
    {
        var refDate = new DateOnly(2026, 11, 6);
        var (from, to) = HistoryPeriod.Last7Days.GetRange(refDate);
        from.Should().Be("2026-10-31");
        to.Should().Be("2026-11-06");
    }

    [Fact]
    public void ThisMonth_StartsAtFirstOfMonth()
    {
        var refDate = new DateOnly(2026, 11, 6);
        var (from, to) = HistoryPeriod.ThisMonth.GetRange(refDate);
        from.Should().Be("2026-11-01");
        to.Should().Be("2026-11-06");
    }

    [Fact]
    public void ThisMonth_FirstDayOfMonth_StartsAndEndsOnFirst()
    {
        var refDate = new DateOnly(2026, 11, 1);
        var (from, to) = HistoryPeriod.ThisMonth.GetRange(refDate);
        from.Should().Be("2026-11-01");
        to.Should().Be("2026-11-01");
    }

    [Fact]
    public void HistorySource_QueryValuesMatchApi()
    {
        HistorySource.All.GetQuery().Should().Be("all");
        HistorySource.Card.GetQuery().Should().Be("card");
        HistorySource.Cash.GetQuery().Should().Be("cash");
    }
}
