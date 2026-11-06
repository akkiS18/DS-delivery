using DsRestaurant.Core.Api;
using DsRestaurant.Core.Api.Dtos;
using DsRestaurant.Core.Common;

namespace DsRestaurant.Core.Finance;

public enum FinancePhase
{
    Checking,
    NoPin,
    Locked,
    Open
}

public abstract record UnlockResult
{
    public sealed record Success(string? UnlockedUntil) : UnlockResult;
    public sealed record WrongPin(int? AttemptsLeft) : UnlockResult;
    public sealed record Blocked(int RetryAfterSeconds) : UnlockResult;
    public sealed record NoPin : UnlockResult;
    public sealed record Failed(string Message) : UnlockResult;
}

public class FinanceService
{
    private readonly RestaurantApi _api;

    public FinancePhase CurrentPhase { get; private set; } = FinancePhase.Checking;
    public FinanceOverviewResponse? CurrentOverview { get; private set; }
    public string? UnlockedUntil { get; private set; }

    public event Action<FinancePhase>? OnPhaseChanged;
    public event Action? OnFinanceLocked;

    public FinanceService(RestaurantApi api)
    {
        _api = api;
    }

    public async Task<FinancePhase> RefreshStateAsync(CancellationToken ct = default)
    {
        CurrentPhase = FinancePhase.Checking;
        OnPhaseChanged?.Invoke(CurrentPhase);

        var res = await _api.GetFinanceStateAsync(ct);
        if (!res.IsSuccess)
        {
            // Network or other error -> default to Locked
            CurrentPhase = FinancePhase.Locked;
            CurrentOverview = null;
            OnPhaseChanged?.Invoke(CurrentPhase);
            return CurrentPhase;
        }

        var state = res.Value!;
        if (!state.HasPin)
        {
            CurrentPhase = FinancePhase.NoPin;
            CurrentOverview = null;
        }
        else if (state.Unlocked)
        {
            CurrentPhase = FinancePhase.Open;
            UnlockedUntil = state.UnlockedUntil;
            await RefreshOverviewAsync(ct);
        }
        else
        {
            CurrentPhase = FinancePhase.Locked;
            CurrentOverview = null;
        }

        OnPhaseChanged?.Invoke(CurrentPhase);
        return CurrentPhase;
    }

    public async Task<UnlockResult> UnlockAsync(string pin, CancellationToken ct = default)
    {
        var res = await _api.UnlockFinanceAsync(pin, ct);
        if (res.IsSuccess)
        {
            CurrentPhase = FinancePhase.Open;
            UnlockedUntil = res.Value?.UnlockedUntil;
            OnPhaseChanged?.Invoke(CurrentPhase);
            await RefreshOverviewAsync(ct);
            return new UnlockResult.Success(UnlockedUntil);
        }

        if (!res.IsSuccess)
        {
            if (res.StatusCode == 403 || res.ErrorCode == "FINANCE_PIN_WRONG")
            {
                return new UnlockResult.WrongPin(res.AttemptsLeft);
            }

            if (res.StatusCode == 429 || res.ErrorCode == "FINANCE_PIN_BLOCKED")
            {
                int retry = res.RetryAfterSeconds ?? 900;
                return new UnlockResult.Blocked(retry);
            }

            if (res.StatusCode == 409 || res.ErrorCode == "FINANCE_NO_PIN")
            {
                CurrentPhase = FinancePhase.NoPin;
                CurrentOverview = null;
                OnPhaseChanged?.Invoke(CurrentPhase);
                return new UnlockResult.NoPin();
            }

            return new UnlockResult.Failed(res.ErrorMessage ?? "Xatolik yuz berdi");
        }

        return new UnlockResult.Failed("Noma'lum xatolik");
    }

    public async Task LockAsync()
    {
        // 1. Wipe in-memory numbers immediately (Security requirement section 7 & 9)
        CurrentOverview = null;
        UnlockedUntil = null;
        CurrentPhase = FinancePhase.Locked;
        OnPhaseChanged?.Invoke(CurrentPhase);
        OnFinanceLocked?.Invoke();

        // 2. Notify backend
        try
        {
            await _api.LockFinanceAsync();
        }
        catch
        {
            // Ignore backend lock failure; local memory is already wiped
        }
    }

    public async Task<Result<FinanceOverviewResponse>> RefreshOverviewAsync(CancellationToken ct = default)
    {
        var res = await _api.GetFinanceOverviewAsync(ct);
        if (res.IsSuccess)
        {
            CurrentOverview = res.Value;
            return res;
        }

        if (res.StatusCode == 423 || res.ErrorCode == "FINANCE_LOCKED")
        {
            await LockAsync();
        }

        return res;
    }

    public async Task<Result<FinanceLedgerResponse>> GetLedgerAsync(
        string filter = "all",
        string? from = null,
        string? to = null,
        string? cursor = null,
        int limit = 20,
        CancellationToken ct = default)
    {
        var res = await _api.GetFinanceLedgerAsync(filter, from, to, cursor, limit, ct);
        if (!res.IsSuccess && (res.StatusCode == 423 || res.ErrorCode == "FINANCE_LOCKED"))
        {
            await LockAsync();
        }

        return res;
    }
}
