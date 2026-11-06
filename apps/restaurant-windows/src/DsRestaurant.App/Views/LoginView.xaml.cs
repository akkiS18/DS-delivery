using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using DsRestaurant.App.ViewModels;

namespace DsRestaurant.App.Views;

public partial class LoginView : UserControl
{
    public LoginView()
    {
        InitializeComponent();
    }

    private async void LoginButton_Click(object sender, RoutedEventArgs e)
    {
        if (DataContext is LoginViewModel vm)
        {
            var pwd = PasswordInput.Password;
            bool success = await vm.ExecuteLoginAsync(pwd);
            if (success)
            {
                PasswordInput.Clear();
            }
        }
    }

    private void PasswordInput_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter)
        {
            LoginButton_Click(sender, e);
        }
    }
}
