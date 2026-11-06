using DsRestaurant.Core.Api.Dtos;

namespace DsRestaurant.Core.Auth;

public record SessionData(
    string AccessToken,
    string? TokenType,
    string? ExpiresAt,
    RestaurantDto? Restaurant,
    string BaseUrl
);

public interface ISessionStore
{
    Task<SessionData?> LoadAsync();
    Task SaveAsync(SessionData session);
    Task ClearAsync();
}
