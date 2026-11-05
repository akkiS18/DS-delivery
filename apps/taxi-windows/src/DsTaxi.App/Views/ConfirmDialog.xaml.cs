using System;
using System.Windows;
using System.Windows.Input;

namespace DsTaxi.App.Views;

/// <summary>
/// A small "are you sure" box with our own button words. Esc = no. Enter presses the DEFAULT button: "no" for anything that is hard to undo,
/// "yes" only where the question itself came from an Enter press. A key held down (repeat) or pressed in the first moment never answers it,
/// so a double Enter or a held Enter cannot confirm by accident.
/// </summary>
public partial class ConfirmDialog : Window
{
    private static readonly TimeSpan ArmDelay = TimeSpan.FromMilliseconds(500);

    private readonly DateTime _openedAt = DateTime.UtcNow;

    public ConfirmDialog(string title, string body, string yes, string no, bool defaultYes)
    {
        InitializeComponent();
        TitleText.Text = title;
        BodyText.Text = body;
        YesButton.Content = yes;
        NoButton.Content = no;
        Loaded += (_, _) => (defaultYes ? YesButton : NoButton).Focus();
    }

    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);
        DsTaxi.App.Services.TitleBar.Apply(this);
    }

    protected override void OnPreviewKeyDown(KeyEventArgs e)
    {
        if (e.Key == Key.Enter)
        {
            // Handled here, never by a button: Enter answers like the focused button (the default one at the start), and only for a deliberate single press.
            e.Handled = true;
            if (!e.IsRepeat && DateTime.UtcNow - _openedAt >= ArmDelay) DialogResult = YesButton.IsKeyboardFocused;
            return;
        }
        base.OnPreviewKeyDown(e);
    }

    private void OnYes(object sender, RoutedEventArgs e) => DialogResult = true;

    private void OnNo(object sender, RoutedEventArgs e) => DialogResult = false;

    public static bool Ask(Window? owner, string title, string body, string yes, string no, bool defaultYes)
    {
        var dialog = new ConfirmDialog(title, body, yes, no, defaultYes);
        if (owner is { IsVisible: true }) dialog.Owner = owner;
        else
        {
            dialog.WindowStartupLocation = WindowStartupLocation.CenterScreen;
            dialog.Topmost = true; // the main window is hidden in the tray: the question must not appear behind other windows
            dialog.ShowInTaskbar = true;
        }
        return dialog.ShowDialog() == true;
    }
}
