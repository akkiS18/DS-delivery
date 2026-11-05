using System.Globalization;
using DsTaxi.Core.Api;

namespace DsTaxi.Core.Format;

public enum Tone { Urgent, Warn, Ok, Neutral }

public sealed record StatusLook(string Label, Tone Tone);

/// <summary>Texts and small formatters shared by the screens. Port of ui/Format.kt; wording is the phone app's.</summary>
public static class Fmt
{
    private const char Nbsp = ' ';

    /// <summary>"55 000 so‘m" (non-breaking spaces between thousands, so a number never breaks across lines).</summary>
    public static string Som(int amount)
    {
        var digits = Math.Abs((long)amount).ToString(CultureInfo.InvariantCulture);
        var sb = new System.Text.StringBuilder();
        if (amount < 0) sb.Append('−');
        for (var i = 0; i < digits.Length; i++)
        {
            if (i > 0 && (digits.Length - i) % 3 == 0) sb.Append(Nbsp);
            sb.Append(digits[i]);
        }
        return sb.Append(Nbsp).Append("so‘m").ToString();
    }

    /// <summary>m:ss, never negative.</summary>
    public static string Mmss(long totalSeconds)
    {
        var s = Math.Max(0, totalSeconds);
        return $"{s / 60}:{s % 60:00}";
    }

    public static StatusLook StatusLookOf(string status) => status switch
    {
        "REQUESTED" => new("Yangi so‘rov", Tone.Urgent),
        "CANCELLATION_PENDING" => new("Javob kechikdi — aniqlashtiring", Tone.Urgent),
        "NEEDS_HELP" => new("Aniqlashtirish kerak", Tone.Urgent),
        "ACCEPTED" => new("Qabul qilingan — haydovchi yuboring", Tone.Warn),
        "ASSIGNED" => new("Taksi yo‘lda", Tone.Ok),
        "DELIVERED" => new("Yetkazildi", Tone.Ok),
        "DECLINED" => new("Rad etilgan", Tone.Neutral),
        "CANCELLED" => new("Bekor qilingan", Tone.Neutral),
        _ => new(status, Tone.Neutral), // an unknown status is shown as it is, never a crash
    };

    public static string ActionLabel(string action, string status) => action switch
    {
        TaxiAction.Accept => "Qabul qilish",
        TaxiAction.Sent => status == "ACCEPTED" ? "Taksi yuborildi" : "Haydovchi yuborilgan",
        TaxiAction.NoTaxi => status == "REQUESTED" ? "Rad etish" : "Taksi yo‘q",
        TaxiAction.Delivered => "Yetkazildi",
        _ => action,
    };

    /// <summary>The primary (yellow) buttons; "no taxi" is the red outline one.</summary>
    public static bool IsPrimary(string action) => action != TaxiAction.NoTaxi;

    /// <summary>Actions that need the "are you sure" dialog first.</summary>
    public static bool NeedsConfirm(string action) => action is TaxiAction.NoTaxi or TaxiAction.Delivered;

    public static (string Title, string Body, string Yes) ConfirmTexts(string action) => action == TaxiAction.Delivered
        ? ("Yetkazildimi?", "Buyurtma mijozga haqiqatan topshirildimi? Tasdiqlasangiz buyurtma yakunlanadi, qaytarib bo‘lmaydi.", "Ha, yetkazildi")
        : ("Taksi yo‘qmi?", "Bu so‘rovga haydovchi yuborib bo‘lmasligini tasdiqlaysizmi? Mijoz roziligi bo‘lsa boshqa kompaniyaga murojaat qilinadi.", "Ha, taksi yo‘q");

    /// <summary>
    /// The question asked when a main button is pressed with the keyboard (Enter): one more look before it counts. The labels are the button's own words,
    /// so "Qabul qilish" asks "Qabul qilasizmi?". Actions that already have their own dialog keep it (see <see cref="NeedsConfirm"/>).
    /// </summary>
    public static (string Title, string Body, string Yes) KeyboardConfirmTexts(string action, string status) => action switch
    {
        TaxiAction.Accept => ("Qabul qilasizmi?", "Bu so‘rovni qabul qilasizmi?", "Ha, qabul qilaman"),
        TaxiAction.Sent => ("Taksi yuborildimi?", "Haydovchi shu buyurtmaga yuborildimi?", "Ha, yuborildi"),
        _ => (ActionLabel(action, status) + "?", "Tasdiqlaysizmi?", "Ha"),
    };

    /// <summary>"Delivered" is disabled while the server gives a reason (food not ready yet).</summary>
    public static bool ActionEnabled(string action, RequestDto r, bool busy) =>
        !busy && !(action == TaxiAction.Delivered && r.DeliverBlockedReason is not null);

    /// <summary>Phone numbers are dialled as typed; spaces and dashes are dropped.</summary>
    public static string Dialable(string phone) => new(phone.Where(c => char.IsAsciiDigit(c) || c == '+').ToArray());

    /// <summary>Only a place the customer/restaurant actually shared (coordinates) gets a map link: a typed address searched on a map is a guess.</summary>
    public static string? MapUrl(double? lat, double? lng) =>
        lat is null || lng is null ? null
            : string.Create(CultureInfo.InvariantCulture, $"https://www.google.com/maps?q={lat.Value},{lng.Value}");

    public static string FoodLine(RequestDto r)
    {
        var f = r.Food;
        if (f.Ready) return "Taom: TAYYOR" + (ClockOf(f.ReadyAt) is { } t ? $" ({t})" : "");
        if (f.EstimatedReadyAt is not null && ClockOf(f.EstimatedReadyAt) is { } e) return $"Taom: tayyorlanmoqda, taxminan {e} da tayyor";
        return "Taom: tayyorlanmoqda";
    }

    public static string FoodPriceLine(RequestDto r) =>
        $"Taom narxi: {Som(r.Food.TotalSom)} (yetkazish haqi emas — uni taksi xizmatingiz belgilaydi)";

    public static string CashHeadline(PaymentInfo p) => $"NAQD: restoranga {Som(p.PayRestaurantSom)} to‘lanadi";
    public const string CashHint = "Puli bor haydovchi yuboring. Shu summani mijozdan olasiz.";
    public const string CardLine = "Taom puli kartadan to‘langan — restoranga to‘lash shart emas";

    // ---- time (the operators work in Uzbekistan: UTC+5, no daylight saving; do not trust a wrong PC zone)
    private static readonly TimeZoneInfo Tashkent = FindTashkent();

    private static TimeZoneInfo FindTashkent()
    {
        foreach (var id in new[] { "Asia/Tashkent", "West Asia Standard Time" })
        {
            try { return TimeZoneInfo.FindSystemTimeZoneById(id); } catch (Exception e) when (e is TimeZoneNotFoundException or InvalidTimeZoneException) { }
        }
        return TimeZoneInfo.CreateCustomTimeZone("UTC+5", TimeSpan.FromHours(5), "UTC+5", "UTC+5");
    }

    /// <summary>"HH:mm" in Asia/Tashkent for an ISO-8601 string, or null.</summary>
    public static string? ClockOf(string? iso)
    {
        if (string.IsNullOrWhiteSpace(iso)) return null;
        if (!DateTimeOffset.TryParse(iso, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var t)) return null;
        return TimeZoneInfo.ConvertTime(t, Tashkent).ToString("HH:mm", CultureInfo.InvariantCulture);
    }

    /// <summary>"Bugun 14:05", "Kecha 22:10" or "05.11 09:12" (Asia/Tashkent) for the history list, or null.</summary>
    public static string? DayClockOf(string? iso, DateTimeOffset now)
    {
        if (string.IsNullOrWhiteSpace(iso)) return null;
        if (!DateTimeOffset.TryParse(iso, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var t)) return null;
        var local = TimeZoneInfo.ConvertTime(t, Tashkent);
        var today = TimeZoneInfo.ConvertTime(now, Tashkent).Date;
        var clock = local.ToString("HH:mm", CultureInfo.InvariantCulture);
        if (local.Date == today) return "Bugun " + clock;
        if (local.Date == today.AddDays(-1)) return "Kecha " + clock;
        return local.ToString("dd.MM", CultureInfo.InvariantCulture) + " " + clock;
    }

    /// <summary>Seconds left until <paramref name="answerByIso"/>, by the SERVER clock (local now + offset). Null when there is no deadline.</summary>
    public static long? SecondsLeft(string? answerByIso, DateTimeOffset localNow, long clockOffsetMs)
    {
        if (string.IsNullOrWhiteSpace(answerByIso)) return null;
        if (!DateTimeOffset.TryParse(answerByIso, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var end)) return null;
        var serverNow = localNow.AddMilliseconds(clockOffsetMs);
        return (long)Math.Floor((end - serverNow).TotalSeconds);
    }

    public static string AnswerTimerText(long secondsLeft) =>
        secondsLeft > 0 ? $"Javob muddati: {Mmss(secondsLeft)}" : "Javob muddati o‘tdi — hoziroq javob bering";

    /// <summary>Attention requests first (oldest first: the one waiting longest), then the rest by last change (newest first).</summary>
    public static IReadOnlyList<RequestDto> SortActive(IEnumerable<RequestDto> active) =>
        active.OrderBy(r => r.Attention ? 0 : 1)
              .ThenBy(r => r.Attention ? r.CreatedAt : "", StringComparer.Ordinal)
              .ThenByDescending(r => r.Attention ? "" : r.UpdatedAt, StringComparer.Ordinal)
              .ToList();

    // ---- login screen texts (same as the phone)
    public static string LoginErrorText(ApiStatus status, int httpStatus, int retryAfterSeconds) => status switch
    {
        ApiStatus.Locked => $"Juda ko‘p noto‘g‘ri urinish. {(retryAfterSeconds + 59) / 60} daqiqadan keyin qayta urinib ko‘ring.",
        ApiStatus.Offline => "Internet yo‘q. Ulanishni tekshiring.",
        ApiStatus.Unauthorized => "Login yoki parol noto‘g‘ri.",
        ApiStatus.Failed when httpStatus == 401 => "Login yoki parol noto‘g‘ri.",
        ApiStatus.Failed when httpStatus == 403 => "Bu kompaniya o‘chirilgan. Administrator bilan bog‘laning.",
        _ => "Kirib bo‘lmadi. Birozdan keyin qayta urinib ko‘ring.",
    };

    public static string DutyText(int active, int waiting) =>
        waiting > 0 ? $"{waiting} ta so‘rov javob kutmoqda"
        : active > 0 ? $"{active} ta faol buyurtma"
        : "Yangi so‘rovlarni kutyapman";
}
