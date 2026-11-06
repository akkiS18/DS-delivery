namespace DsRestaurant.Core.Api;

public class ApiConfig
{
    public const string DefaultBaseUrl = "https://api.sultonxoja.uz/";

    public static string NormalizeUrl(string url)
    {
        var trimmed = url.Trim();
        if (!trimmed.StartsWith("http://", StringComparison.OrdinalIgnoreCase) &&
            !trimmed.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
        {
            trimmed = "https://" + trimmed;
        }
        if (!trimmed.EndsWith('/'))
        {
            trimmed += "/";
        }
        return trimmed;
    }

    public static string? ValidateUrl(string url)
    {
        if (string.IsNullOrWhiteSpace(url)) return "Server manzili bo‘sh bo‘lishi mumkin emas.";
        if (!Uri.TryCreate(NormalizeUrl(url), UriKind.Absolute, out var uri))
        {
            return "URL formati noto‘g‘ri.";
        }
        if (uri.Scheme != Uri.UriSchemeHttps)
        {
            return "Faqat xavfsiz HTTPS (https://...) manzillari qabul qilinadi.";
        }
        return null;
    }
}
