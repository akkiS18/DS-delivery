using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using DsTaxi.Core.Dispatch;

namespace DsTaxi.App.Services;

/// <summary>Where the program keeps its files: %LOCALAPPDATA%\DsTaxi. Only the sign-in token (DPAPI), settings and logs - never requests or customer data.</summary>
public static class AppPaths
{
    public static readonly string Root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DsTaxi");
    public static string Logs => Path.Combine(Root, "logs");
    public static string SettingsFile => Path.Combine(Root, "settings.json");
    public static string SessionFile => Path.Combine(Root, "session.bin");
    public static string Ringtone => Path.Combine(AppContext.BaseDirectory, "Resources", "new_order.mp3");

    public static void Ensure() => Directory.CreateDirectory(Root);
}

/// <summary>Plain log file (status codes and events only: never tokens, passwords, phone numbers or addresses). One file per day, 14 days kept.</summary>
public static class Log
{
    private static readonly object Gate = new();

    public static void Info(string message) => Write("INFO", message);
    public static void Error(string message, Exception? e = null) => Write("ERROR", e is null ? message : $"{message}: {e.GetType().Name}: {e.Message}");

    private static void Write(string level, string message)
    {
        try
        {
            lock (Gate)
            {
                Directory.CreateDirectory(AppPaths.Logs);
                var file = Path.Combine(AppPaths.Logs, $"ds-taxi-{DateTime.Now:yyyyMMdd}.log");
                File.AppendAllText(file, $"{DateTime.Now:HH:mm:ss.fff} {level} {message}{Environment.NewLine}");
            }
        }
        catch (IOException) { /* logging must never break the program */ }
        catch (UnauthorizedAccessException) { }
    }

    public static void Cleanup()
    {
        try
        {
            if (!Directory.Exists(AppPaths.Logs)) return;
            foreach (var f in Directory.GetFiles(AppPaths.Logs, "ds-taxi-*.log").Where(f => File.GetLastWriteTime(f) < DateTime.Now.AddDays(-14)))
                File.Delete(f);
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }
}

public sealed class AppSettings
{
    public string ServerUrl { get; set; } = DefaultServerUrl;
    public bool Duty { get; set; } = true;
    public bool MinimizeToTray { get; set; } = true;
    public string? CompanyName { get; set; }
    public string? Login { get; set; }

    /// <summary>The production API address (the same one the Android apps are built with). Not shown anywhere in the program; only a developer editing settings.json (e.g. to try staging) changes it.</summary>
    public const string DefaultServerUrl = "https://api.sultonxoja.uz";
}

/// <summary>
/// The signed-in account, the bearer token (encrypted with Windows DPAPI for the current user: session.bin) and the settings file.
/// The password is never stored. Implements <see cref="ISession"/> for the dispatcher.
/// </summary>
public sealed class SessionStore : ISession
{
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("DsTaxi.session.v1");
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };
    private readonly object _gate = new();
    private string? _token;

    public AppSettings Settings { get; private set; } = new();

    public string? Token { get { lock (_gate) return _token; } }
    public bool IsLoggedIn { get { lock (_gate) return !string.IsNullOrWhiteSpace(_token) && !string.IsNullOrWhiteSpace(Settings.CompanyName); } }
    public bool Duty { get { lock (_gate) return Settings.Duty; } }
    public string? CompanyName => Settings.CompanyName;
    public string? Login => Settings.Login;

    public static SessionStore Load()
    {
        AppPaths.Ensure();
        var store = new SessionStore();
        try
        {
            if (File.Exists(AppPaths.SettingsFile))
                store.Settings = JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(AppPaths.SettingsFile)) ?? new AppSettings();
        }
        catch (Exception e) when (e is IOException or JsonException or UnauthorizedAccessException)
        {
            Log.Error("settings unreadable, defaults used", e);
        }
        try
        {
            if (File.Exists(AppPaths.SessionFile))
            {
                var clear = ProtectedData.Unprotect(File.ReadAllBytes(AppPaths.SessionFile), Entropy, DataProtectionScope.CurrentUser);
                store._token = Encoding.UTF8.GetString(clear);
            }
        }
        catch (Exception e) when (e is IOException or CryptographicException or UnauthorizedAccessException)
        {
            Log.Error("saved sign-in unreadable, sign in again", e); // e.g. the file came from another Windows user
            store._token = null;
        }
        return store;
    }

    public void SignIn(string token, string companyName, string login)
    {
        lock (_gate)
        {
            _token = token;
            Settings.CompanyName = companyName;
            Settings.Login = login;
            try { File.WriteAllBytes(AppPaths.SessionFile, ProtectedData.Protect(Encoding.UTF8.GetBytes(token), Entropy, DataProtectionScope.CurrentUser)); }
            catch (Exception e) when (e is IOException or CryptographicException or UnauthorizedAccessException) { Log.Error("could not save the sign-in", e); }
            SaveSettingsLocked();
        }
    }

    public void Clear()
    {
        lock (_gate)
        {
            _token = null;
            Settings.CompanyName = null;
            Settings.Login = null;
            try { if (File.Exists(AppPaths.SessionFile)) File.Delete(AppPaths.SessionFile); }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException) { Log.Error("could not delete the saved sign-in", e); }
            SaveSettingsLocked();
        }
    }

    public void Update(Action<AppSettings> change)
    {
        lock (_gate)
        {
            change(Settings);
            SaveSettingsLocked();
        }
    }

    private void SaveSettingsLocked()
    {
        try { File.WriteAllText(AppPaths.SettingsFile, JsonSerializer.Serialize(Settings, JsonOptions)); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { Log.Error("could not save settings", e); }
    }
}
