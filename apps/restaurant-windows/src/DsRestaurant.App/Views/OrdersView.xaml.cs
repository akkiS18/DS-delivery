using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using DsRestaurant.App.ViewModels;
using DsRestaurant.App.Views.Dialogs;

namespace DsRestaurant.App.Views;

public partial class OrdersView : UserControl
{
    public OrdersView()
    {
        InitializeComponent();
    }

    private void Tab_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button btn && btn.Tag is string tab && DataContext is OrdersViewModel vm)
        {
            vm.SelectTab(tab);
        }
    }

    private void OrderCard_Click(object sender, MouseButtonEventArgs e)
    {
        if (sender is FrameworkElement fe && fe.DataContext is OrderDetailViewModel order && DataContext is OrdersViewModel vm)
        {
            vm.SelectedOrder = order;
        }
    }

    private async void Accept_Click(object sender, RoutedEventArgs e)
    {
        if (DataContext is not OrdersViewModel vm || vm.SelectedOrder == null) return;

        // No preparation time is asked any more (owner decision 2026-10-27).
        await vm.AcceptOrderAsync(null);
    }

    private async void Reject_Click(object sender, RoutedEventArgs e)
    {
        if (DataContext is not OrdersViewModel vm || vm.SelectedOrder == null) return;

        var dlg = new ReasonDialog("Buyurtmani rad etish", "Rad etish sababini tanlang:") { Owner = Window.GetWindow(this) };
        if (dlg.ShowDialog() == true)
        {
            await vm.RejectOrderAsync(dlg.SelectedReason);
        }
    }

    private async void Preparing_Click(object sender, RoutedEventArgs e)
    {
        if (DataContext is not OrdersViewModel vm || vm.SelectedOrder == null) return;
        await vm.StartPreparingAsync(null);
    }

    private async void SetPrepTime_Click(object sender, RoutedEventArgs e)
    {
        if (DataContext is not OrdersViewModel vm || vm.SelectedOrder == null) return;

        // "Qabul qildim": a one-tap acknowledgement, no time is chosen.
        await vm.SetPrepTimeAsync(null);
    }

    private async void MarkReady_Click(object sender, RoutedEventArgs e)
    {
        if (DataContext is not OrdersViewModel vm || vm.SelectedOrder == null) return;

        bool isSelf = false;
        if (vm.SelectedOrder.Order.Delivery?.Preference == "WALK_OK")
        {
            var res = MessageBox.Show(
                "Mijoz piyoda yetkazishga rozilik bergan.\nUshbu buyurtmani restoranning o‘zi yetkazib beradimi?",
                "Yetkazib berish usuli",
                MessageBoxButton.YesNoCancel,
                MessageBoxImage.Question);

            if (res == MessageBoxResult.Cancel) return;
            isSelf = res == MessageBoxResult.Yes;
        }

        await vm.MarkReadyAsync(isSelf);
    }

    private async void SelfDelivered_Click(object sender, RoutedEventArgs e)
    {
        if (DataContext is not OrdersViewModel vm || vm.SelectedOrder == null) return;

        var res = MessageBox.Show(
            "Buyurtma mijozga topshirildimi?",
            "Yetkazildi deb belgilash",
            MessageBoxButton.YesNo,
            MessageBoxImage.Question);

        if (res == MessageBoxResult.Yes)
        {
            await vm.SetSelfDeliveredAsync();
        }
    }

    private async void VerifyPayment_Click(object sender, RoutedEventArgs e)
    {
        if (DataContext is not OrdersViewModel vm || vm.SelectedOrder == null) return;

        var dlg = new VerifyPaymentDialog(vm.SelectedOrder.Order) { Owner = Window.GetWindow(this) };
        if (dlg.ShowDialog() == true)
        {
            await vm.VerifyPaymentAsync();
        }
    }

    private async void Cancel_Click(object sender, RoutedEventArgs e)
    {
        if (DataContext is not OrdersViewModel vm || vm.SelectedOrder == null) return;

        var dlg = new ReasonDialog("Buyurtmani bekor qilish", "Bekor qilish sababini tanlang:") { Owner = Window.GetWindow(this) };
        if (dlg.ShowDialog() == true)
        {
            await vm.CancelOrderAsync(dlg.SelectedReason);
        }
    }

    private async void ApproveRefund_Click(object sender, RoutedEventArgs e)
    {
        if (DataContext is not OrdersViewModel vm || vm.SelectedOrder == null) return;

        var res = MessageBox.Show(
            "Bekor qilish va pulni qaytarish so‘rovini tasdiqlaysizmi?",
            "Qaytarishni tasdiqlash",
            MessageBoxButton.YesNo,
            MessageBoxImage.Question);

        if (res == MessageBoxResult.Yes)
        {
            await vm.ApproveRefundAsync();
        }
    }

    private async void RejectRefund_Click(object sender, RoutedEventArgs e)
    {
        if (DataContext is not OrdersViewModel vm || vm.SelectedOrder == null) return;

        var dlg = new ReasonDialog("Qaytarishni rad etish", "Rad etish sababini tanlang:") { Owner = Window.GetWindow(this) };
        if (dlg.ShowDialog() == true)
        {
            await vm.RejectRefundAsync(dlg.SelectedReason);
        }
    }
}
