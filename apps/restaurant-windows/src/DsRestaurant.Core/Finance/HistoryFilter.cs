using DsRestaurant.Core.Common;

namespace DsRestaurant.Core.Finance;

public enum HistoryPeriod
{
    All,
    Today,
    Last7Days,
    ThisMonth,
    Custom
}

public static class HistoryPeriodExtensions
{
    public static string GetTitle(this HistoryPeriod period) => period switch
    {
        HistoryPeriod.All => "Hammasi",
        HistoryPeriod.Today => "Bugun",
        HistoryPeriod.Last7Days => "7 kun",
        HistoryPeriod.ThisMonth => "Shu oy",
        HistoryPeriod.Custom => "Tanlangan sana",
        _ => "Hammasi"
    };

    /// <summary>
    /// Returns inclusive Asia/Tashkent day keys in yyyy-MM-dd format (null = no boundary).
    /// </summary>
    public static (string? From, string? To) GetRange(this HistoryPeriod period, DateOnly? referenceToday = null)
    {
        var today = referenceToday ?? DateOnly.FromDateTime(ServerClockHelper.NowTashkent().DateTime);
        return period switch
        {
            HistoryPeriod.All => (null, null),
            HistoryPeriod.Today => (today.ToString("yyyy-MM-dd"), today.ToString("yyyy-MM-dd")),
            HistoryPeriod.Last7Days => (today.AddDays(-6).ToString("yyyy-MM-dd"), today.ToString("yyyy-MM-dd")),
            HistoryPeriod.ThisMonth => (new DateOnly(today.Year, today.Month, 1).ToString("yyyy-MM-dd"), today.ToString("yyyy-MM-dd")),
            HistoryPeriod.Custom => (null, null),
            _ => (null, null)
        };
    }
}

public enum HistorySource
{
    All,
    Card,
    Cash
}

public static class HistorySourceExtensions
{
    public static string GetTitle(this HistorySource source) => source switch
    {
        HistorySource.All => "Hammasi",
        HistorySource.Card => "Karta",
        HistorySource.Cash => "Naqd",
        _ => "Hammasi"
    };

    public static string GetQuery(this HistorySource source) => source switch
    {
        HistorySource.All => "all",
        HistorySource.Card => "card",
        HistorySource.Cash => "cash",
        _ => "all"
    };
}
