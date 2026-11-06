using System.Windows;

namespace DsRestaurant.App.Views.Dialogs;

public partial class ReasonDialog : Window
{
    public string SelectedReason { get; private set; } = "OUT_OF_STOCK";

    public ReasonDialog(string title = "Sababni tanlang", string subtitle = "Iltimos, sababni tanlang:")
    {
        InitializeComponent();
        TitleText.Text = title;
        SubtitleText.Text = subtitle;
    }

    private void Confirm_Click(object sender, RoutedEventArgs e)
    {
        string code = "OTHER";
        if (Opt1.IsChecked == true) code = "OUT_OF_STOCK";
        else if (Opt2.IsChecked == true) code = "CANNOT_FULFIL";
        else if (Opt3.IsChecked == true) code = "CLOSED";
        else if (Opt4.IsChecked == true) code = "OTHER";

        string custom = ReasonInput.Text.Trim();
        SelectedReason = !string.IsNullOrEmpty(custom) ? $"{code}: {custom}" : code;

        DialogResult = true;
        Close();
    }

    private void Cancel_Click(object sender, RoutedEventArgs e)
    {
        DialogResult = false;
        Close();
    }
}
