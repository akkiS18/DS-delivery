using System.Collections.ObjectModel;
using System.Windows;
using System.Windows.Threading;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using DsRestaurant.Core.Api;
using DsRestaurant.Core.Api.Dtos;
using DsRestaurant.Core.Common;
using DsRestaurant.Core.Orders;

namespace DsRestaurant.App.ViewModels;

public partial class OrdersViewModel : ViewModelBase
{
    private readonly OrdersService _ordersService;
    private readonly DispatcherTimer _clockTimer;

    [ObservableProperty]
    private string _selectedTab = "new"; // new | cooking | ready | waiting | history

    [ObservableProperty]
    private int _newCount = 0;

    [ObservableProperty]
    private int _cookingCount = 0;

    [ObservableProperty]
    private int _readyCount = 0;

    [ObservableProperty]
    private int _waitingCount = 0;

    [ObservableProperty]
    private int _historyCount = 0;

    [ObservableProperty]
    private bool _isRinging = false;

    [ObservableProperty]
    private bool _isLoading = false;

    [ObservableProperty]
    private bool _isLoadingMore = false;

    [ObservableProperty]
    private string? _actionErrorMessage;

    [ObservableProperty]
    private OrderDetailViewModel? _selectedOrder;

    [ObservableProperty]
    private string? _nextCursor;

    public bool HasMore => !string.IsNullOrEmpty(NextCursor);

    partial void OnSelectedOrderChanged(OrderDetailViewModel? oldValue, OrderDetailViewModel? newValue)
    {
        if (oldValue != null) oldValue.IsSelected = false;
        if (newValue != null) newValue.IsSelected = true;
    }

    public ObservableCollection<OrderDetailViewModel> Orders { get; } = new();

    public OrdersViewModel(OrdersService ordersService)
    {
        _ordersService = ordersService;

        _ordersService.Poller.OnOrdersUpdated += HandlePollerUpdated;
        _ordersService.Poller.OnRingingStateChanged += ringing => IsRinging = ringing;
        _ordersService.OnOrdersListInvalidated += HandleListInvalidated;

        // UI timer to tick remaining seconds and age every second
        _clockTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
        _clockTimer.Tick += (s, e) => TickTimers();
        _clockTimer.Start();
    }

    private void TickTimers()
    {
        long now = Environment.TickCount64;
        foreach (var item in Orders)
        {
            item.UpdateTimer(now);
        }
        SelectedOrder?.UpdateTimer(now);
    }

    private void HandlePollerUpdated()
    {
        Application.Current?.Dispatcher.Invoke(() =>
        {
            var counts = _ordersService.Poller.LatestCounts;
            NewCount = counts.New;
            CookingCount = counts.Cooking;
            ReadyCount = counts.Ready;
            WaitingCount = counts.Waiting;
            IsRinging = _ordersService.Poller.IsRinging;

            // If user is currently looking at "new" tab, update list directly from poller
            if (SelectedTab == "new")
            {
                PopulateOrders(_ordersService.Poller.LatestNewOrders, _ordersService.Poller.LatestServerClock);
            }
        });
    }

    private void HandleListInvalidated()
    {
        Application.Current?.Dispatcher.Invoke(() =>
        {
            _ = LoadCurrentTabOrdersAsync();
        });
    }

    [RelayCommand]
    public void SelectTab(string tab)
    {
        if (SelectedTab == tab) return;
        SelectedTab = tab;
        _ = LoadCurrentTabOrdersAsync();
    }

    [RelayCommand]
    public async Task RefreshAsync()
    {
        await LoadCurrentTabOrdersAsync();
    }

    [RelayCommand]
    public void Silence()
    {
        _ordersService.Poller.Silence();
        IsRinging = _ordersService.Poller.IsRinging;
    }

    public async Task LoadCurrentTabOrdersAsync()
    {
        try
        {
            IsLoading = true;
            ActionErrorMessage = null;
            NextCursor = null;

            if (SelectedTab == "new" && _ordersService.Poller.LatestNewOrders.Count > 0)
            {
                PopulateOrders(_ordersService.Poller.LatestNewOrders, _ordersService.Poller.LatestServerClock);
                IsLoading = false;
                return;
            }

            var result = await _ordersService.GetOrdersAsync(SelectedTab);
            if (result.IsSuccess && result.Value != null)
            {
                var response = result.Value;
                NextCursor = response.NextCursor;
                OnPropertyChanged(nameof(HasMore));

                long nowElapsed = Environment.TickCount64;
                long serverNow = ServerClockHelper.ParseIsoMillis(response.Orders?.FirstOrDefault()?.ServerNow)
                                 ?? DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                var clock = new ServerClock(serverNow, nowElapsed);

                PopulateOrders(response.Orders ?? [], clock);
            }
            else
            {
                ActionErrorMessage = result.ErrorMessage;
            }
        }
        catch (Exception ex)
        {
            ActionErrorMessage = ApiError.MapExceptionToUzbek(ex);
        }
        finally
        {
            IsLoading = false;
        }
    }

    [RelayCommand]
    public async Task LoadMoreAsync()
    {
        if (string.IsNullOrEmpty(NextCursor) || IsLoadingMore) return;

        try
        {
            IsLoadingMore = true;
            var result = await _ordersService.GetOrdersAsync(SelectedTab, cursor: NextCursor);
            if (result.IsSuccess && result.Value != null)
            {
                var response = result.Value;
                NextCursor = response.NextCursor;
                OnPropertyChanged(nameof(HasMore));

                long nowElapsed = Environment.TickCount64;
                long serverNow = ServerClockHelper.ParseIsoMillis(response.Orders?.FirstOrDefault()?.ServerNow)
                                 ?? DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                var clock = new ServerClock(serverNow, nowElapsed);

                foreach (var o in response.Orders ?? [])
                {
                    Orders.Add(new OrderDetailViewModel(o, clock, nowElapsed));
                }
            }
        }
        catch (Exception ex)
        {
            ActionErrorMessage = ApiError.MapExceptionToUzbek(ex);
        }
        finally
        {
            IsLoadingMore = false;
        }
    }

    private void PopulateOrders(IEnumerable<OrderDto> dtos, ServerClock? clock)
    {
        string? previouslySelectedId = SelectedOrder?.Id;
        long now = Environment.TickCount64;

        Orders.Clear();
        foreach (var dto in dtos)
        {
            Orders.Add(new OrderDetailViewModel(dto, clock, now));
        }

        if (!string.IsNullOrEmpty(previouslySelectedId))
        {
            SelectedOrder = Orders.FirstOrDefault(o => o.Id == previouslySelectedId) ?? Orders.FirstOrDefault();
        }
        else
        {
            SelectedOrder = Orders.FirstOrDefault();
        }
    }

    // --- Order Action Handlers ---

    public async Task<bool> AcceptOrderAsync(int? prepMinutes)
    {
        if (SelectedOrder == null) return false;
        var res = await _ordersService.AcceptOrderAsync(SelectedOrder.Id, prepMinutes, SelectedOrder.Status);
        return HandleActionResult(res);
    }

    public async Task<bool> RejectOrderAsync(string reason)
    {
        if (SelectedOrder == null) return false;
        var res = await _ordersService.RejectOrderAsync(SelectedOrder.Id, reason, SelectedOrder.Status);
        return HandleActionResult(res);
    }

    public async Task<bool> StartPreparingAsync(int? prepMinutes)
    {
        if (SelectedOrder == null) return false;
        var res = await _ordersService.SetOrderPreparingAsync(SelectedOrder.Id, prepMinutes, SelectedOrder.Status);
        return HandleActionResult(res);
    }

    /// <summary>"Qabul qildim": the kitchen has seen the paid order (no preparation time is asked any more).</summary>
    public async Task<bool> SetPrepTimeAsync(int? minutes = null)
    {
        if (SelectedOrder == null) return false;
        var res = await _ordersService.SetPrepTimeAsync(SelectedOrder.Id, minutes, SelectedOrder.Status);
        return HandleActionResult(res);
    }

    public async Task<bool> MarkReadyAsync(bool isSelfDelivery)
    {
        if (SelectedOrder == null) return false;
        string? delivery = isSelfDelivery ? "SELF" : null;
        var res = await _ordersService.SetOrderReadyAsync(SelectedOrder.Id, delivery, SelectedOrder.Status);
        return HandleActionResult(res);
    }

    public async Task<bool> SetSelfDeliveredAsync()
    {
        if (SelectedOrder == null) return false;
        var res = await _ordersService.SetSelfDeliveredAsync(SelectedOrder.Id, SelectedOrder.Status);
        return HandleActionResult(res);
    }

    public async Task<bool> VerifyPaymentAsync()
    {
        if (SelectedOrder == null) return false;
        var res = await _ordersService.VerifyPaymentAsync(SelectedOrder.Id, confirmReceived: true, SelectedOrder.Status);
        return HandleActionResult(res);
    }

    public async Task<bool> CancelOrderAsync(string reason)
    {
        if (SelectedOrder == null) return false;
        var res = await _ordersService.CancelOrderAsync(SelectedOrder.Id, reason, SelectedOrder.Status);
        return HandleActionResult(res);
    }

    public async Task<bool> ApproveRefundAsync()
    {
        if (SelectedOrder == null) return false;
        var res = await _ordersService.ApproveRefundAsync(SelectedOrder.Id, SelectedOrder.Status);
        return HandleActionResult(res);
    }

    public async Task<bool> RejectRefundAsync(string reason)
    {
        if (SelectedOrder == null) return false;
        var res = await _ordersService.RejectRefundAsync(SelectedOrder.Id, reason, SelectedOrder.Status);
        return HandleActionResult(res);
    }

    private bool HandleActionResult(Result result)
    {
        if (!result.IsSuccess)
        {
            ActionErrorMessage = result.ErrorMessage;
            return false;
        }
        ActionErrorMessage = null;
        return true;
    }
}
