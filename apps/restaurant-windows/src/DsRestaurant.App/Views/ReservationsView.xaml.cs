using System.Windows;
using System.Windows.Controls;
using DsRestaurant.App.ViewModels;
using DsRestaurant.App.Views.Dialogs;
using DsRestaurant.Core.Api.Dtos;

namespace DsRestaurant.App.Views;

public partial class ReservationsView : UserControl
{
    public ReservationsView()
    {
        InitializeComponent();
    }

    private async void MarkSeen_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button btn && btn.DataContext is ReservationDto res && !string.IsNullOrEmpty(res.Id))
        {
            if (DataContext is ReservationsViewModel vm)
            {
                await vm.MarkSeenAsync(res.Id);
            }
        }
    }

    private async void ConfirmPayment_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button btn && btn.DataContext is ReservationDto res && !string.IsNullOrEmpty(res.Id))
        {
            var result = MessageBox.Show(
                $"Mijoz '{res.CustomerName}' to‘lov chekini yuborgan. Depozit to‘lovini qabul qilasizmi?",
                "To‘lovni tasdiqlash",
                MessageBoxButton.YesNo,
                MessageBoxImage.Question);

            if (result == MessageBoxResult.Yes && DataContext is ReservationsViewModel vm)
            {
                await vm.ConfirmPaymentAsync(res.Id);
            }
        }
    }

    private async void Cancel_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button btn && btn.DataContext is ReservationDto res && !string.IsNullOrEmpty(res.Id))
        {
            var dialog = new ReasonDialog(
                title: "Bronni bekor qilish",
                subtitle: $"Mijoz '{res.CustomerName}' bronini bekor qilish sababini ko‘rsating:")
            {
                Owner = Window.GetWindow(this)
            };

            if (dialog.ShowDialog() == true && DataContext is ReservationsViewModel vm)
            {
                await vm.CancelReservationAsync(res.Id, dialog.SelectedReason);
            }
        }
    }
}
