using System.Windows;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using DsRestaurant.App.Native;
using DsRestaurant.Core.Api.Dtos;
using DsRestaurant.Core.Auth;
using DsRestaurant.Core.Orders;

namespace DsRestaurant.App.ViewModels;

public partial class MainViewModel : ViewModelBase
{
    private readonly AuthService _authService;
    private readonly OrdersService _ordersService;

    [ObservableProperty]
    private bool _isAuthenticated;

    [ObservableProperty]
    private string _restaurantName = "";

    [ObservableProperty]
    private string _restaurantSlug = "";

    [ObservableProperty]
    private string _selectedSection = "Buyurtmalar";

    [ObservableProperty]
    private string _connectionDotColor = "#22C55E"; // Green

    [ObservableProperty]
    private string _connectionStatusText = "Ulangan";

    public LoginViewModel LoginVm { get; }
    public OrdersViewModel OrdersVm { get; }
    public MenuViewModel MenuVm { get; }
    public ReservationsViewModel ReservationsVm { get; }
    public FinanceViewModel FinanceVm { get; }
    public SettingsViewModel SettingsVm { get; }

    public event Action? OnAttentionRequired;

    public MainViewModel(
        AuthService authService,
        OrdersService ordersService,
        LoginViewModel loginVm,
        OrdersViewModel ordersVm,
        MenuViewModel menuVm,
        ReservationsViewModel reservationsVm,
        FinanceViewModel financeVm,
        SettingsViewModel settingsVm)
    {
        _authService = authService;
        _ordersService = ordersService;
        LoginVm = loginVm;
        OrdersVm = ordersVm;
        MenuVm = menuVm;
        ReservationsVm = reservationsVm;
        FinanceVm = financeVm;
        SettingsVm = settingsVm;

        _authService.AuthStateChanged += OnAuthStateChanged;
        _ordersService.Poller.OnConnectionStateChanged += HandleConnectionStateChanged;
        _ordersService.Poller.OnNewOrdersArrived += HandleNewOrdersArrived;

        SyncAuthState(_authService.IsAuthenticated);
    }

    private void HandleConnectionStateChanged(PollerConnectionState state)
    {
        Application.Current?.Dispatcher.Invoke(() =>
        {
            switch (state)
            {
                case PollerConnectionState.Connected:
                    ConnectionDotColor = "#22C55E"; // Green
                    ConnectionStatusText = "Ulangan";
                    break;
                case PollerConnectionState.Retrying:
                    ConnectionDotColor = "#F59E0B"; // Orange
                    ConnectionStatusText = "Qayta ulanmoqda...";
                    break;
                case PollerConnectionState.Offline:
                    ConnectionDotColor = "#EF4444"; // Red
                    ConnectionStatusText = "Oflayn";
                    break;
            }
        });
    }

    private void HandleNewOrdersArrived(IReadOnlyList<OrderDto> newOrders)
    {
        Application.Current?.Dispatcher.Invoke(() =>
        {
            OnAttentionRequired?.Invoke();
        });
    }

    private void OnAuthStateChanged(bool isAuth)
    {
        Application.Current?.Dispatcher.Invoke(() => SyncAuthState(isAuth));
    }

    private void SyncAuthState(bool isAuth)
    {
        IsAuthenticated = isAuth;
        if (isAuth)
        {
            var r = _authService.CurrentRestaurant;
            RestaurantName = r?.Name ?? "Restoran";
            RestaurantSlug = r?.Slug ?? "";
            SelectedSection = "Buyurtmalar";

            // Prevent sleep while logged in (Plan section 141)
            WindowNativeMethods.PreventSleep();

            // Start order poller
            _ordersService.Poller.Start();
            _ = OrdersVm.LoadCurrentTabOrdersAsync();
        }
        else
        {
            RestaurantName = "";
            RestaurantSlug = "";
            ConnectionDotColor = "#EF4444";
            ConnectionStatusText = "Oflayn";

            _ordersService.Poller.Stop();
            WindowNativeMethods.AllowSleep();
        }
    }

    [RelayCommand]
    private void Navigate(string section)
    {
        if (SelectedSection == "Moliya" && section != "Moliya")
        {
            _ = FinanceVm.LockCommand.ExecuteAsync(null);
        }

        SelectedSection = section;
        if (section == "Buyurtmalar")
        {
            _ = OrdersVm.LoadCurrentTabOrdersAsync();
        }
        else if (section == "Menyu")
        {
            _ = MenuVm.LoadMenuAsync();
        }
        else if (section == "Bronlar")
        {
            _ = ReservationsVm.LoadReservationsAsync();
        }
        else if (section == "Moliya")
        {
            _ = FinanceVm.RefreshAsync();
        }
        else if (section == "Sozlamalar")
        {
            _ = SettingsVm.InitializeAsync();
        }
    }

    [RelayCommand]
    private async Task LogoutAsync()
    {
        await _authService.LogoutAsync();
    }
}
