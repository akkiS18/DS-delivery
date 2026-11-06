using System.Text;

namespace DsRestaurant.Core.Finance;

public static class FinanceFormat
{
    public const char Nbsp = '\u00A0';
    public const string MinusSign = "\u2212";

    public static string Group(long value)
    {
        string digits = Math.Abs(value).ToString();
        var outBuilder = new StringBuilder();
        for (int i = 0; i < digits.Length; i++)
        {
            if (i > 0 && (digits.Length - i) % 3 == 0)
            {
                outBuilder.Append(Nbsp);
            }
            outBuilder.Append(digits[i]);
        }
        return (value < 0 ? MinusSign : "") + outBuilder.ToString();
    }

    private static string OneDecimal(double value)
    {
        long tenths = (long)Math.Round(value * 10.0, MidpointRounding.AwayFromZero);
        long whole = tenths / 10;
        long frac = tenths % 10;
        return frac == 0 ? whole.ToString() : $"{whole},{frac}";
    }

    public static string Som(long value)
    {
        long a = Math.Abs(value);
        string sign = value < 0 ? MinusSign : "";
        if (a >= 1_000_000_000L)
        {
            return $"{sign}{OneDecimal(a / 1_000_000_000.0)} mlrd so\u2018m";
        }
        if (a >= 10_000_000L)
        {
            return $"{sign}{OneDecimal(a / 1_000_000.0)} mln so\u2018m";
        }
        return $"{Group(value)} so\u2018m";
    }

    public static string Signed(long value) =>
        (value > 0 ? "+" : "") + Som(value);

    public static float Share(long part, long whole)
    {
        if (whole <= 0L) return 0f;
        float ratio = (float)part / (float)whole;
        return Math.Clamp(ratio, 0f, 1f);
    }
}
