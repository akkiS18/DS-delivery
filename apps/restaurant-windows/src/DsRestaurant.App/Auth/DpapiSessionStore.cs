using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using DsRestaurant.Core.Auth;

namespace DsRestaurant.App.Auth;

public class DpapiSessionStore : ISessionStore
{
    private readonly string _filePath;

    public DpapiSessionStore(string? filePath = null)
    {
        if (filePath != null)
        {
            _filePath = filePath;
        }
        else
        {
            var appData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            var folder = Path.Combine(appData, "DsRestaurant");
            Directory.CreateDirectory(folder);
            _filePath = Path.Combine(folder, "session.bin");
        }
    }

    public async Task<SessionData?> LoadAsync()
    {
        try
        {
            if (!File.Exists(_filePath)) return null;

            var encryptedBytes = await File.ReadAllBytesAsync(_filePath);
            if (encryptedBytes.Length == 0) return null;

            var decryptedBytes = ProtectedData.Unprotect(encryptedBytes, null, DataProtectionScope.CurrentUser);
            var json = Encoding.UTF8.GetString(decryptedBytes);
            return JsonSerializer.Deserialize<SessionData>(json);
        }
        catch
        {
            // If decrypt fails or corrupted, clear the file
            await ClearAsync();
            return null;
        }
    }

    public async Task SaveAsync(SessionData session)
    {
        try
        {
            var json = JsonSerializer.Serialize(session);
            var plainBytes = Encoding.UTF8.GetBytes(json);
            var encryptedBytes = ProtectedData.Protect(plainBytes, null, DataProtectionScope.CurrentUser);

            var dir = Path.GetDirectoryName(_filePath);
            if (!string.IsNullOrEmpty(dir))
            {
                Directory.CreateDirectory(dir);
            }

            await File.WriteAllBytesAsync(_filePath, encryptedBytes);
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"Failed to save DPAPI session: {ex.Message}");
        }
    }

    public Task ClearAsync()
    {
        try
        {
            if (File.Exists(_filePath))
            {
                File.Delete(_filePath);
            }
        }
        catch
        {
            // Ignore deletion errors
        }
        return Task.CompletedTask;
    }
}
