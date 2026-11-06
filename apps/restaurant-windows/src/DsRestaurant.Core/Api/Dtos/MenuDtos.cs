using System.Text.Json.Serialization;

namespace DsRestaurant.Core.Api.Dtos;

public record CategoryDto(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("position")] int Position = 0,
    [property: JsonPropertyName("version")] int Version = 1,
    [property: JsonPropertyName("productCount")] int? ProductCount = null,
    [property: JsonPropertyName("imageUrl")] string? ImageUrl = null
);

public record CategoriesResponseDto(
    [property: JsonPropertyName("categories")] List<CategoryDto> Categories
);

public record CreateCategoryRequestDto(
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("position")] int? Position = null
);

public record UpdateCategoryRequestDto(
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("position")] int Position,
    [property: JsonPropertyName("version")] int Version
);

public record ProductDto(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("description")] string? Description = null,
    [property: JsonPropertyName("priceSom")] int PriceSom = 0,
    [property: JsonPropertyName("imageUrl")] string? ImageUrl = null,
    [property: JsonPropertyName("categoryId")] string? CategoryId = null,
    [property: JsonPropertyName("isAvailable")] bool IsAvailable = true,
    [property: JsonPropertyName("archivedAt")] string? ArchivedAt = null,
    [property: JsonPropertyName("version")] int Version = 1,
    [property: JsonPropertyName("createdAt")] string? CreatedAt = null,
    [property: JsonPropertyName("updatedAt")] string? UpdatedAt = null
);

public record ProductsResponseDto(
    [property: JsonPropertyName("products")] List<ProductDto> Products
);

public record CreateProductRequestDto(
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("priceSom")] int PriceSom,
    [property: JsonPropertyName("description")] string? Description = null,
    [property: JsonPropertyName("categoryId")] string? CategoryId = null,
    [property: JsonPropertyName("isAvailable")] bool IsAvailable = true
);

public record UpdateProductRequestDto(
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("priceSom")] int PriceSom,
    [property: JsonPropertyName("description")] string? Description,
    [property: JsonPropertyName("categoryId")] string? CategoryId,
    [property: JsonPropertyName("version")] int Version
);

public record UpdateAvailabilityRequestDto(
    [property: JsonPropertyName("isAvailable")] bool IsAvailable,
    [property: JsonPropertyName("version")] int? Version = null
);

public record ProductImageResponseDto(
    [property: JsonPropertyName("version")] int Version,
    [property: JsonPropertyName("imageUrl")] string ImageUrl
);
