using DsRestaurant.Core.Api;
using DsRestaurant.Core.Api.Dtos;
using DsRestaurant.Core.Common;

namespace DsRestaurant.Core.Menu;

public record MenuData(
    List<CategoryDto> Categories,
    List<ProductDto> Products
);

public class MenuService
{
    private readonly RestaurantApi _api;

    public event Action? OnMenuChanged;

    public MenuService(RestaurantApi api)
    {
        _api = api;
    }

    public async Task<Result<MenuData>> GetMenuAsync(CancellationToken ct = default)
    {
        var catTask = _api.GetCategoriesAsync(ct);
        var prodTask = _api.GetProductsAsync(includeArchived: true, ct);

        await Task.WhenAll(catTask, prodTask);

        var catRes = await catTask;
        var prodRes = await prodTask;

        if (!catRes.IsSuccess) return Result<MenuData>.Fail(catRes.ErrorMessage ?? "Toifalarni yuklab bo‘lmadi", catRes.ErrorCode, catRes.StatusCode);
        if (!prodRes.IsSuccess) return Result<MenuData>.Fail(prodRes.ErrorMessage ?? "Taomlarni yuklab bo‘lmadi", prodRes.ErrorCode, prodRes.StatusCode);

        var data = new MenuData(catRes.Value?.Categories ?? [], prodRes.Value?.Products ?? []);
        return Result<MenuData>.Ok(data);
    }

    public async Task<Result<ProductDto>> ToggleProductAvailabilityAsync(string id, bool isAvailable, int? version, CancellationToken ct = default)
    {
        var res = await _api.UpdateProductAvailabilityAsync(id, isAvailable, version, ct);
        if (res.IsSuccess) OnMenuChanged?.Invoke();
        return res;
    }

    public async Task<Result<ProductDto>> CreateProductAsync(CreateProductRequestDto req, CancellationToken ct = default)
    {
        var res = await _api.CreateProductAsync(req, ct);
        if (res.IsSuccess) OnMenuChanged?.Invoke();
        return res;
    }

    public async Task<Result<ProductDto>> UpdateProductAsync(string id, UpdateProductRequestDto req, CancellationToken ct = default)
    {
        var res = await _api.UpdateProductAsync(id, req, ct);
        if (res.IsSuccess) OnMenuChanged?.Invoke();
        return res;
    }

    public async Task<Result> DeleteProductAsync(string id, CancellationToken ct = default)
    {
        var res = await _api.DeleteProductAsync(id, ct);
        if (res.IsSuccess) OnMenuChanged?.Invoke();
        return res;
    }

    public async Task<Result<CategoryDto>> CreateCategoryAsync(string name, int? position = null, CancellationToken ct = default)
    {
        var res = await _api.CreateCategoryAsync(name, position, ct);
        if (res.IsSuccess) OnMenuChanged?.Invoke();
        return res;
    }

    public async Task<Result<CategoryDto>> UpdateCategoryAsync(string id, string name, int position, int version, CancellationToken ct = default)
    {
        var res = await _api.UpdateCategoryAsync(id, name, position, version, ct);
        if (res.IsSuccess) OnMenuChanged?.Invoke();
        return res;
    }

    public async Task<Result> DeleteCategoryAsync(string id, string? reassignTo = null, CancellationToken ct = default)
    {
        var res = await _api.DeleteCategoryAsync(id, reassignTo, ct);
        if (res.IsSuccess) OnMenuChanged?.Invoke();
        return res;
    }

    public async Task<Result<ProductImageResponseDto>> UploadProductImageAsync(string id, byte[] jpegBytes, CancellationToken ct = default)
    {
        var res = await _api.UploadProductImageAsync(id, jpegBytes, ct);
        if (res.IsSuccess) OnMenuChanged?.Invoke();
        return res;
    }

    public async Task<Result> DeleteProductImageAsync(string id, CancellationToken ct = default)
    {
        var res = await _api.DeleteProductImageAsync(id, ct);
        if (res.IsSuccess) OnMenuChanged?.Invoke();
        return res;
    }
}
