using System.Globalization;

namespace DsRestaurant.Core.Common;

public enum Urgency
{
    Calm,
    Soon,
    Late
}

public record ServerClock(long ServerNowMillis, long ReceivedAtElapsed)
{
    public long Now(long nowElapsed) => ServerNowMillis + (nowElapsed - ReceivedAtElapsed);
}

public record PrepDisplay(string Text, string? Detail, bool Overdue, long RemainingSeconds);

public record PrepInfo(
    int Minutes,
    long? StartedAtMillis,
    long? EstimatedReadyAtMillis,
    long ServerNowMillis,
    long ReceivedAtElapsed,
    int? ChosenMinutes = null)
{
    public long? RemainingSeconds(long nowElapsed)
    {
        if (EstimatedReadyAtMillis == null) return null;
        long serverNow = ServerNowMillis + (nowElapsed - ReceivedAtElapsed);
        long diff = EstimatedReadyAtMillis.Value - serverNow;
        return diff >= 0 ? (diff + 999) / 1000 : -((-diff) / 1000);
    }

    public PrepDisplay? Display(long nowElapsed)
    {
        long? remaining = RemainingSeconds(nowElapsed);
        if (remaining == null) return null;

        long r = remaining.Value;
        long? readyAt = EstimatedReadyAtMillis;

        if (r > 0)
        {
            string detail = readyAt != null ? $"Taxminiy tayyor: {ServerClockHelper.FormatClock(readyAt.Value)}" : null!;
            return new PrepDisplay($"Qolgan vaqt: {ServerClockHelper.MmSs(r)}", detail, false, r);
        }
        else
        {
            long minutes = Math.Max(1, ServerClockHelper.OverdueMinutes(r));
            string sched = readyAt != null ? $" • rejalashtirilgan {ServerClockHelper.FormatClock(readyAt.Value)}" : "";
            string detail = $"Kechikish {ServerClockHelper.MmSs(r)}{sched}";
            return new PrepDisplay($"Kechikish: {minutes} daqiqa", detail, true, r);
        }
    }
}

public static class ServerClockHelper
{
    private static readonly TimeZoneInfo TashkentTz;

    static ServerClockHelper()
    {
        try
        {
            TashkentTz = TimeZoneInfo.FindSystemTimeZoneById("West Asia Standard Time");
        }
        catch
        {
            try
            {
                TashkentTz = TimeZoneInfo.FindSystemTimeZoneById("Asia/Tashkent");
            }
            catch
            {
                TashkentTz = TimeZoneInfo.CreateCustomTimeZone("Tashkent", TimeSpan.FromHours(5), "Tashkent", "Tashkent");
            }
        }
    }

    public static DateTimeOffset NowTashkent()
    {
        return TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, TashkentTz);
    }

    public static string MmSs(long totalSeconds)
    {
        long s = Math.Abs(totalSeconds);
        return $"{s / 60}:{s % 60:D2}";
    }

    public static long? ParseIsoMillis(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        return DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var dto)
            ? dto.ToUnixTimeMilliseconds()
            : null;
    }

    public static string FormatClock(long millis)
    {
        var dto = DateTimeOffset.FromUnixTimeMilliseconds(millis);
        var inTashkent = TimeZoneInfo.ConvertTime(dto, TashkentTz);
        return inTashkent.ToString("HH:mm", CultureInfo.InvariantCulture);
    }

    public static long? AgeMinutes(long? createdAtMillis, ServerClock? clock, long nowElapsed)
    {
        if (createdAtMillis == null || clock == null) return null;
        long minutes = (clock.Now(nowElapsed) - createdAtMillis.Value) / 60_000L;
        return Math.Max(0, minutes);
    }

    public static Urgency UrgencyOf(long? ageMinutes)
    {
        if (ageMinutes == null || ageMinutes < 5) return Urgency.Calm;
        if (ageMinutes < 10) return Urgency.Soon;
        return Urgency.Late;
    }

    public static string? AgeText(long? createdAtMillis, ServerClock? clock, long nowElapsed)
    {
        long? minutes = AgeMinutes(createdAtMillis, clock, nowElapsed);
        if (minutes == null) return null;

        long m = minutes.Value;
        if (m < 1) return "hozirgina";
        if (m < 60) return $"{m} daq oldin";
        if (m < 24 * 60)
        {
            long h = m / 60;
            long rem = m % 60;
            return rem == 0 ? $"{h} soat oldin" : $"{h} soat {rem} daq oldin";
        }
        return $"{m / (24 * 60)} kun oldin";
    }

    public static long OverdueMinutes(long remainingSeconds) =>
        remainingSeconds >= 0 ? 0 : ((-remainingSeconds) + 59) / 60;
}
