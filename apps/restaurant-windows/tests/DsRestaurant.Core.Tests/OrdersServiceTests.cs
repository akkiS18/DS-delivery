using System.Net;
using DsRestaurant.Core.Api;
using DsRestaurant.Core.Orders;
using FluentAssertions;
using RichardSzalay.MockHttp;
using Xunit;

namespace DsRestaurant.Core.Tests;

public class OrdersServiceTests
{
    private const string BaseUrl = "https://api.sultonxoja.uz/";

    [Fact]
    public async Task AcceptOrder_SendsExpectedStatus_AndInvalidatesList()
    {
        var mockHttp = new MockHttpMessageHandler();
        mockHttp.When(HttpMethod.Post, $"{BaseUrl}api/v1/restaurant/orders/ord_101/accept")
            .WithContent("""{"prepMinutes":25,"expectedStatus":"WAITING_RESTAURANT"}""")
            .Respond(HttpStatusCode.OK, "application/json", "{}");

        var httpClient = mockHttp.ToHttpClient();
        var api = new RestaurantApi(httpClient, BaseUrl) { AccessToken = "valid-token" };
        var poller = new OrderPoller(api, new NewOrderAttention(), new TestAlarmSink());
        var ordersService = new OrdersService(api, poller);

        bool invalidated = false;
        ordersService.OnOrdersListInvalidated += () => invalidated = true;

        var result = await ordersService.AcceptOrderAsync("ord_101", 25, "WAITING_RESTAURANT");

        result.IsSuccess.Should().BeTrue();
        invalidated.Should().BeTrue();
    }

    [Fact]
    public async Task Action_Stale409_ReturnsUzbekError_AndInvalidatesList()
    {
        var mockHttp = new MockHttpMessageHandler();
        mockHttp.When(HttpMethod.Post, $"{BaseUrl}api/v1/restaurant/orders/ord_101/ready")
            .Respond(HttpStatusCode.Conflict, "application/json", """
            {
                "error": "STALE"
            }
            """);

        var httpClient = mockHttp.ToHttpClient();
        var api = new RestaurantApi(httpClient, BaseUrl) { AccessToken = "valid-token" };
        var poller = new OrderPoller(api, new NewOrderAttention(), new TestAlarmSink());
        var ordersService = new OrdersService(api, poller);

        bool invalidated = false;
        ordersService.OnOrdersListInvalidated += () => invalidated = true;

        var result = await ordersService.SetOrderReadyAsync("ord_101", delivery: null, "PREPARING");

        result.IsSuccess.Should().BeFalse();
        result.StatusCode.Should().Be(409);
        result.ErrorMessage.Should().Be("Buyurtma allaqachon o‘zgargan. Yangilandi.");
        invalidated.Should().BeTrue(); // Plan 4.2: After any 409 reload the order list!
    }

    [Fact]
    public async Task RejectOrder_SendsReasonAndExpectedStatus()
    {
        var mockHttp = new MockHttpMessageHandler();
        mockHttp.When(HttpMethod.Post, $"{BaseUrl}api/v1/restaurant/orders/ord_101/reject")
            .WithContent("""{"reason":"OUT_OF_STOCK","expectedStatus":"WAITING_RESTAURANT"}""")
            .Respond(HttpStatusCode.OK, "application/json", "{}");

        var httpClient = mockHttp.ToHttpClient();
        var api = new RestaurantApi(httpClient, BaseUrl) { AccessToken = "valid-token" };
        var poller = new OrderPoller(api, new NewOrderAttention(), new TestAlarmSink());
        var ordersService = new OrdersService(api, poller);

        var result = await ordersService.RejectOrderAsync("ord_101", "OUT_OF_STOCK", "WAITING_RESTAURANT");

        result.IsSuccess.Should().BeTrue();
    }

    [Fact]
    public async Task VerifyPayment_SendsConfirmReceivedTrue()
    {
        var mockHttp = new MockHttpMessageHandler();
        mockHttp.When(HttpMethod.Post, $"{BaseUrl}api/v1/restaurant/orders/ord_101/verify-payment")
            .WithContent("""{"confirmReceived":true,"expectedStatus":"PAYMENT_MATCHED_UNVERIFIED"}""")
            .Respond(HttpStatusCode.OK, "application/json", "{}");

        var httpClient = mockHttp.ToHttpClient();
        var api = new RestaurantApi(httpClient, BaseUrl) { AccessToken = "valid-token" };
        var poller = new OrderPoller(api, new NewOrderAttention(), new TestAlarmSink());
        var ordersService = new OrdersService(api, poller);

        var result = await ordersService.VerifyPaymentAsync("ord_101", true, "PAYMENT_MATCHED_UNVERIFIED");

        result.IsSuccess.Should().BeTrue();
    }
}
