using System.Globalization;
using System.Windows;
using System.Windows.Data;
using DsRestaurant.Core.Finance;

namespace DsRestaurant.App.ViewModels;

public class StringNullOrEmptyToVisibilityConverter : IValueConverter
{
    public static readonly StringNullOrEmptyToVisibilityConverter Instance = new();

    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        return string.IsNullOrWhiteSpace(value as string) ? Visibility.Collapsed : Visibility.Visible;
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => throw new NotImplementedException();
}

public class BooleanToVisibilityConverter : IValueConverter
{
    public static readonly BooleanToVisibilityConverter Instance = new();

    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        return value is true ? Visibility.Visible : Visibility.Collapsed;
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => throw new NotImplementedException();
}

public class InverseBooleanToVisibilityConverter : IValueConverter
{
    public static readonly InverseBooleanToVisibilityConverter Instance = new();

    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        return value is true ? Visibility.Collapsed : Visibility.Visible;
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => throw new NotImplementedException();
}

public class InverseBooleanConverter : IValueConverter
{
    public static readonly InverseBooleanConverter Instance = new();

    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        return value is not true;
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => throw new NotImplementedException();
}

public class BusyTextConverter : IValueConverter
{
    public static readonly BusyTextConverter Instance = new();

    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        return value is true ? "Tekshirilmoqda..." : "Kirish";
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => throw new NotImplementedException();
}

public class CountToVisibilityConverter : IValueConverter
{
    public static readonly CountToVisibilityConverter Instance = new();

    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        return value is int count && count > 0 ? Visibility.Visible : Visibility.Collapsed;
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => throw new NotImplementedException();
}

public class ZeroToVisibilityConverter : IValueConverter
{
    public static readonly ZeroToVisibilityConverter Instance = new();

    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        return value is int count && count == 0 ? Visibility.Visible : Visibility.Collapsed;
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => throw new NotImplementedException();
}

public class NullToVisibilityConverter : IValueConverter
{
    public static readonly NullToVisibilityConverter Instance = new();

    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        return value == null ? Visibility.Visible : Visibility.Collapsed;
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => throw new NotImplementedException();
}

public class NotNullToVisibilityConverter : IValueConverter
{
    public static readonly NotNullToVisibilityConverter Instance = new();

    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        return value != null ? Visibility.Visible : Visibility.Collapsed;
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => throw new NotImplementedException();
}

public class OverdueToBorderColorConverter : IValueConverter
{
    public static readonly OverdueToBorderColorConverter Instance = new();

    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        return value is true ? "#EF4444" : "#334155";
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => throw new NotImplementedException();
}

public class OverdueToTextColorConverter : IValueConverter
{
    public static readonly OverdueToTextColorConverter Instance = new();

    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        return value is true ? "#EF4444" : "#22C55E";
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => throw new NotImplementedException();
}

public class SectionMatchToVisibilityConverter : IValueConverter
{
    public string TargetSection { get; set; } = "";

    public static readonly SectionMatchToVisibilityConverter OrdersInstance = new() { TargetSection = "Buyurtmalar" };
    public static readonly SectionMatchToVisibilityConverter SettingsInstance = new() { TargetSection = "Sozlamalar" };
    public static readonly SectionMatchToVisibilityConverter ReservationsInstance = new() { TargetSection = "Bronlar" };
    public static readonly SectionMatchToVisibilityConverter MenuInstance = new() { TargetSection = "Menyu" };
    public static readonly SectionMatchToVisibilityConverter FinanceInstance = new() { TargetSection = "Moliya" };

    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        var current = value as string;
        var target = parameter as string ?? TargetSection;
        return string.Equals(current, target, StringComparison.OrdinalIgnoreCase)
            ? Visibility.Visible
            : Visibility.Collapsed;
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => throw new NotImplementedException();
}

/// <summary>True when the bound text equals the converter parameter: marks the open navigation page / tab.</summary>
public class EqualsConverter : IValueConverter
{
    public static readonly EqualsConverter Instance = new();

    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
        => string.Equals(value as string, parameter as string, StringComparison.OrdinalIgnoreCase);

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => throw new NotImplementedException();
}

public class AvailabilityToColorConverter : IValueConverter
{
    public static readonly AvailabilityToColorConverter Instance = new();

    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        return value is true ? "#16A34A" : "#475569";
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => throw new NotImplementedException();
}

public class AvailabilityToTextConverter : IValueConverter
{
    public static readonly AvailabilityToTextConverter Instance = new();

    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        return value is true ? "Sotuvda bor" : "To‘xtatilgan";
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => throw new NotImplementedException();
}

public class BooleanToPausedStatusTextConverter : IValueConverter
{
    public static readonly BooleanToPausedStatusTextConverter Instance = new();

    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        return value is true ? "Pauza (To‘xtatilgan)" : "Faol (Qabul qilinmoqda)";
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => throw new NotImplementedException();
}

public class BooleanToPausedStatusColorConverter : IValueConverter
{
    public static readonly BooleanToPausedStatusColorConverter Instance = new();

    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        return value is true ? "#EF4444" : "#22C55E";
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => throw new NotImplementedException();
}

public class BooleanToPausedButtonBackgroundConverter : IValueConverter
{
    public static readonly BooleanToPausedButtonBackgroundConverter Instance = new();

    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        return value is true ? "#16A34A" : "#DC2626";
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => throw new NotImplementedException();
}

public class BooleanToPausedButtonTextConverter : IValueConverter
{
    public static readonly BooleanToPausedButtonTextConverter Instance = new();

    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        return value is true ? "Qabulni yoqish" : "Pauza qilish";
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => throw new NotImplementedException();
}

public class CardStatusBackgroundConverter : IValueConverter
{
    public static readonly CardStatusBackgroundConverter Instance = new();

    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        return value is true ? "#16A34A" : "#64748B";
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => throw new NotImplementedException();
}

public class CardStatusTextConverter : IValueConverter
{
    public static readonly CardStatusTextConverter Instance = new();

    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        return value is true ? "Faol" : "Nofaol";
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => throw new NotImplementedException();
}

public class FinancePhaseToVisibilityConverter : IValueConverter
{
    public static readonly FinancePhaseToVisibilityConverter Instance = new();

    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        if (value is not FinancePhase phase || parameter is not string target) return Visibility.Collapsed;
        return string.Equals(phase.ToString(), target, StringComparison.OrdinalIgnoreCase)
            ? Visibility.Visible
            : Visibility.Collapsed;
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => throw new NotImplementedException();
}

public class DotToColorConverter : IValueConverter
{
    public static readonly DotToColorConverter Instance = new();

    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        return value is true ? "#22C55E" : "#334155";
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => throw new NotImplementedException();
}

public class LongToSomConverter : IValueConverter
{
    public static readonly LongToSomConverter Instance = new();

    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        if (value is long l) return DsRestaurant.Core.Finance.FinanceFormat.Som(l);
        if (value is int i) return DsRestaurant.Core.Finance.FinanceFormat.Som(i);
        return "0 so‘m";
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => throw new NotImplementedException();
}

public class LongToSignedSomConverter : IValueConverter
{
    public static readonly LongToSignedSomConverter Instance = new();

    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        if (value is long l) return DsRestaurant.Core.Finance.FinanceFormat.Signed(l);
        if (value is int i) return DsRestaurant.Core.Finance.FinanceFormat.Signed(i);
        return "0 so‘m";
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => throw new NotImplementedException();
}

public class RatioToPercentWidthConverter : IValueConverter
{
    public static readonly RatioToPercentWidthConverter Instance = new();

    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        if (value is double d)
        {
            double max = 400.0;
            if (parameter is string s && double.TryParse(s, out var pMax)) max = pMax;
            return Math.Clamp(d * max, 0, max);
        }
        return 0.0;
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => throw new NotImplementedException();
}

public class LedgerKindToTitleConverter : IValueConverter
{
    public static readonly LedgerKindToTitleConverter Instance = new();

    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        var kind = value as string;
        return string.Equals(kind, "PAYOUT", StringComparison.OrdinalIgnoreCase)
            ? "Platforma to‘lab berdi"
            : "Buyurtma tushumi";
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => throw new NotImplementedException();
}

public class LedgerSourceToTextConverter : IValueConverter
{
    public static readonly LedgerSourceToTextConverter Instance = new();

    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        var src = value as string;
        return src switch
        {
            "platform" => "Platforma kartasi",
            "own" => "O‘z karta",
            "cash" => "Naqd pul",
            _ => src ?? ""
        };
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => throw new NotImplementedException();
}
