using DsRestaurant.Core.Api;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace DsRestaurant.Core.Tests;

public class RestaurantApiServicesTests
{
    [Fact]
    public void Every_service_gets_the_same_RestaurantApi_so_the_login_token_reaches_all_calls()
    {
        var services = new ServiceCollection();
        services.AddRestaurantApi();
        services.AddSingleton<UsesApi>();
        services.AddSingleton<AlsoUsesApi>();
        using var provider = services.BuildServiceProvider();

        var auth = provider.GetRequiredService<UsesApi>();
        var poller = provider.GetRequiredService<AlsoUsesApi>();

        poller.Api.Should().BeSameAs(auth.Api);
        auth.Api.AccessToken = "token-from-login";
        poller.Api.AccessToken.Should().Be("token-from-login");
    }

    private sealed class UsesApi(RestaurantApi api) { public RestaurantApi Api { get; } = api; }
    private sealed class AlsoUsesApi(RestaurantApi api) { public RestaurantApi Api { get; } = api; }
}
