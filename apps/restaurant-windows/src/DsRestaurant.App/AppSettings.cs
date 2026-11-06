using System.IO;
using System.Text.Json;

namespace DsRestaurant.App;

/// <summary>
/// Small per-user preferences kept in %LOCALAPPDATA%\DsRestaurant\settings.json (the sign-in lives in session.bin, not here).
/// </summary>
public static class AppSettings
{
    private sealed class Data
    {
        public bool HideToTrayOnClose { get; set; } = true;
    }

    private static readonly string FilePath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DsRestaurant", "settings.json");

    private static Data? _data;

    private static Data Current => _data ??= Load();

    /// <summary>X hides the window to the tray (default) instead of closing the program.</summary>
    public static bool HideToTrayOnClose
    {
        get => Current.HideToTrayOnClose;
        set
        {
            if (Current.HideToTrayOnClose == value) return;
            Current.HideToTrayOnClose = value;
            Save();
        }
    }

    private static Data Load()
    {
        try
        {
            if (File.Exists(FilePath)) return JsonSerializer.Deserialize<Data>(File.ReadAllText(FilePath)) ?? new Data();
        }
        catch
        {
            // A damaged file: start again with the defaults.
        }
        return new Data();
    }

    private static void Save()
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(FilePath)!);
            File.WriteAllText(FilePath, JsonSerializer.Serialize(_data));
        }
        catch
        {
            // Not being able to save a preference must never crash the kitchen screen.
        }
    }
}
