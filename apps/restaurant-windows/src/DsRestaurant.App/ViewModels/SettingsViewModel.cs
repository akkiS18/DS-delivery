using System.Collections.ObjectModel;
using System.Diagnostics;
using System.IO;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using DsRestaurant.App.Autostart;
using DsRestaurant.Core.Api;
using DsRestaurant.Core.Api.Dtos;
using DsRestaurant.Core.Auth;
using DsRestaurant.Core.Cards;
using DsRestaurant.Core.Operations;
using DsRestaurant.Core.Orders;

namespace DsRestaurant.App.ViewModels;

public partial class WorkingDayViewModel : ViewModelBase
{
    public int DayOfWeek { get; }
    public string DayName { get; }

    [ObservableProperty]
    private bool _isOpen;

    [ObservableProperty]
    private string _openTime;

    [ObservableProperty]
    private string _closeTime;

    public WorkingDayViewModel(int dayOfWeek, string dayName, bool isOpen, string openTime, string closeTime)
    {
        DayOfWeek = dayOfWeek;
        DayName = dayName;
        _isOpen = isOpen;
        _openTime = openTime;
        _closeTime = closeTime;
    }

    public WorkingDayDto ToDto() => new(DayOfWeek, IsOpen, OpenTime, CloseTime);
}

public partial class SettingsViewModel : ViewModelBase
{
    private readonly AuthService _authService;
    private readonly RestaurantApi _api;
    private readonly IAlarmSink _alarmSink;
    private readonly OperationsService _operationsService;
    private readonly CardsService _cardsService;

    [ObservableProperty]
    private bool _isAutostartEnabled;

    [ObservableProperty]
    private bool _hideToTrayOnClose = DsRestaurant.App.AppSettings.HideToTrayOnClose;

    partial void OnHideToTrayOnCloseChanged(bool value) => DsRestaurant.App.AppSettings.HideToTrayOnClose = value;

    [ObservableProperty]
    private string _version = "1.0.0";

    [ObservableProperty]
    private string? _message;

    // Operations
    [ObservableProperty]
    private bool _isPaused = false;

    public ObservableCollection<WorkingDayViewModel> WorkingDays { get; } = new();

    // Payee Cards
    public ObservableCollection<CardDto> Cards { get; } = new();

    [ObservableProperty]
    private string _newCardNumber = "";

    [ObservableProperty]
    private string _newCardHolder = "";

    public SettingsViewModel(
        AuthService authService,
        RestaurantApi api,
        IAlarmSink alarmSink,
        OperationsService operationsService,
        CardsService cardsService)
    {
        _authService = authService;
        _api = api;
        _alarmSink = alarmSink;
        _operationsService = operationsService;
        _cardsService = cardsService;

        IsAutostartEnabled = AutostartHelper.IsAutostartEnabled();

        _operationsService.OnOperationsChanged += SyncOperationsState;
        _cardsService.OnCardsChanged += () => _ = LoadCardsAsync();

        InitWorkingDays();
    }

    private void InitWorkingDays()
    {
        string[] names = ["Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba", "Yakshanba"];
        WorkingDays.Clear();
        for (int i = 1; i <= 7; i++)
        {
            WorkingDays.Add(new WorkingDayViewModel(i, names[i - 1], true, "09:00", "23:00"));
        }
    }

    public async Task InitializeAsync()
    {
        await LoadOperationsAsync();
        await LoadCardsAsync();
    }

    private void SyncOperationsState()
    {
        var ops = _operationsService.CurrentOperations;
        if (ops != null)
        {
            IsPaused = ops.IsPaused ?? false;

            if (ops.WorkingDays != null && ops.WorkingDays.Count > 0)
            {
                foreach (var wd in ops.WorkingDays)
                {
                    var vm = WorkingDays.FirstOrDefault(w => w.DayOfWeek == wd.DayOfWeek);
                    if (vm != null)
                    {
                        vm.IsOpen = wd.IsOpen;
                        vm.OpenTime = wd.OpenTime;
                        vm.CloseTime = wd.CloseTime;
                    }
                }
            }
        }
    }

    [RelayCommand]
    public async Task LoadOperationsAsync()
    {
        var res = await _operationsService.GetOperationsAsync();
        if (res.IsSuccess)
        {
            SyncOperationsState();
        }
    }

    [RelayCommand]
    public async Task ToggleStatusAsync()
    {
        try
        {
            bool newStatus = !IsPaused;
            var res = await _operationsService.SetPausedAsync(newStatus);
            if (res.IsSuccess)
            {
                IsPaused = newStatus;
                Message = newStatus ? "Buyurtmalar qabuli to‘xtatildi (Pauza)." : "Buyurtmalar qabuli yoqildi (Faol).";
            }
            else
            {
                Message = res.ErrorMessage;
            }
        }
        catch (Exception ex)
        {
            Message = ex.Message;
        }
    }

    [RelayCommand]
    public async Task SaveWorkingHoursAsync()
    {
        try
        {
            var list = WorkingDays.Select(w => w.ToDto()).ToList();
            var res = await _operationsService.UpdateWorkingHoursAsync(list);
            if (res.IsSuccess)
            {
                Message = "Ish vaqtlari saqlandi.";
            }
            else
            {
                Message = res.ErrorMessage;
            }
        }
        catch (Exception ex)
        {
            Message = ex.Message;
        }
    }


    [RelayCommand]
    public async Task LoadCardsAsync()
    {
        try
        {
            var res = await _cardsService.GetCardsAsync();
            if (res.IsSuccess && res.Value != null)
            {
                Cards.Clear();
                foreach (var c in res.Value) Cards.Add(c);
            }
        }
        catch
        {
            // Ignore
        }
    }

    [RelayCommand]
    public async Task AddCardAsync()
    {
        if (string.IsNullOrWhiteSpace(NewCardNumber) || string.IsNullOrWhiteSpace(NewCardHolder))
        {
            Message = "Karta raqami va egasining ismini kiriting.";
            return;
        }

        var res = await _cardsService.AddCardAsync(NewCardNumber.Replace(" ", ""), NewCardHolder.Trim());
        if (res.IsSuccess)
        {
            NewCardNumber = "";
            NewCardHolder = "";
            Message = "Karta qo‘shildi. Administrator tasdiqlagach faollashadi.";
            await LoadCardsAsync();
        }
        else
        {
            Message = res.ErrorMessage;
        }
    }

    [RelayCommand]
    public async Task DisableCardAsync(string id)
    {
        var res = await _cardsService.DisableCardAsync(id);
        if (res.IsSuccess) await LoadCardsAsync();
        else Message = res.ErrorMessage;
    }

    [RelayCommand]
    public async Task EnableCardAsync(string id)
    {
        var res = await _cardsService.EnableCardAsync(id);
        if (res.IsSuccess) await LoadCardsAsync();
        else Message = res.ErrorMessage;
    }

    [RelayCommand]
    public void TestSound()
    {
        _alarmSink.PlayTestSound();
    }

    [RelayCommand]
    public void ToggleAutostart()
    {
        IsAutostartEnabled = !IsAutostartEnabled;
        AutostartHelper.SetAutostart(IsAutostartEnabled);
    }

    [RelayCommand]
    public async Task LogoutAsync()
    {
        await _authService.LogoutAsync();
    }
}
