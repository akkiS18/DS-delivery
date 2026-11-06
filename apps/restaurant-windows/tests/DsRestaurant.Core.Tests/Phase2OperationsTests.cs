using System.Net;
using DsRestaurant.Core.Api;
using DsRestaurant.Core.Api.Dtos;
using DsRestaurant.Core.Cards;
using DsRestaurant.Core.Menu;
using DsRestaurant.Core.Operations;
using DsRestaurant.Core.Reservations;
using FluentAssertions;
using RichardSzalay.MockHttp;
using Xunit;

namespace DsRestaurant.Core.Tests;

public class Phase2OperationsTests
{
    private const string BaseUrl = "https://api.sultonxoja.uz/";

    [Fact]
    public async Task Operations_SetPaused_SendsRequest_AndFiresEvent()
    {
        var mockHttp = new MockHttpMessageHandler();
        mockHttp.When(HttpMethod.Patch, $"{BaseUrl}api/v1/restaurant/operations/status")
            .WithContent("""{"isPaused":true}""")
            .Respond("application/json", """{"isPaused":true,"defaultPrepMinutes":25}""");

        var httpClient = mockHttp.ToHttpClient();
        var api = new RestaurantApi(httpClient, BaseUrl) { AccessToken = "valid-token" };
        var operationsService = new OperationsService(api);

        bool changedFired = false;
        operationsService.OnOperationsChanged += () => changedFired = true;

        var res = await operationsService.SetPausedAsync(true);

        res.IsSuccess.Should().BeTrue();
        res.Value!.IsPaused.Should().BeTrue();
        operationsService.CurrentOperations!.IsPaused.Should().BeTrue();
        changedFired.Should().BeTrue();
    }

    [Fact]
    public async Task Menu_ToggleAvailability_SendsIdempotentPatch()
    {
        var mockHttp = new MockHttpMessageHandler();
        mockHttp.When(HttpMethod.Patch, $"{BaseUrl}api/v1/restaurant/products/prod_1/availability")
            .WithContent("""{"isAvailable":false}""")
            .Respond("application/json", """{"id":"prod_1","name":"Palov","isAvailable":false,"version":2}""");

        var httpClient = mockHttp.ToHttpClient();
        var api = new RestaurantApi(httpClient, BaseUrl) { AccessToken = "valid-token" };
        var menuService = new MenuService(api);

        var res = await menuService.ToggleProductAvailabilityAsync("prod_1", false, null);

        res.IsSuccess.Should().BeTrue();
        res.Value!.IsAvailable.Should().BeFalse();
    }

    [Fact]
    public async Task Menu_PriceEditWithoutPause_ReturnsUzbekRuleError()
    {
        var mockHttp = new MockHttpMessageHandler();
        mockHttp.When(HttpMethod.Put, $"{BaseUrl}api/v1/restaurant/products/prod_1")
            .Respond(HttpStatusCode.Conflict, "application/json", """{"error":"PRICE_EDIT_REQUIRES_PAUSE"}""");

        var httpClient = mockHttp.ToHttpClient();
        var api = new RestaurantApi(httpClient, BaseUrl) { AccessToken = "valid-token" };
        var menuService = new MenuService(api);

        var req = new UpdateProductRequestDto("Palov", 55000, "Mazali", "cat_1", 1);
        var res = await menuService.UpdateProductAsync("prod_1", req);

        res.IsSuccess.Should().BeFalse();
        res.StatusCode.Should().Be(409);
        res.ErrorMessage.Should().Be("Narxni o‘zgartirish uchun avval Sozlamalarda qabulni to‘xtating.");
    }

    [Fact]
    public async Task Menu_VersionConflict_ReturnsUzbekMessage()
    {
        var mockHttp = new MockHttpMessageHandler();
        mockHttp.When(HttpMethod.Put, $"{BaseUrl}api/v1/restaurant/products/prod_1")
            .Respond(HttpStatusCode.Conflict, "application/json", """{"error":"VERSION_CONFLICT"}""");

        var httpClient = mockHttp.ToHttpClient();
        var api = new RestaurantApi(httpClient, BaseUrl) { AccessToken = "valid-token" };
        var menuService = new MenuService(api);

        var req = new UpdateProductRequestDto("Palov", 50000, null, null, 1);
        var res = await menuService.UpdateProductAsync("prod_1", req);

        res.IsSuccess.Should().BeFalse();
        res.StatusCode.Should().Be(409);
        res.ErrorMessage.Should().Be("Boshqa joyda o‘zgartirilgan. Yangilab, qayta urinib ko‘ring.");
    }

    [Fact]
    public async Task Reservations_UpcomingWithUnseen_FiresAlert()
    {
        var mockHttp = new MockHttpMessageHandler();
        mockHttp.When(HttpMethod.Get, $"{BaseUrl}api/v1/restaurant/reservations")
            .Respond("application/json", """
            {
                "unseenCount": 1,
                "upcoming": [
                    {
                        "id": "res_1",
                        "code": "BR101",
                        "customerName": "Ali Valiyev",
                        "partySize": 4,
                        "seen": false,
                        "awaitingConfirm": true
                    }
                ]
            }
            """);

        var httpClient = mockHttp.ToHttpClient();
        var api = new RestaurantApi(httpClient, BaseUrl) { AccessToken = "valid-token" };
        var reservationsService = new ReservationsService(api);

        List<ReservationDto>? alerted = null;
        reservationsService.OnNewReservationsAlert += list => alerted = list;

        var res = await reservationsService.GetReservationsAsync();

        res.IsSuccess.Should().BeTrue();
        reservationsService.UnseenCount.Should().Be(1);
        alerted.Should().NotBeNull();
        alerted!.Should().HaveCount(1);
        alerted[0].Code.Should().Be("BR101");
    }

    [Fact]
    public async Task Cards_AddAndList_ReturnsMaskedCards()
    {
        var mockHttp = new MockHttpMessageHandler();
        mockHttp.When(HttpMethod.Get, $"{BaseUrl}api/v1/restaurant/cards")
            .Respond("application/json", """
            {
                "cards": [
                    { "id": "card_1", "last4": "8600", "masked": "8600 **** **** 1234", "status": "ACTIVE" }
                ]
            }
            """);

        var httpClient = mockHttp.ToHttpClient();
        var api = new RestaurantApi(httpClient, BaseUrl) { AccessToken = "valid-token" };
        var cardsService = new CardsService(api);

        var res = await cardsService.GetCardsAsync();

        res.IsSuccess.Should().BeTrue();
        res.Value.Should().HaveCount(1);
        res.Value![0].Last4.Should().Be("8600");
    }
}
