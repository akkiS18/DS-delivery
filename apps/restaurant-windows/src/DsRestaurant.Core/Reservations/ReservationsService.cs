using DsRestaurant.Core.Api;
using DsRestaurant.Core.Api.Dtos;
using DsRestaurant.Core.Common;

namespace DsRestaurant.Core.Reservations;

public class ReservationsService
{
    private readonly RestaurantApi _api;
    private HashSet<string> _notifiedReservationIds = new();

    public int UnseenCount { get; private set; }

    public event Action? OnReservationsChanged;
    public event Action<List<ReservationDto>>? OnNewReservationsAlert;

    public ReservationsService(RestaurantApi api)
    {
        _api = api;
    }

    public async Task<Result<ReservationsReportDto>> GetReservationsAsync(CancellationToken ct = default)
    {
        var res = await _api.GetReservationsAsync(ct);
        if (res.IsSuccess && res.Value != null)
        {
            var report = res.Value;
            UnseenCount = report.UnseenCount ?? 0;

            // Soft alert for new reservations (Plan section 123)
            var waiting = (report.Upcoming ?? [])
                .Where(r => r.Status != "CANCELLED" && (r.Seen == false || r.AwaitingConfirm == true))
                .ToList();

            var newIds = waiting.Select(r => r.Id ?? "").Where(id => !string.IsNullOrEmpty(id) && !_notifiedReservationIds.Contains(id)).ToList();
            if (newIds.Count > 0)
            {
                foreach (var id in newIds) _notifiedReservationIds.Add(id);
                OnNewReservationsAlert?.Invoke(waiting);
            }

            OnReservationsChanged?.Invoke();
        }
        return res;
    }

    public async Task<Result> MarkSeenAsync(string id, CancellationToken ct = default)
    {
        var res = await _api.MarkReservationSeenAsync(id, ct);
        if (res.IsSuccess) OnReservationsChanged?.Invoke();
        return res;
    }

    public async Task<Result> ConfirmPaymentAsync(string id, CancellationToken ct = default)
    {
        var res = await _api.ConfirmReservationPaymentAsync(id, ct);
        if (res.IsSuccess) OnReservationsChanged?.Invoke();
        return res;
    }

    public async Task<Result> CancelAsync(string id, string reason, CancellationToken ct = default)
    {
        var res = await _api.CancelReservationAsync(id, reason, ct);
        if (res.IsSuccess) OnReservationsChanged?.Invoke();
        return res;
    }

    public async Task<Result> UpdateSettingsAsync(bool enabled, int depositSom, CancellationToken ct = default)
    {
        var res = await _api.UpdateReservationSettingsAsync(enabled, depositSom, ct);
        if (res.IsSuccess) OnReservationsChanged?.Invoke();
        return res;
    }
}
