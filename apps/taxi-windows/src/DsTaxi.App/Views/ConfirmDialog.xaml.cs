using System.Windows;

namespace DsTaxi.App.Views;

/// <summary>A small "are you sure" box with our own button words (Ha / Yo‘q, ortga). Esc = no, Enter = yes.</summary>
public partial class ConfirmDialog : Window
{
    public ConfirmDialog(string title, string body, string yes, string no)
    {
        InitializeComponent();
        TitleText.Text = title;
        BodyText.Text = body;
        YesButton.Content = yes;
        NoButton.Content = no;
    }

    private void OnYes(object sender, RoutedEventArgs e) => DialogResult = true;

    private void OnNo(object sender, RoutedEventArgs e) => DialogResult = false;

    public static bool Ask(Window? owner, string title, string body, string yes, string no)
    {
        var dialog = new ConfirmDialog(title, body, yes, no);
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
