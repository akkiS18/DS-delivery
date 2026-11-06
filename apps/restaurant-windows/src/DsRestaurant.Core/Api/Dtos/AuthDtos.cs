using System.Text.Json.Serialization;

namespace DsRestaurant.Core.Api.Dtos;

public record LoginRequest(
    [property: JsonPropertyName("slug")] string Slug,
    [property: JsonPropertyName("password")] string Password
);

public record RestaurantDto(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("slug")] string Slug,
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("address")] string? Address = null,
    [property: JsonPropertyName("phone")] string? Phone = null,
    [property: JsonPropertyName("isActive")] bool? IsActive = null,
    [property: JsonPropertyName("isOpen")] bool? IsOpen = null,
    [property: JsonPropertyName("defaultPrepMinutes")] int? DefaultPrepMinutes = null,
    [property: JsonPropertyName("autoConfirm")] bool? AutoConfirm = null
);

public record SessionDto(
    [property: JsonPropertyName("expiresAt")] string? ExpiresAt = null
);

public record LoginResponse(
    [property: JsonPropertyName("accessToken")] string AccessToken,
    [property: JsonPropertyName("tokenType")] string? TokenType = null,
    [property: JsonPropertyName("expiresAt")] string? ExpiresAt = null,
    [property: JsonPropertyName("restaurant")] RestaurantDto? Restaurant = null
);

public record MeResponse(
    [property: JsonPropertyName("restaurant")] RestaurantDto? Restaurant = null,
    [property: JsonPropertyName("session")] SessionDto? Session = null
);
