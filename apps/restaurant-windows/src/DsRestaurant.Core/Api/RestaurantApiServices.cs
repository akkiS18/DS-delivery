using Microsoft.Extensions.DependencyInjection;

namespace DsRestaurant.Core.Api;

public static class RestaurantApiServices
{
    /// <summary>
    /// Registers the ONE <see cref="RestaurantApi"/> of the program. It holds the access token, so every service must share the same instance:
    /// <c>AddHttpClient&lt;RestaurantApi&gt;()</c> would register it as transient and each singleton service would get its own copy without the
    /// token (login works, then every other call is 401 and no data ever appears).
    /// </summary>
    public static IServiceCollection AddRestaurantApi(this IServiceCollection services)
    {
        services.AddHttpClient("restaurant-api", client => client.Timeout = TimeSpan.FromSeconds(15));
        services.AddSingleton(sp => new RestaurantApi(sp.GetRequiredService<IHttpClientFactory>().CreateClient("restaurant-api")));
        return services;
    }
}
