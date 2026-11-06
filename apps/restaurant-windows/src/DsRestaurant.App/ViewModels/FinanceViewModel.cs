using System.Collections.ObjectModel;
using System.Windows;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using DsRestaurant.Core.Api.Dtos;
using DsRestaurant.Core.Finance;

namespace DsRestaurant.App.ViewModels;

public partial class FinanceViewModel : ViewModelBase
{
    private readonly FinanceService _financeService;

    [ObservableProperty]
    private FinancePhase _phase = FinancePhase.Checking;

    [ObservableProperty]
    private string _pin = "";

    [ObservableProperty]
    private bool _pinBusy;

    [ObservableProperty]
    private string? _pinError;

    [ObservableProperty]
    private bool _isLoading;

    [ObservableProperty]
    private string? _errorMessage;

    // PIN Dots
    public bool Dot1Filled => Pin.Length >= 1;
    public bool Dot2Filled => Pin.Length >= 2;
    public bool Dot3Filled => Pin.Length >= 3;
    public bool Dot4Filled => Pin.Length >= 4;

    // --- Overview Properties ---
    [ObservableProperty]
    private bool _hasPlatformCard;

    [ObservableProperty]
    private string _platformRemainingText = "0 so‘m";

    [ObservableProperty]
    private string _platformEarnedText = "0 so‘m";

    [ObservableProperty]
    private string _platformFeeText = "0 so‘m";

    [ObservableProperty]
    private string _platformPaidOutText = "0 so‘m";

    [ObservableProperty]
    private double _platformProgressRatio = 0.0;

    [ObservableProperty]
    private bool _hasOwnCard;

    [ObservableProperty]
    private string _ownFeeRemainingText = "0 so‘m";

    [ObservableProperty]
    private string _ownEarnedText = "0 so‘m";

    [ObservableProperty]
    private string _ownFeeText = "0 so‘m";

    [ObservableProperty]
    private string _ownSettledText = "0 so‘m";

    [ObservableProperty]
    private double _ownProgressRatio = 0.0;

    [ObservableProperty]
    private bool _hasOpenRefunds;

    [ObservableProperty]
    private int _openRefundsCount;

    [ObservableProperty]
    private string _openRefundsAmountText = "0 so‘m";

    // --- History / Jami Ledger Properties ---
    [ObservableProperty]
    private bool _historyOpen;

    [ObservableProperty]
    private HistoryPeriod _selectedPeriod = HistoryPeriod.All;

    [ObservableProperty]
    private HistorySource _selectedSource = HistorySource.All;

    [ObservableProperty]
    private string _totalsEarnedText = "0 so‘m";

    [ObservableProperty]
    private int _totalsOrdersCount = 0;

    [ObservableProperty]
    private string _totalsFeeText = "0 so‘m";

    [ObservableProperty]
    private string _totalsPaidOutText = "0 so‘m";

    [ObservableProperty]
    private bool _hasPaidOut = false;

    [ObservableProperty]
    private bool _isLedgerLoading;

    [ObservableProperty]
    private bool _isLedgerLoadingMore;

    [ObservableProperty]
    private string? _nextCursor;

    public bool HasNextCursor => !string.IsNullOrEmpty(NextCursor);

    public ObservableCollection<FinanceLedgerItemDto> LedgerItems { get; } = new();

    public FinanceViewModel(FinanceService financeService)
    {
        _financeService = financeService;
        _financeService.OnPhaseChanged += p =>
        {
            Application.Current?.Dispatcher.Invoke(() => Phase = p);
        };
        _financeService.OnFinanceLocked += () =>
        {
            Application.Current?.Dispatcher.Invoke(() =>
            {
                ClearOverview();
                HistoryOpen = false;
                Pin = "";
                PinError = null;
                NotifyDotsChanged();
            });
        };
    }

    private void NotifyDotsChanged()
    {
        OnPropertyChanged(nameof(Dot1Filled));
        OnPropertyChanged(nameof(Dot2Filled));
        OnPropertyChanged(nameof(Dot3Filled));
        OnPropertyChanged(nameof(Dot4Filled));
    }

    [RelayCommand]
    public async Task RefreshAsync()
    {
        if (PinBusy) return;
        IsLoading = true;
        ErrorMessage = null;
        try
        {
            var phase = await _financeService.RefreshStateAsync();
            Phase = phase;
            if (phase == FinancePhase.Open)
            {
                SyncOverviewData();
            }
        }
        catch (Exception ex)
        {
            ErrorMessage = ex.Message;
            Phase = FinancePhase.Locked;
        }
        finally
        {
            IsLoading = false;
        }
    }

    // --- Keypad Input ---
    [RelayCommand]
    public void AppendDigit(string digit)
    {
        if (PinBusy || Phase != FinancePhase.Locked || Pin.Length >= 4) return;
        if (string.IsNullOrEmpty(digit) || !char.IsDigit(digit[0])) return;

        Pin += digit[0];
        PinError = null;
        NotifyDotsChanged();

        if (Pin.Length == 4)
        {
            _ = SubmitPinAsync(Pin);
        }
    }

    [RelayCommand]
    public void Backspace()
    {
        if (PinBusy || Pin.Length == 0) return;
        Pin = Pin[..^1];
        PinError = null;
        NotifyDotsChanged();
    }

    [RelayCommand]
    public void ClearPin()
    {
        if (PinBusy) return;
        Pin = "";
        PinError = null;
        NotifyDotsChanged();
    }

    private async Task SubmitPinAsync(string pinToSubmit)
    {
        PinBusy = true;
        PinError = null;
        try
        {
            var result = await _financeService.UnlockAsync(pinToSubmit);
            switch (result)
            {
                case UnlockResult.Success:
                    Pin = "";
                    PinBusy = false;
                    Phase = FinancePhase.Open;
                    SyncOverviewData();
                    break;
                case UnlockResult.WrongPin wrong:
                    Pin = "";
                    PinBusy = false;
                    PinError = wrong.AttemptsLeft.HasValue
                        ? $"Kod noto‘g‘ri. Yana {wrong.AttemptsLeft.Value} marta urinish mumkin."
                        : "Kod noto‘g‘ri. Qaytadan urinib ko‘ring.";
                    break;
                case UnlockResult.Blocked blocked:
                    Pin = "";
                    PinBusy = false;
                    int mins = (blocked.RetryAfterSeconds + 59) / 60;
                    PinError = $"Juda ko‘p xato kiritildi. {mins} daqiqadan keyin urinib ko‘ring.";
                    break;
                case UnlockResult.NoPin:
                    Pin = "";
                    PinBusy = false;
                    Phase = FinancePhase.NoPin;
                    break;
                case UnlockResult.Failed failed:
                    Pin = "";
                    PinBusy = false;
                    PinError = failed.Message;
                    break;
            }
        }
        catch (Exception ex)
        {
            Pin = "";
            PinBusy = false;
            PinError = ex.Message;
        }
        finally
        {
            NotifyDotsChanged();
        }
    }

    [RelayCommand]
    public async Task LockAsync()
    {
        await _financeService.LockAsync();
    }

    private void SyncOverviewData()
    {
        var ov = _financeService.CurrentOverview;
        if (ov == null)
        {
            ClearOverview();
            return;
        }

        // Platform Card
        var pc = ov.PlatformCard;
        if (pc != null && (ov.CollectsToPlatform == true || pc.CollectedSom > 0 || pc.RemainingSom > 0))
        {
            HasPlatformCard = true;
            PlatformRemainingText = FinanceFormat.Som(pc.RemainingSom);
            PlatformEarnedText = FinanceFormat.Som(pc.RestaurantEarnedSom);
            PlatformFeeText = FinanceFormat.Som(pc.PlatformFeeSom);
            PlatformPaidOutText = FinanceFormat.Som(pc.PaidOutSom);
            PlatformProgressRatio = FinanceFormat.Share(pc.PaidOutSom, pc.RestaurantEarnedSom);
        }
        else
        {
            HasPlatformCard = false;
        }

        // Own Card
        var oc = ov.OwnCard;
        if (oc != null && (ov.CollectsToPlatform == false || oc.CollectedSom > 0 || oc.FeeRemainingSom > 0))
        {
            HasOwnCard = true;
            OwnFeeRemainingText = FinanceFormat.Som(oc.FeeRemainingSom);
            OwnEarnedText = FinanceFormat.Som(oc.RestaurantEarnedSom);
            OwnFeeText = FinanceFormat.Som(oc.PlatformFeeSom);
            OwnSettledText = FinanceFormat.Som(oc.FeeSettledSom);
            OwnProgressRatio = FinanceFormat.Share(oc.FeeSettledSom, oc.PlatformFeeSom);
        }
        else
        {
            HasOwnCard = false;
        }

        // Refunds
        var rf = ov.OpenRefunds;
        if (rf != null && rf.Count > 0)
        {
            HasOpenRefunds = true;
            OpenRefundsCount = rf.Count;
            OpenRefundsAmountText = FinanceFormat.Som(rf.AmountSom);
        }
        else
        {
            HasOpenRefunds = false;
            OpenRefundsCount = 0;
            OpenRefundsAmountText = "0 so‘m";
        }
    }

    private void ClearOverview()
    {
        HasPlatformCard = false;
        HasOwnCard = false;
        HasOpenRefunds = false;
        PlatformRemainingText = "0 so‘m";
        PlatformEarnedText = "0 so‘m";
        PlatformFeeText = "0 so‘m";
        PlatformPaidOutText = "0 so‘m";
        PlatformProgressRatio = 0.0;
        OwnFeeRemainingText = "0 so‘m";
        OwnEarnedText = "0 so‘m";
        OwnFeeText = "0 so‘m";
        OwnSettledText = "0 so‘m";
        OwnProgressRatio = 0.0;
        OpenRefundsCount = 0;
        OpenRefundsAmountText = "0 so‘m";
        LedgerItems.Clear();
        NextCursor = null;
        OnPropertyChanged(nameof(HasNextCursor));
    }

    // --- History / Jami Ledger Navigation ---
    [RelayCommand]
    public void OpenHistory()
    {
        HistoryOpen = true;
        _ = LoadLedgerAsync();
    }

    [RelayCommand]
    public void CloseHistory()
    {
        HistoryOpen = false;
    }

    [RelayCommand]
    public void SelectPeriod(string periodName)
    {
        if (Enum.TryParse<HistoryPeriod>(periodName, true, out var p))
        {
            SelectedPeriod = p;
            _ = LoadLedgerAsync();
        }
    }

    [RelayCommand]
    public void SelectSource(string sourceName)
    {
        if (Enum.TryParse<HistorySource>(sourceName, true, out var s))
        {
            SelectedSource = s;
            _ = LoadLedgerAsync();
        }
    }

    [RelayCommand]
    public async Task LoadLedgerAsync()
    {
        IsLedgerLoading = true;
        ErrorMessage = null;
        LedgerItems.Clear();
        NextCursor = null;
        OnPropertyChanged(nameof(HasNextCursor));

        try
        {
            var (from, to) = SelectedPeriod.GetRange();
            var res = await _financeService.GetLedgerAsync(
                filter: SelectedSource.GetQuery(),
                from: from,
                to: to,
                cursor: null,
                limit: 20);

            if (res.IsSuccess && res.Value != null)
            {
                var ledger = res.Value;
                if (ledger.Totals != null)
                {
                    TotalsEarnedText = FinanceFormat.Som(ledger.Totals.RestaurantEarnedSom);
                    TotalsOrdersCount = ledger.Totals.Orders;
                    TotalsFeeText = FinanceFormat.Som(ledger.Totals.PlatformFeeSom);
                    TotalsPaidOutText = FinanceFormat.Som(ledger.Totals.PaidOutSom);
                    HasPaidOut = ledger.Totals.PaidOutSom > 0;
                }

                if (ledger.Items != null)
                {
                    foreach (var item in ledger.Items)
                    {
                        LedgerItems.Add(item);
                    }
                }

                NextCursor = ledger.NextCursor;
                OnPropertyChanged(nameof(HasNextCursor));
            }
            else
            {
                ErrorMessage = res.ErrorMessage;
            }
        }
        catch (Exception ex)
        {
            ErrorMessage = ex.Message;
        }
        finally
        {
            IsLedgerLoading = false;
        }
    }

    [RelayCommand]
    public async Task LoadMoreLedgerAsync()
    {
        if (IsLedgerLoading || IsLedgerLoadingMore || string.IsNullOrEmpty(NextCursor)) return;
        IsLedgerLoadingMore = true;

        try
        {
            var (from, to) = SelectedPeriod.GetRange();
            var res = await _financeService.GetLedgerAsync(
                filter: SelectedSource.GetQuery(),
                from: from,
                to: to,
                cursor: NextCursor,
                limit: 20);

            if (res.IsSuccess && res.Value != null)
            {
                var ledger = res.Value;
                if (ledger.Items != null)
                {
                    foreach (var item in ledger.Items)
                    {
                        LedgerItems.Add(item);
                    }
                }

                NextCursor = ledger.NextCursor;
                OnPropertyChanged(nameof(HasNextCursor));
            }
        }
        catch (Exception ex)
        {
            ErrorMessage = ex.Message;
        }
        finally
        {
            IsLedgerLoadingMore = false;
        }
    }
}
