using System.Collections.ObjectModel;
using System.Windows;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using DsRestaurant.Core.Api.Dtos;
using DsRestaurant.Core.Finance;
using DsRestaurant.Core.Menu;

namespace DsRestaurant.App.ViewModels;

public partial class ProductItemViewModel : ViewModelBase
{
    public ProductDto Product { get; }

    [ObservableProperty]
    private bool _isAvailable;

    public string Id => Product.Id;
    public string Name => Product.Name;
    public string? Description => Product.Description;
    public int PriceSom => Product.PriceSom;
    public string PriceFormatted => FinanceFormat.Som(Product.PriceSom);
    public string? CategoryId => Product.CategoryId;
    public int Version => Product.Version;
    public string? ImageUrl => Product.ImageUrl;

    /// <summary>The dish photo: the server sends a relative link (/api/v1/miniapp/products/..); it is public, no login needed.</summary>
    public Uri? ImageUri
    {
        get
        {
            var url = Product.ImageUrl;
            if (string.IsNullOrWhiteSpace(url)) return null;
            if (Uri.TryCreate(url, UriKind.Absolute, out var absolute) && (absolute.Scheme == Uri.UriSchemeHttps || absolute.Scheme == Uri.UriSchemeHttp)) return absolute;
            return Uri.TryCreate(new Uri(DsRestaurant.Core.Api.ApiConfig.DefaultBaseUrl), url.TrimStart('/'), out var joined) ? joined : null;
        }
    }
    public bool HasImage => ImageUri is not null;

    public ProductItemViewModel(ProductDto product)
    {
        Product = product;
        _isAvailable = product.IsAvailable;
    }
}

public partial class MenuViewModel : ViewModelBase
{
    private readonly MenuService _menuService;
    private List<ProductDto> _allProducts = [];

    [ObservableProperty]
    private bool _isLoading = false;

    [ObservableProperty]
    private string? _errorMessage;

    [ObservableProperty]
    private string _searchQuery = "";

    [ObservableProperty]
    private CategoryDto? _selectedCategory;

    public ObservableCollection<CategoryDto> Categories { get; } = new();
    public ObservableCollection<ProductItemViewModel> FilteredProducts { get; } = new();

    public MenuViewModel(MenuService menuService)
    {
        _menuService = menuService;
        _menuService.OnMenuChanged += () =>
        {
            Application.Current?.Dispatcher.Invoke(() => _ = LoadMenuAsync());
        };
    }

    [RelayCommand]
    public async Task LoadMenuAsync()
    {
        try
        {
            IsLoading = true;
            ErrorMessage = null;

            var res = await _menuService.GetMenuAsync();
            if (res.IsSuccess && res.Value != null)
            {
                Categories.Clear();
                foreach (var cat in res.Value.Categories)
                {
                    Categories.Add(cat);
                }

                _allProducts = res.Value.Products;
                ApplyFilter();
            }
            else
            {
                ErrorMessage = res.ErrorMessage;
            }
        }
        catch (Exception ex)
        {
            ErrorMessage = ex.Message;
        }
        finally
        {
            IsLoading = false;
        }
    }

    partial void OnSearchQueryChanged(string value) => ApplyFilter();
    partial void OnSelectedCategoryChanged(CategoryDto? value) => ApplyFilter();

    public void ApplyFilter()
    {
        FilteredProducts.Clear();
        var query = SearchQuery.Trim().ToLowerInvariant();

        var filtered = _allProducts.Where(p =>
        {
            bool matchesCat = SelectedCategory == null || p.CategoryId == SelectedCategory.Id;
            bool matchesQuery = string.IsNullOrEmpty(query) || p.Name.ToLowerInvariant().Contains(query);
            return matchesCat && matchesQuery;
        });

        foreach (var p in filtered)
        {
            FilteredProducts.Add(new ProductItemViewModel(p));
        }
    }

    [RelayCommand]
    public async Task ToggleAvailabilityAsync(ProductItemViewModel item)
    {
        try
        {
            bool newStatus = !item.IsAvailable;
            var res = await _menuService.ToggleProductAvailabilityAsync(item.Id, newStatus, item.Version);
            if (res.IsSuccess)
            {
                item.IsAvailable = newStatus;
            }
            else
            {
                ErrorMessage = res.ErrorMessage;
            }
        }
        catch (Exception ex)
        {
            ErrorMessage = ex.Message;
        }
    }

    public async Task<bool> SaveProductAsync(string? id, string name, int price, string? catId, string? desc, int version)
    {
        try
        {
            ErrorMessage = null;
            if (string.IsNullOrEmpty(id))
            {
                var req = new CreateProductRequestDto(name, price, desc, catId);
                var res = await _menuService.CreateProductAsync(req);
                if (!res.IsSuccess)
                {
                    ErrorMessage = res.ErrorMessage;
                    return false;
                }
            }
            else
            {
                var req = new UpdateProductRequestDto(name, price, desc, catId, version);
                var res = await _menuService.UpdateProductAsync(id, req);
                if (!res.IsSuccess)
                {
                    ErrorMessage = res.ErrorMessage;
                    return false;
                }
            }
            await LoadMenuAsync();
            return true;
        }
        catch (Exception ex)
        {
            ErrorMessage = ex.Message;
            return false;
        }
    }

    public async Task<bool> DeleteProductAsync(string id)
    {
        try
        {
            var res = await _menuService.DeleteProductAsync(id);
            if (!res.IsSuccess)
            {
                ErrorMessage = res.ErrorMessage;
                return false;
            }
            await LoadMenuAsync();
            return true;
        }
        catch (Exception ex)
        {
            ErrorMessage = ex.Message;
            return false;
        }
    }

    public async Task<bool> CreateCategoryAsync(string name)
    {
        try
        {
            var res = await _menuService.CreateCategoryAsync(name);
            if (!res.IsSuccess)
            {
                ErrorMessage = res.ErrorMessage;
                return false;
            }
            await LoadMenuAsync();
            return true;
        }
        catch (Exception ex)
        {
            ErrorMessage = ex.Message;
            return false;
        }
    }
}
