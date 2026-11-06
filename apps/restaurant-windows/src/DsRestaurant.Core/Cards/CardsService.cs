using DsRestaurant.Core.Api;
using DsRestaurant.Core.Api.Dtos;
using DsRestaurant.Core.Common;

namespace DsRestaurant.Core.Cards;

public class CardsService
{
    private readonly RestaurantApi _api;

    public event Action? OnCardsChanged;

    public CardsService(RestaurantApi api)
    {
        _api = api;
    }

    public async Task<Result<List<CardDto>>> GetCardsAsync(CancellationToken ct = default)
    {
        var res = await _api.GetCardsAsync(ct);
        if (res.IsSuccess)
        {
            return Result<List<CardDto>>.Ok(res.Value?.Cards ?? []);
        }
        return Result<List<CardDto>>.Fail(res.ErrorMessage ?? "Kartalarni yuklab bo‘lmadi", res.ErrorCode, res.StatusCode);
    }

    public async Task<Result<CardDto>> AddCardAsync(string number, string holderName, CancellationToken ct = default)
    {
        var res = await _api.AddCardAsync(number, holderName, ct);
        if (res.IsSuccess && res.Value?.Card != null)
        {
            OnCardsChanged?.Invoke();
            return Result<CardDto>.Ok(res.Value.Card);
        }
        return Result<CardDto>.Fail(res.ErrorMessage ?? "Kartani qo‘shib bo‘lmadi", res.ErrorCode, res.StatusCode);
    }

    public async Task<Result<CardDto>> DisableCardAsync(string id, CancellationToken ct = default)
    {
        var res = await _api.DisableCardAsync(id, ct);
        if (res.IsSuccess && res.Value?.Card != null)
        {
            OnCardsChanged?.Invoke();
            return Result<CardDto>.Ok(res.Value.Card);
        }
        return Result<CardDto>.Fail(res.ErrorMessage ?? "Kartani o‘chirib bo‘lmadi", res.ErrorCode, res.StatusCode);
    }

    public async Task<Result<CardDto>> EnableCardAsync(string id, CancellationToken ct = default)
    {
        var res = await _api.EnableCardAsync(id, ct);
        if (res.IsSuccess && res.Value?.Card != null)
        {
            OnCardsChanged?.Invoke();
            return Result<CardDto>.Ok(res.Value.Card);
        }
        return Result<CardDto>.Fail(res.ErrorMessage ?? "Kartani yoqib bo‘lmadi", res.ErrorCode, res.StatusCode);
    }
}
