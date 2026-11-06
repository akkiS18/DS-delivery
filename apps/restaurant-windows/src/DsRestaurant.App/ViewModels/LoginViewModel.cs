using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using DsRestaurant.Core.Api;
using DsRestaurant.Core.Auth;

namespace DsRestaurant.App.ViewModels;

public partial class LoginViewModel : ViewModelBase
{
    private readonly AuthService _authService;

    [ObservableProperty]
    private string _slug = "";

    [ObservableProperty]
    private bool _isBusy = false;

    [ObservableProperty]
    private string? _errorMessage;

    public LoginViewModel(AuthService authService)
    {
        _authService = authService;
    }

    public async Task<bool> ExecuteLoginAsync(string password)
    {
        ErrorMessage = null;

        if (string.IsNullOrWhiteSpace(Slug))
        {
            ErrorMessage = "Restoran kodini kiriting.";
            return false;
        }

        if (string.IsNullOrWhiteSpace(password))
        {
            ErrorMessage = "Parolni kiriting.";
            return false;
        }

        try
        {
            IsBusy = true;
            var result = await _authService.LoginAsync(Slug.Trim(), password);
            if (!result.IsSuccess)
            {
                ErrorMessage = result.ErrorMessage ?? "Restoran kodi yoki parol noto‘g‘ri.";
                return false;
            }
            return true;
        }
        catch (Exception ex)
        {
            ErrorMessage = ApiError.MapExceptionToUzbek(ex);
            return false;
        }
        finally
        {
            IsBusy = false;
        }
    }
}
