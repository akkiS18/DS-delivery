using DsTaxi.Core.Api;
using DsTaxi.Core.Format;
using DsTaxi.Core.Versioning;
using Xunit;

namespace DsTaxi.Core.Tests;

public class UpdateCheckTests
{
    private static WindowsClientConfig Config(string? min = null, string? latest = null, string? url = null) =>
        new() { MinVersion = min, LatestVersion = latest, DownloadUrl = url };

    [Fact]
    public void No_rule_means_no_update()
    {
        Assert.Equal(UpdateLevel.None, UpdateCheck.Evaluate("1.0.0", Config()).Level);
        Assert.Equal(UpdateLevel.None, UpdateCheck.Evaluate("1.0.0", null).Level);
    }

    [Fact]
    public void Older_than_minimum_is_required_and_keeps_the_link()
    {
        var s = UpdateCheck.Evaluate("1.0.0", Config(min: "1.2.0", latest: "1.3.0", url: "https://x.uz/setup.exe"));
        Assert.Equal(UpdateLevel.Required, s.Level);
        Assert.Equal("https://x.uz/setup.exe", s.DownloadUrl);
        Assert.Equal("1.3.0", s.LatestVersion);
    }

    [Fact]
    public void Older_than_latest_only_is_a_hint()
    {
        Assert.Equal(UpdateLevel.Available, UpdateCheck.Evaluate("1.2.0", Config(min: "1.0.0", latest: "1.3.0")).Level);
    }

    [Fact]
    public void Equal_or_newer_is_fine_and_ten_is_bigger_than_nine()
    {
        Assert.Equal(UpdateLevel.None, UpdateCheck.Evaluate("1.3.0", Config(min: "1.3.0", latest: "1.3.0")).Level);
        Assert.Equal(UpdateLevel.None, UpdateCheck.Evaluate("1.10.0", Config(min: "1.9.0")).Level);
        Assert.Equal(UpdateLevel.None, UpdateCheck.Evaluate("1.2.3.0", Config(min: "1.2.3")).Level);
    }

    [Fact]
    public void Garbage_never_blocks()
    {
        Assert.Equal(UpdateLevel.None, UpdateCheck.Evaluate("1.0.0", Config(min: "soon", latest: "")).Level);
        Assert.Equal(UpdateLevel.None, UpdateCheck.Evaluate("weird", Config(min: "9.9.9")).Level);
    }
}

public class HistoryFilterTests
{
    private static RequestDto R(string code, string status, string restaurant, string address, string updated) => new()
    {
        Id = code, OrderCode = code, Status = status, UpdatedAt = updated,
        Restaurant = new RestaurantInfo { Name = restaurant },
        Delivery = new DeliveryInfo { Address = address },
    };

    private static readonly RequestDto[] Rows =
    {
        R("1001", "DELIVERED", "Sifat Food", "Chilonzor 5", "2026-11-05T10:00:00Z"),
        R("1002", "CANCELLED", "Osh markazi", "Yunusobod 3", "2026-11-05T11:00:00Z"),
        R("1003", "DECLINED", "Sifat Food", "Mirzo Ulugbek 9", "2026-11-05T12:00:00Z"),
        R("1004", "DELIVERED", "Osh markazi", "Chilonzor 7", "2026-11-05T13:00:00Z"),
    };

    [Fact]
    public void Newest_first_and_no_filter_keeps_everything()
    {
        var all = HistoryFilter.Apply(Rows, null, HistoryKind.All);
        Assert.Equal(new[] { "1004", "1003", "1002", "1001" }, all.Select(r => r.OrderCode));
    }

    [Fact]
    public void Kind_filter()
    {
        Assert.Equal(new[] { "1004", "1001" }, HistoryFilter.Apply(Rows, "", HistoryKind.Delivered).Select(r => r.OrderCode));
        Assert.Equal(new[] { "1003", "1002" }, HistoryFilter.Apply(Rows, "", HistoryKind.Closed).Select(r => r.OrderCode));
    }

    [Fact]
    public void Search_by_code_restaurant_or_address_ignoring_case_and_the_hash_sign()
    {
        Assert.Equal(new[] { "1002" }, HistoryFilter.Apply(Rows, "#1002", HistoryKind.All).Select(r => r.OrderCode));
        Assert.Equal(new[] { "1003", "1001" }, HistoryFilter.Apply(Rows, "sifat", HistoryKind.All).Select(r => r.OrderCode));
        Assert.Equal(new[] { "1004", "1001" }, HistoryFilter.Apply(Rows, "CHILONZOR", HistoryKind.All).Select(r => r.OrderCode));
        Assert.Empty(HistoryFilter.Apply(Rows, "yo‘q-bunday", HistoryKind.All));
    }

    [Fact]
    public void Summary_counts_outcomes()
    {
        Assert.Equal("So‘nggi 24 soat: 2 ta yetkazildi, 2 ta rad etildi/bekor qilindi", HistoryFilter.Summary(Rows));
        Assert.Equal("So‘nggi 24 soat", HistoryFilter.Summary(Array.Empty<RequestDto>()));
    }
}

public class DayClockTests
{
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-11-06T10:00:00Z"); // 15:00 in Tashkent

    [Fact]
    public void Today_yesterday_and_older()
    {
        Assert.Equal("Bugun 14:05", Fmt.DayClockOf("2026-11-06T09:05:00Z", Now));
        Assert.Equal("Kecha 22:10", Fmt.DayClockOf("2026-11-05T17:10:00Z", Now));
        Assert.Equal("03.11 09:12", Fmt.DayClockOf("2026-11-03T04:12:00Z", Now));
        Assert.Null(Fmt.DayClockOf(null, Now));
    }

    [Fact]
    public void Keyboard_confirmation_uses_the_buttons_own_words()
    {
        Assert.Equal("Qabul qilasizmi?", Fmt.KeyboardConfirmTexts(TaxiAction.Accept, "REQUESTED").Title);
        Assert.Equal("Ha, yuborildi", Fmt.KeyboardConfirmTexts(TaxiAction.Sent, "ACCEPTED").Yes);
    }
}
