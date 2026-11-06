using DsRestaurant.Core.Api;
using DsRestaurant.Core.Api.Dtos;
using DsRestaurant.Core.Common;

namespace DsRestaurant.Core.Operations;

public class OperationsService
{
    private readonly RestaurantApi _api;

    public OperationsResponseDto? CurrentOperations { get; private set; }

    public event Action? OnOperationsChanged;

    public OperationsService(RestaurantApi api)
    {
        _api = api;
    }

    public async Task<Result<OperationsResponseDto>> GetOperationsAsync(CancellationToken ct = default)
    {
        var res = await _api.GetOperationsAsync(ct);
        if (res.IsSuccess && res.Value != null)
        {
            CurrentOperations = res.Value;
            OnOperationsChanged?.Invoke();
        }
        return res;
    }

    public async Task<Result<OperationsResponseDto>> SetPausedAsync(bool isPaused, CancellationToken ct = default)
    {
        var res = await _api.UpdateOperationsStatusAsync(isPaused, ct);
        if (res.IsSuccess && res.Value != null)
        {
            CurrentOperations = res.Value;
            OnOperationsChanged?.Invoke();
        }
        return res;
    }

    public async Task<Result<OperationsResponseDto>> UpdateWorkingHoursAsync(List<WorkingDayDto> days, CancellationToken ct = default)
    {
        var res = await _api.UpdateWorkingHoursAsync(days, ct);
        if (res.IsSuccess && res.Value != null)
        {
            CurrentOperations = res.Value;
            OnOperationsChanged?.Invoke();
        }
        return res;
    }

    public async Task<Result<OperationsResponseDto>> UpdatePrepTimeAsync(int defaultPrepMinutes, CancellationToken ct = default)
    {
        var res = await _api.UpdatePrepTimeAsync(defaultPrepMinutes, ct);
        if (res.IsSuccess && res.Value != null)
        {
            CurrentOperations = res.Value;
            OnOperationsChanged?.Invoke();
        }
        return res;
    }
}
