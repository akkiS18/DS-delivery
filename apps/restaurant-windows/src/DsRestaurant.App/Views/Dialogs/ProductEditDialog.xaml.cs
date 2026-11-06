using System.Windows;
using DsRestaurant.Core.Api.Dtos;

namespace DsRestaurant.App.Views.Dialogs;

public partial class ProductEditDialog : Window
{
    public string ProductName => NameInput.Text.Trim();
    public int ProductPrice { get; private set; }
    public string? SelectedCategoryId => CategoryCombo.SelectedValue as string;
    public string? Description => string.IsNullOrWhiteSpace(DescInput.Text) ? null : DescInput.Text.Trim();

    public ProductEditDialog(IEnumerable<CategoryDto> categories, ProductDto? existing = null)
    {
        InitializeComponent();

        CategoryCombo.ItemsSource = categories;

        if (existing != null)
        {
            DialogTitle.Text = "Taomni tahrirlash";
            NameInput.Text = existing.Name;
            PriceInput.Text = existing.PriceSom.ToString();
            DescInput.Text = existing.Description ?? "";
            CategoryCombo.SelectedValue = existing.CategoryId;
        }
    }

    private void Save_Click(object sender, RoutedEventArgs e)
    {
        if (string.IsNullOrWhiteSpace(ProductName))
        {
            MessageBox.Show("Taom nomini kiriting.", "Xatolik", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        if (!int.TryParse(PriceInput.Text.Trim(), out int price) || price <= 0)
        {
            MessageBox.Show("Narxni to‘g‘ri raqam bilan kiriting.", "Xatolik", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        ProductPrice = price;
        DialogResult = true;
        Close();
    }

    private void Cancel_Click(object sender, RoutedEventArgs e)
    {
        DialogResult = false;
        Close();
    }
}
