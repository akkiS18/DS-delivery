using DsTaxi.Core.Api;

namespace DsTaxi.Core.Format;

public enum HistoryKind { All, Delivered, Closed }

/// <summary>The "Tarix" tab: search by code / restaurant / address, filter by outcome, and the one-line summary on top.</summary>
public static class HistoryFilter
{
    private static bool IsClosedWithoutDelivery(string status) => status is "DECLINED" or "CANCELLED";

    public static IReadOnlyList<RequestDto> Apply(IEnumerable<RequestDto> history, string? text, HistoryKind kind)
    {
        var needle = (text ?? "").Trim().TrimStart('#');
        return history
            .Where(r => kind switch
            {
                HistoryKind.Delivered => r.Status == "DELIVERED",
                HistoryKind.Closed => IsClosedWithoutDelivery(r.Status),
                _ => true,
            })
            .Where(r => needle.Length == 0
                || Contains(r.OrderCode, needle) || Contains(r.Restaurant.Name, needle) || Contains(r.Delivery.Address, needle))
            .OrderByDescending(r => r.DeliveredAt ?? r.UpdatedAt, StringComparer.Ordinal)
            .ToList();
    }

    /// <summary>"So‘nggi 24 soat: 7 ta yetkazildi, 2 ta rad etildi/bekor qilindi" (the server's history is the last 24 hours).</summary>
    public static string Summary(IReadOnlyCollection<RequestDto> history)
    {
        var delivered = history.Count(r => r.Status == "DELIVERED");
        var closed = history.Count(r => IsClosedWithoutDelivery(r.Status));
        if (delivered == 0 && closed == 0) return "So‘nggi 24 soat";
        var parts = new List<string>();
        if (delivered > 0) parts.Add($"{delivered} ta yetkazildi");
        if (closed > 0) parts.Add($"{closed} ta rad etildi/bekor qilindi");
        return "So‘nggi 24 soat: " + string.Join(", ", parts);
    }

    private static bool Contains(string? haystack, string needle) =>
        haystack is not null && haystack.Contains(needle, StringComparison.CurrentCultureIgnoreCase);
}
