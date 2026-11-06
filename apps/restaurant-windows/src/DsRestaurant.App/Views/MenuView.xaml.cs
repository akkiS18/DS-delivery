using System.Windows;
using System.Windows.Controls;
using DsRestaurant.App.ViewModels;
using DsRestaurant.App.Views.Dialogs;
using DsRestaurant.Core.Api.Dtos;

namespace DsRestaurant.App.Views;

public partial class MenuView : UserControl
{
    public MenuView()
    {
        InitializeComponent();
    }

    private void CategoryAll_Click(object sender, RoutedEventArgs e)
    {
        if (DataContext is MenuViewModel vm)
        {
            vm.SelectedCategory = null;
        }
    }

    private void CategoryChip_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button btn && btn.DataContext is CategoryDto cat && DataContext is MenuViewModel vm)
        {
            vm.SelectedCategory = cat;
        }
    }

    private async void AddCategory_Click(object sender, RoutedEventArgs e)
    {
        if (DataContext is not MenuViewModel vm) return;

        var dlg = new CategoryDialog { Owner = Window.GetWindow(this) };
        if (dlg.ShowDialog() == true)
        {
            await vm.CreateCategoryAsync(dlg.CategoryName);
        }
    }

    private async void AddProduct_Click(object sender, RoutedEventArgs e)
    {
        if (DataContext is not MenuViewModel vm) return;

        var dlg = new ProductEditDialog(vm.Categories) { Owner = Window.GetWindow(this) };
        if (dlg.ShowDialog() == true)
        {
            await vm.SaveProductAsync(null, dlg.ProductName, dlg.ProductPrice, dlg.SelectedCategoryId, dlg.Description, 1);
        }
    }

    private async void EditProduct_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button btn && btn.DataContext is ProductItemViewModel item && DataContext is MenuViewModel vm)
        {
            var dlg = new ProductEditDialog(vm.Categories, item.Product) { Owner = Window.GetWindow(this) };
            if (dlg.ShowDialog() == true)
            {
                await vm.SaveProductAsync(item.Id, dlg.ProductName, dlg.ProductPrice, dlg.SelectedCategoryId, dlg.Description, item.Version);
            }
        }
    }

    private async void DeleteProduct_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button btn && btn.DataContext is ProductItemViewModel item && DataContext is MenuViewModel vm)
        {
            var res = MessageBox.Show(
                $"Haqiqatan ham \"{item.Name}\" taomini o‘chirmoqchimisiz?",
                "Taomni o‘chirish",
                MessageBoxButton.YesNo,
                MessageBoxImage.Question);

            if (res == MessageBoxResult.Yes)
            {
                await vm.DeleteProductAsync(item.Id);
            }
        }
    }
}
