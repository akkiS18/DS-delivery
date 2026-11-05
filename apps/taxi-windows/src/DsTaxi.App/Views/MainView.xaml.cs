using System;
using System.Windows;
using System.Windows.Controls;

namespace DsTaxi.App.Views;

public partial class MainView : UserControl
{
    public MainView() => InitializeComponent();

    /// <summary>The "Chiqish (hisobdan)" button: the host asks for confirmation and signs out.</summary>
    public event Action? LogoutRequested;

    private void OnLogoutClick(object sender, RoutedEventArgs e) => LogoutRequested?.Invoke();
}
