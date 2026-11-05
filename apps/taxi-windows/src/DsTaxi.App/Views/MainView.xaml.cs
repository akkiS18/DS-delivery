using System;
using System.Windows;
using System.Windows.Controls;

namespace DsTaxi.App.Views;

public partial class MainView : UserControl
{
    public MainView() => InitializeComponent();

    /// <summary>The "Chiqish (hisobdan)" button: the host asks for confirmation and signs out.</summary>
    public event Action? LogoutRequested;

    /// <summary>Whatever becomes selected (a click, the arrow keys, the "new request" card) is scrolled into sight.</summary>
    private void OnRequestSelected(object sender, SelectionChangedEventArgs e)
    {
        if (RequestList.SelectedItem is { } item) RequestList.ScrollIntoView(item);
    }

    private void OnLogoutClick(object sender, RoutedEventArgs e) => LogoutRequested?.Invoke();
}
