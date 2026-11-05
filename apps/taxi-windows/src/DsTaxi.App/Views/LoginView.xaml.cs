using System;
using System.Windows;
using System.Windows.Controls;
using DsTaxi.App.ViewModels;

namespace DsTaxi.App.Views;

public partial class LoginView : UserControl
{
    private LoginViewModel? _vm;

    public LoginView()
    {
        InitializeComponent();
        DataContextChanged += OnDataContextChanged;
        IsVisibleChanged += (_, _) =>
        {
            // Focus the first empty field whenever the screen appears.
            if (!IsVisible) return;
            Dispatcher.BeginInvoke(new Action(() =>
            {
                if (string.IsNullOrWhiteSpace(LoginBox.Text)) LoginBox.Focus(); else PasswordBox.Focus();
            }), System.Windows.Threading.DispatcherPriority.Input);
        };
    }

    private void OnDataContextChanged(object sender, DependencyPropertyChangedEventArgs e)
    {
        if (_vm is not null) _vm.PasswordCleared -= ClearPassword;
        _vm = e.NewValue as LoginViewModel;
        if (_vm is not null) _vm.PasswordCleared += ClearPassword;
        PasswordBox.Clear();
    }

    private void ClearPassword() => Dispatcher.BeginInvoke(new Action(PasswordBox.Clear));

    private void OnPasswordChanged(object sender, RoutedEventArgs e)
    {
        if (_vm is not null) _vm.Password = PasswordBox.Password;
    }
}
