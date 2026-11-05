using DsTaxi.Core.Api;

namespace DsTaxi.Core.Versioning;

public enum UpdateLevel
{
    /// <summary>Up to date, or the server has no rule.</summary>
    None,
    /// <summary>A newer version exists; the program keeps working and shows a hint.</summary>
    Available,
    /// <summary>This version is too old: the program stops and asks for the update.</summary>
    Required,
}

public sealed record UpdateState(UpdateLevel Level, string? LatestVersion, string? DownloadUrl)
{
    public static readonly UpdateState Current = new(UpdateLevel.None, null, null);
}

/// <summary>Decides from the server's client-config whether this program version is still allowed. A value that cannot be read never blocks anybody.</summary>
public static class UpdateCheck
{
    /// <summary>Parses "1.2.3" (a fourth part, as in an assembly version "1.2.3.0", is ignored). Null when it is not a version.</summary>
    public static Version? Parse(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;
        var parts = text.Trim().Split('.');
        if (parts.Length < 3 || parts.Length > 4) return null;
        var numbers = new int[3];
        for (var i = 0; i < 3; i++)
        {
            if (!int.TryParse(parts[i], System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out numbers[i])) return null;
        }
        return new Version(numbers[0], numbers[1], numbers[2]);
    }

    public static UpdateState Evaluate(string currentVersion, WindowsClientConfig? config)
    {
        var current = Parse(currentVersion);
        if (current is null || config is null) return UpdateState.Current;

        var min = Parse(config.MinVersion);
        if (min is not null && current < min) return new UpdateState(UpdateLevel.Required, config.LatestVersion ?? config.MinVersion, config.DownloadUrl);

        var latest = Parse(config.LatestVersion);
        if (latest is not null && current < latest) return new UpdateState(UpdateLevel.Available, config.LatestVersion, config.DownloadUrl);

        return UpdateState.Current;
    }
}
