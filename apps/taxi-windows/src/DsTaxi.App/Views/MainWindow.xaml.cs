using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Windows;
using DsTaxi.App.Services;
using DsTaxi.App.ViewModels;

namespace DsTaxi.App.Views;

/// <summary>The only window: shows the sign-in screen or the operator screen. Closing it hides it to the tray (when that is on) - the poll keeps running.</summary>
public partial class MainWindow : Window, IShell
{
    private const double CompactWidth = 460;
    private const double CompactHeight = 720;

    private bool _exiting;
    private bool _compact;
    private Rect _normalBounds;
    private MainViewModel? _vm;

    public MainWindow()
    {
        InitializeComponent();
        Main.LogoutRequested += () => LogoutRequested?.Invoke();
        Activated += (_, _) => WindowAttention.StopFlash(this);
    }

    /// <summary>Raised when the operator pressed "Chiqish (hisobdan)" in the settings.</summary>
    public event Action? LogoutRequested;

    /// <summary>Raised when the window is closed and the program is NOT supposed to keep running in the tray. The host decides whether to really exit.</summary>
    public event Func<bool>? CloseRequested;

    /// <summary>Asked when the window is closed: hide to the tray (true) or leave the program (false). Read at that moment, so the setting applies at once.</summary>
    public Func<bool> MinimizeToTrayOnClose { get; set; } = () => true;

    /// <summary>Where the window position and size are remembered (set by the host).</summary>
    public SessionStore? Store { get; set; }

    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);
        TitleBar.Apply(this);
    }

    // ---- remembered position and size
    /// <summary>Puts the window where it was last time, if that place is still on a screen. Call before the first Show.</summary>
    public void ApplySavedBounds(AppSettings s)
    {
        if (s.WindowWidth is not { } w || s.WindowHeight is not { } h || s.WindowLeft is not { } l || s.WindowTop is not { } t) return;
        w = Math.Max(w, MinWidth);
        h = Math.Max(h, MinHeight);
        var virtualScreen = new Rect(SystemParameters.VirtualScreenLeft, SystemParameters.VirtualScreenTop, SystemParameters.VirtualScreenWidth, SystemParameters.VirtualScreenHeight);
        // Both the title bar's left part and a good piece of the window must be on a screen that exists now (a monitor may have been unplugged).
        if (!virtualScreen.Contains(new Point(l + 80, t + 10)) || !virtualScreen.Contains(new Point(l + Math.Min(w, 400), t + Math.Min(h, 300)))) return;
        WindowStartupLocation = WindowStartupLocation.Manual;
        Left = l; Top = t; Width = w; Height = h;
        if (s.WindowMaximized) WindowState = WindowState.Maximized;
    }

    private void SaveBounds()
    {
        if (_compact || Store is null || WindowState == WindowState.Minimized) return;
        var maximized = WindowState == WindowState.Maximized;
        var b = maximized ? base.RestoreBounds : new Rect(Left, Top, Width, Height);
        if (b.Width < 200 || b.Height < 200) return;
        Store.Update(s =>
        {
            s.WindowLeft = b.Left; s.WindowTop = b.Top; s.WindowWidth = b.Width; s.WindowHeight = b.Height; s.WindowMaximized = maximized;
        });
    }

    // ---- compact mode: a narrow window that stays on top of the other programs
    private void ApplyCompact(bool compact)
    {
        if (compact == _compact) return;
        if (compact)
        {
            SaveBounds();
            _normalBounds = WindowState == WindowState.Maximized ? base.RestoreBounds : new Rect(Left, Top, Width, Height);
            WindowState = WindowState.Normal;
            MinWidth = 380; MinHeight = 480;
            Width = CompactWidth; Height = CompactHeight;
            Topmost = true;
            _compact = true;
        }
        else
        {
            _compact = false;
            Topmost = false;
            MinWidth = 900; MinHeight = 560;
            if (_normalBounds.Width > 0) { Left = _normalBounds.Left; Top = _normalBounds.Top; Width = _normalBounds.Width; Height = _normalBounds.Height; }
        }
    }

    public void ShowLogin(LoginViewModel vm)
    {
        DetachVm();
        Login.DataContext = vm;
        Main.DataContext = null;
        Main.Visibility = Visibility.Collapsed;
        Login.Visibility = Visibility.Visible;
    }

    public void ShowMain(MainViewModel vm)
    {
        DetachVm();
        _vm = vm;
        _vm.CompactChanged += ApplyCompact;
        Main.DataContext = vm;
        Login.DataContext = null;
        Login.Visibility = Visibility.Collapsed;
        Main.Visibility = Visibility.Visible;
    }

    private void DetachVm()
    {
        if (_vm is not null) _vm.CompactChanged -= ApplyCompact;
        _vm = null;
        if (_compact) ApplyCompact(false);
    }

    /// <summary>Lets the next Close() really close the window (used by the host when the operator chose Chiqish).</summary>
    public void AllowClose() => _exiting = true;

    protected override void OnClosing(CancelEventArgs e)
    {
        SaveBounds();
        if (!_exiting)
        {
            if (MinimizeToTrayOnClose())
            {
                e.Cancel = true;
                Hide();
                return;
            }
            // Tray mode is off: closing the window means leaving the program, with the same warning as the tray's Chiqish.
            if (CloseRequested is { } ask && !ask())
            {
                e.Cancel = true;
                return;
            }
        }
        base.OnClosing(e);
    }

    // ---- IShell
    public bool Confirm(string title, string body, string yes, string no, bool defaultYes = false) =>
        ConfirmDialog.Ask(this, title, body, yes, no, defaultYes);

    public void Copy(string text)
    {
        try { Clipboard.SetText(text); }
        catch (System.Runtime.InteropServices.COMException e) { Log.Error("clipboard busy", e); } // another program holds the clipboard for a moment
    }

    public void OpenUrl(string url)
    {
        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
        catch (Exception e) when (e is System.ComponentModel.Win32Exception or InvalidOperationException) { Log.Error("could not open a link", e); }
    }

    public void OpenFolder(string path)
    {
        try { Process.Start(new ProcessStartInfo("explorer.exe", "\"" + path + "\"") { UseShellExecute = true }); }
        catch (Exception e) when (e is System.ComponentModel.Win32Exception or InvalidOperationException) { Log.Error("could not open a folder", e); }
    }

    public void ShowWindow()
    {
        if (!IsVisible) Show();
        if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal;
        Activate();
    }
}
