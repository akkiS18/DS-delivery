using DsRestaurant.Core.Api;
using DsRestaurant.Core.Api.Dtos;
using DsRestaurant.Core.Common;

namespace DsRestaurant.Core.Orders;

public class OrdersService
{
    private readonly RestaurantApi _api;
    public OrderPoller Poller { get; }

    public event Action? OnOrdersListInvalidated;

    public OrdersService(RestaurantApi api, OrderPoller poller)
    {
        _api = api;
        Poller = poller;
    }

    public Task<Result<OrdersResponse>> GetOrdersAsync(string filter, string? cursor = null, CancellationToken ct = default)
    {
        return _api.GetOrdersAsync(filter, limit: 20, cursor: cursor, ct: ct);
    }

    public Task<Result<OrderDto>> GetOrderByIdAsync(string id, CancellationToken ct = default)
    {
        return _api.GetOrderByIdAsync(id, ct: ct);
    }

    private async Task<Result> ExecuteActionAsync(Func<Task<Result>> action)
    {
        var result = await action();
        // Plan 4.2 line 91: After any 409 or successful action, reload the order list
        if (result.IsSuccess || result.StatusCode == 409)
        {
            OnOrdersListInvalidated?.Invoke();
        }
        return result;
    }

    public Task<Result> AcceptOrderAsync(string id, int? prepMinutes, string expectedStatus, CancellationToken ct = default)
    {
        return ExecuteActionAsync(() => _api.AcceptOrderAsync(id, prepMinutes, expectedStatus, ct));
    }

    public Task<Result> RejectOrderAsync(string id, string reason, string expectedStatus, CancellationToken ct = default)
    {
        return ExecuteActionAsync(() => _api.RejectOrderAsync(id, reason, expectedStatus, ct));
    }

    public Task<Result> SetOrderPreparingAsync(string id, int? prepMinutes, string expectedStatus, CancellationToken ct = default)
    {
        return ExecuteActionAsync(() => _api.SetOrderPreparingAsync(id, prepMinutes, expectedStatus, ct));
    }

    public Task<Result> SetPrepTimeAsync(string id, int? minutes, string expectedStatus, CancellationToken ct = default)
    {
        return ExecuteActionAsync(() => _api.SetPrepTimeAsync(id, minutes, expectedStatus, ct));
    }

    public Task<Result> SetOrderReadyAsync(string id, string? delivery, string expectedStatus, CancellationToken ct = default)
    {
        return ExecuteActionAsync(() => _api.SetOrderReadyAsync(id, delivery, expectedStatus, ct));
    }

    public Task<Result> SetSelfDeliveredAsync(string id, string expectedStatus, CancellationToken ct = default)
    {
        return ExecuteActionAsync(() => _api.SetSelfDeliveredAsync(id, expectedStatus, ct));
    }

    public Task<Result> VerifyPaymentAsync(string id, bool confirmReceived, string expectedStatus, CancellationToken ct = default)
    {
        return ExecuteActionAsync(() => _api.VerifyPaymentAsync(id, confirmReceived, expectedStatus, ct));
    }

    public Task<Result> CancelOrderAsync(string id, string reason, string expectedStatus, CancellationToken ct = default)
    {
        return ExecuteActionAsync(() => _api.CancelOrderAsync(id, reason, expectedStatus, ct));
    }

    public Task<Result> ApproveRefundAsync(string id, string expectedStatus, CancellationToken ct = default)
    {
        return ExecuteActionAsync(() => _api.ApproveRefundAsync(id, expectedStatus, ct));
    }

    public Task<Result> RejectRefundAsync(string id, string rejectReason, string expectedStatus, CancellationToken ct = default)
    {
        return ExecuteActionAsync(() => _api.RejectRefundAsync(id, rejectReason, expectedStatus, ct));
    }
}
