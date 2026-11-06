using System.Windows;

namespace DsRestaurant.App.Views.Dialogs;

public partial class CategoryDialog : Window
{
    public string CategoryName => NameInput.Text.Trim();

    public CategoryDialog()
    {
        InitializeComponent();
    }

    private void Save_Click(object sender, RoutedEventArgs e)
    {
        if (string.IsNullOrWhiteSpace(CategoryName))
        {
            MessageBox.Show("Toifa nomini kiriting.", "Xatolik", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        DialogResult = true;
        Close();
    }

    private void Cancel_Click(object sender, RoutedEventArgs e)
    {
        DialogResult = false;
        Close();
    }
}
