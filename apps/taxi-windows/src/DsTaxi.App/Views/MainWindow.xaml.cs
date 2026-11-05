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
    private bool _exiting;

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

    public void ShowLogin(LoginViewModel vm)
    {
        Login.DataContext = vm;
        Main.DataContext = null;
        Main.Visibility = Visibility.Collapsed;
        Login.Visibility = Visibility.Visible;
    }

    public void ShowMain(MainViewModel vm)
    {
        Main.DataContext = vm;
        Login.DataContext = null;
        Login.Visibility = Visibility.Collapsed;
        Main.Visibility = Visibility.Visible;
    }

    /// <summary>Lets the next Close() really close the window (used by the host when the operator chose Chiqish).</summary>
    public void AllowClose() => _exiting = true;

    protected override void OnClosing(CancelEventArgs e)
    {
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
    public bool Confirm(string title, string body, string yes, string no) => ConfirmDialog.Ask(this, title, body, yes, no);

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

    public void ShowWindow()
    {
        if (!IsVisible) Show();
        if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal;
        Activate();
    }
}
