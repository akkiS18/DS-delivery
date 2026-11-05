using DsTaxi.Core.Api;
using DsTaxi.Core.Format;
using Xunit;

namespace DsTaxi.Core.Tests;

public class FormatTests
{
    private const string N = " ";

    [Theory]
    [InlineData(0, "0" + N + "so‘m")]
    [InlineData(950, "950" + N + "so‘m")]
    [InlineData(55_000, "55" + N + "000" + N + "so‘m")]
    [InlineData(1_250_000, "1" + N + "250" + N + "000" + N + "so‘m")]
    [InlineData(-5_000, "−5" + N + "000" + N + "so‘m")]
    public void Som_groups_thousands(int amount, string expected) => Assert.Equal(expected, Fmt.Som(amount));

    [Theory]
    [InlineData(0, "0:00")]
    [InlineData(5, "0:05")]
    [InlineData(65, "1:05")]
    [InlineData(-9, "0:00")]
    public void Mmss_is_never_negative(long seconds, string expected) => Assert.Equal(expected, Fmt.Mmss(seconds));

    [Theory]
    [InlineData("REQUESTED", "Yangi so‘rov", Tone.Urgent)]
    [InlineData("CANCELLATION_PENDING", "Javob kechikdi — aniqlashtiring", Tone.Urgent)]
    [InlineData("NEEDS_HELP", "Aniqlashtirish kerak", Tone.Urgent)]
    [InlineData("ACCEPTED", "Qabul qilingan — haydovchi yuboring", Tone.Warn)]
    [InlineData("ASSIGNED", "Taksi yo‘lda", Tone.Ok)]
    [InlineData("DELIVERED", "Yetkazildi", Tone.Ok)]
    [InlineData("DECLINED", "Rad etilgan", Tone.Neutral)]
    [InlineData("CANCELLED", "Bekor qilingan", Tone.Neutral)]
    [InlineData("SOMETHING_NEW", "SOMETHING_NEW", Tone.Neutral)]
    public void Status_look(string status, string label, Tone tone) => Assert.Equal(new StatusLook(label, tone), Fmt.StatusLookOf(status));

    [Theory]
    [InlineData("ACCEPT", "REQUESTED", "Qabul qilish")]
    [InlineData("NO_TAXI", "REQUESTED", "Rad etish")]
    [InlineData("SENT", "ACCEPTED", "Taksi yuborildi")]
    [InlineData("NO_TAXI", "ACCEPTED", "Taksi yo‘q")]
    [InlineData("SENT", "NEEDS_HELP", "Haydovchi yuborilgan")]
    [InlineData("DELIVERED", "ASSIGNED", "Yetkazildi")]
    public void Action_label(string action, string status, string expected) => Assert.Equal(expected, Fmt.ActionLabel(action, status));

    [Fact]
    public void Only_no_taxi_and_delivered_need_a_confirmation()
    {
        Assert.True(Fmt.NeedsConfirm(TaxiAction.NoTaxi));
        Assert.True(Fmt.NeedsConfirm(TaxiAction.Delivered));
        Assert.False(Fmt.NeedsConfirm(TaxiAction.Accept));
        Assert.False(Fmt.NeedsConfirm(TaxiAction.Sent));
    }

    [Fact]
    public void Delivered_is_disabled_while_the_server_gives_a_reason()
    {
        var blocked = new RequestDto { Id = "a", Status = "ASSIGNED", DeliverBlockedReason = "Taom hali tayyor emas." };
        var free = new RequestDto { Id = "a", Status = "ASSIGNED" };
        Assert.False(Fmt.ActionEnabled(TaxiAction.Delivered, blocked, busy: false));
        Assert.True(Fmt.ActionEnabled(TaxiAction.Delivered, free, busy: false));
        Assert.False(Fmt.ActionEnabled(TaxiAction.Delivered, free, busy: true));
        Assert.True(Fmt.ActionEnabled(TaxiAction.Sent, blocked, busy: false));
    }

    [Fact]
    public void Dialable_drops_spaces_and_dashes() => Assert.Equal("+998901234567", Fmt.Dialable("+998 90 123-45-67"));

    [Fact]
    public void A_map_link_needs_real_coordinates()
    {
        Assert.Null(Fmt.MapUrl(null, 69.2));
        Assert.Null(Fmt.MapUrl(41.3, null));
        Assert.Equal("https://www.google.com/maps?q=41.311081,69.240562", Fmt.MapUrl(41.311081, 69.240562));
    }

    [Fact]
    public void Clock_is_shown_in_Uzbekistan_time()
    {
        Assert.Equal("15:30", Fmt.ClockOf("2026-11-05T10:30:00Z")); // UTC+5
        Assert.Null(Fmt.ClockOf(null));
        Assert.Null(Fmt.ClockOf("not a date"));
    }

    [Fact]
    public void Countdown_follows_the_server_clock_not_the_pc_clock()
    {
        // The PC clock is 2 minutes slow: the server is 120 s ahead of it.
        var local = new DateTimeOffset(2026, 11, 5, 10, 0, 0, TimeSpan.Zero);
        const long offsetMs = 120_000;
        // Deadline 10:03:00Z by the server = 3 minutes of server time; server now is 10:02:00 -> 60 s left.
        Assert.Equal(60, Fmt.SecondsLeft("2026-11-05T10:03:00Z", local, offsetMs));
        Assert.Equal(-30, Fmt.SecondsLeft("2026-11-05T10:01:30Z", local, offsetMs));
        Assert.Null(Fmt.SecondsLeft(null, local, 0));
    }

    [Fact]
    public void Answer_timer_text()
    {
        Assert.Equal("Javob muddati: 1:05", Fmt.AnswerTimerText(65));
        Assert.Equal("Javob muddati o‘tdi — hoziroq javob bering", Fmt.AnswerTimerText(0));
    }

    [Fact]
    public void Requests_that_wait_for_an_answer_come_first_oldest_first()
    {
        var older = new RequestDto { Id = "old", Status = "REQUESTED", Attention = true, CreatedAt = "2026-01-01T10:00:00Z", UpdatedAt = "2026-01-01T10:00:00Z" };
        var newer = new RequestDto { Id = "new", Status = "REQUESTED", Attention = true, CreatedAt = "2026-01-01T10:05:00Z", UpdatedAt = "2026-01-01T10:05:00Z" };
        var onTheWay = new RequestDto { Id = "way", Status = "ASSIGNED", Attention = false, CreatedAt = "2026-01-01T09:00:00Z", UpdatedAt = "2026-01-01T10:30:00Z" };
        var accepted = new RequestDto { Id = "acc", Status = "ACCEPTED", Attention = false, CreatedAt = "2026-01-01T09:30:00Z", UpdatedAt = "2026-01-01T10:40:00Z" };
        var order = Fmt.SortActive(new[] { onTheWay, newer, accepted, older }).Select(r => r.Id).ToArray();
        Assert.Equal(new[] { "old", "new", "acc", "way" }, order);
    }

    [Theory]
    [InlineData(ApiStatus.Failed, 401, 0, "Login yoki parol noto‘g‘ri.")]
    [InlineData(ApiStatus.Failed, 403, 0, "Bu kompaniya o‘chirilgan. Administrator bilan bog‘laning.")]
    [InlineData(ApiStatus.Failed, 500, 0, "Kirib bo‘lmadi. Birozdan keyin qayta urinib ko‘ring.")]
    [InlineData(ApiStatus.Offline, 0, 0, "Internet yo‘q. Ulanishni tekshiring.")]
    [InlineData(ApiStatus.Locked, 429, 900, "Juda ko‘p noto‘g‘ri urinish. 15 daqiqadan keyin qayta urinib ko‘ring.")]
    [InlineData(ApiStatus.Locked, 429, 61, "Juda ko‘p noto‘g‘ri urinish. 2 daqiqadan keyin qayta urinib ko‘ring.")]
    public void Login_error_texts_match_the_phone(ApiStatus status, int http, int retry, string expected) =>
        Assert.Equal(expected, Fmt.LoginErrorText(status, http, retry));

    [Fact]
    public void Food_and_payment_lines()
    {
        var ready = new RequestDto { Food = new FoodInfo { Ready = true, ReadyAt = "2026-11-05T10:30:00Z", TotalSom = 55_000 } };
        var cooking = new RequestDto { Food = new FoodInfo { Ready = false } };
        Assert.Equal("Taom: TAYYOR (15:30)", Fmt.FoodLine(ready));
        Assert.Equal("Taom: tayyorlanmoqda", Fmt.FoodLine(cooking));
        Assert.Equal("Taom narxi: 55" + N + "000" + N + "so‘m (yetkazish haqi emas — uni taksi xizmatingiz belgilaydi)", Fmt.FoodPriceLine(ready));
        Assert.Equal("NAQD: restoranga 55" + N + "000" + N + "so‘m to‘lanadi", Fmt.CashHeadline(new PaymentInfo { Method = "CASH", PayRestaurantSom = 55_000 }));
    }

    [Fact]
    public void Duty_text()
    {
        Assert.Equal("2 ta so‘rov javob kutmoqda", Fmt.DutyText(3, 2));
        Assert.Equal("3 ta faol buyurtma", Fmt.DutyText(3, 0));
        Assert.Equal("Yangi so‘rovlarni kutyapman", Fmt.DutyText(0, 0));
    }
}
