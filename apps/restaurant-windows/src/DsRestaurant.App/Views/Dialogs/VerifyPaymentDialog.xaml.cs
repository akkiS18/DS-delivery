using System.Windows;
using DsRestaurant.Core.Api.Dtos;
using DsRestaurant.Core.Finance;

namespace DsRestaurant.App.Views.Dialogs;

public partial class VerifyPaymentDialog : Window
{
    public VerifyPaymentDialog(OrderDto order)
    {
        InitializeComponent();

        int amount = order.PaymentEvidence?.ExpectedAmountSom ?? order.TotalSom;
        AmountText.Text = FinanceFormat.Som(amount);
        CardText.Text = !string.IsNullOrEmpty(order.PaymentEvidence?.CardLast4)
            ? $"**{order.PaymentEvidence.CardLast4}"
            : (order.Payment?.CardLast4 != null ? $"**{order.Payment.CardLast4}" : "Karta");

        var signal = order.PaymentEvidence?.Signal;
        if (signal is null)
        {
            SignalText.Text = "Signal kelmagan — bank ilovasini tekshiring";
        }
        else if (signal.AmountMatches == false)
        {
            SignalText.Text = $"Signal bor, summa mos emas ({FinanceFormat.Som(signal.AmountSom ?? 0)})";
        }
        else
        {
            SignalText.Text = "Signal bor (bank tasdig‘i emas)";
        }
    }

    private void Confirm_Click(object sender, RoutedEventArgs e)
    {
        DialogResult = true;
        Close();
    }

    private void Cancel_Click(object sender, RoutedEventArgs e)
    {
        DialogResult = false;
        Close();
    }
}
