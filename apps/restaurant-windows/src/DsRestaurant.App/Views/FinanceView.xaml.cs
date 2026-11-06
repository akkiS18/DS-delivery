using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using DsRestaurant.App.ViewModels;

namespace DsRestaurant.App.Views;

public partial class FinanceView : UserControl
{
    public FinanceView()
    {
        InitializeComponent();
        Loaded += (s, e) => Focus();
    }

    private void KeypadDigit_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button btn && btn.Content is string digit)
        {
            if (DataContext is FinanceViewModel vm)
            {
                vm.AppendDigit(digit);
            }
        }
    }

    private void FinanceView_KeyDown(object sender, KeyEventArgs e)
    {
        if (DataContext is not FinanceViewModel vm || vm.Phase != Core.Finance.FinancePhase.Locked) return;

        char? digit = e.Key switch
        {
            Key.D0 or Key.NumPad0 => '0',
            Key.D1 or Key.NumPad1 => '1',
            Key.D2 or Key.NumPad2 => '2',
            Key.D3 or Key.NumPad3 => '3',
            Key.D4 or Key.NumPad4 => '4',
            Key.D5 or Key.NumPad5 => '5',
            Key.D6 or Key.NumPad6 => '6',
            Key.D7 or Key.NumPad7 => '7',
            Key.D8 or Key.NumPad8 => '8',
            Key.D9 or Key.NumPad9 => '9',
            _ => null
        };

        if (digit.HasValue)
        {
            vm.AppendDigit(digit.Value.ToString());
            e.Handled = true;
        }
        else if (e.Key == Key.Back)
        {
            vm.Backspace();
            e.Handled = true;
        }
        else if (e.Key == Key.Escape)
        {
            vm.ClearPin();
            e.Handled = true;
        }
    }
}
