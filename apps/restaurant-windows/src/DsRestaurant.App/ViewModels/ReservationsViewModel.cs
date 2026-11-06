using System.Collections.ObjectModel;
using System.Windows;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using DsRestaurant.Core.Api.Dtos;
using DsRestaurant.Core.Reservations;

namespace DsRestaurant.App.ViewModels;

public partial class ReservationsViewModel : ViewModelBase
{
    private readonly ReservationsService _reservationsService;

    [ObservableProperty]
    private bool _isLoading = false;

    [ObservableProperty]
    private string? _errorMessage;

    [ObservableProperty]
    private int _unseenCount = 0;

    [ObservableProperty]
    private bool _isReservationsEnabled = false;

    [ObservableProperty]
    private int _depositSom = 50000;

    public ObservableCollection<ReservationDto> Upcoming { get; } = new();
    public ObservableCollection<ReservationDto> Past { get; } = new();

    public ReservationsViewModel(ReservationsService reservationsService)
    {
        _reservationsService = reservationsService;
        _reservationsService.OnReservationsChanged += () =>
        {
            Application.Current?.Dispatcher.Invoke(() => _ = LoadReservationsAsync());
        };
    }

    [RelayCommand]
    public async Task LoadReservationsAsync()
    {
        try
        {
            IsLoading = true;
            ErrorMessage = null;

            var res = await _reservationsService.GetReservationsAsync();
            if (res.IsSuccess && res.Value != null)
            {
                var rep = res.Value;
                UnseenCount = rep.UnseenCount ?? 0;
                IsReservationsEnabled = rep.Settings?.Enabled ?? false;
                DepositSom = rep.Settings?.DepositSom ?? 50000;

                Upcoming.Clear();
                foreach (var r in rep.Upcoming ?? []) Upcoming.Add(r);

                Past.Clear();
                foreach (var r in rep.Past ?? []) Past.Add(r);
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
            IsLoading = false;
        }
    }

    [RelayCommand]
    public async Task MarkSeenAsync(string id)
    {
        await _reservationsService.MarkSeenAsync(id);
    }

    [RelayCommand]
    public async Task ConfirmPaymentAsync(string id)
    {
        await _reservationsService.ConfirmPaymentAsync(id);
    }

    public async Task<bool> CancelReservationAsync(string id, string reason)
    {
        var res = await _reservationsService.CancelAsync(id, reason);
        if (!res.IsSuccess)
        {
            ErrorMessage = res.ErrorMessage;
            return false;
        }
        return true;
    }

    [RelayCommand]
    public async Task SaveSettingsAsync()
    {
        try
        {
            var res = await _reservationsService.UpdateSettingsAsync(IsReservationsEnabled, DepositSom);
            if (!res.IsSuccess)
            {
                ErrorMessage = res.ErrorMessage;
            }
        }
        catch (Exception ex)
        {
            ErrorMessage = ex.Message;
        }
    }
}
