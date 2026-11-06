using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;

namespace DsRestaurant.App.Native;

/// <summary>
/// Paints the Windows title bar in the app's dark slate (#1E293B, the same as the navigation rail and the top bar) instead of the default white,
/// with white text. Needs Windows 11; on Windows 10 the call is refused and the normal title bar stays.
/// </summary>
public static class TitleBar
{
    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);

    private const int UseImmersiveDarkMode = 20;
    private const int BorderColor = 34;
    private const int CaptionColor = 35;
    private const int TextColor = 36;

    // COLORREF is 0x00BBGGRR: slate #1E293B and white.
    private const int Slate = 0x003B291E;
    private const int White = 0x00FFFFFF;

    /// <summary>Applies the colours to every window of the program (main window, dialogs) once its handle exists.</summary>
    public static void ApplyToAllWindows()
    {
        EventManager.RegisterClassHandler(typeof(Window), FrameworkElement.LoadedEvent, new RoutedEventHandler((s, _) =>
        {
            if (s is Window w) Apply(w);
        }));
    }

    public static void Apply(Window window)
    {
        try
        {
            var hwnd = new WindowInteropHelper(window).EnsureHandle();
            var on = 1;
            var slate = Slate;
            var white = White;
            DwmSetWindowAttribute(hwnd, UseImmersiveDarkMode, ref on, sizeof(int));
            DwmSetWindowAttribute(hwnd, CaptionColor, ref slate, sizeof(int));
            DwmSetWindowAttribute(hwnd, BorderColor, ref slate, sizeof(int));
            DwmSetWindowAttribute(hwnd, TextColor, ref white, sizeof(int));
        }
        catch (Exception e) when (e is DllNotFoundException or EntryPointNotFoundException)
        {
            // An older Windows without these attributes: the default title bar is fine.
        }
    }
}
