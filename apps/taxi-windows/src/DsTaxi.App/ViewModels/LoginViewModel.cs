using System;
using System.Threading.Tasks;
using System.Windows.Input;
using DsTaxi.App.Services;

namespace DsTaxi.App.ViewModels;

/// <summary>The sign-in screen: "DS Taxi / Taksi operatori uchun", login, password, "Kirish". The server address is tucked away under "Server".</summary>
public sealed class LoginViewModel : ObservableObject
{
    private readonly Func<string, string, string, Task<string?>> _signIn;
    private string _login = "";
    private string _password = "";
    private string _serverUrl;
    private string? _error;
    private bool _busy;
    private bool _showServer;

    /// <param name="signIn">(login, password, serverUrl) -> an Uzbek error text, or null when signed in.</param>
    public LoginViewModel(string serverUrl, string? lastLogin, Func<string, string, string, Task<string?>> signIn)
    {
        _serverUrl = serverUrl;
        _login = lastLogin ?? "";
        _signIn = signIn;
        LoginCommand = new AsyncCommand(DoLoginAsync, () => !_busy && _login.Trim().Length > 0 && _password.Length > 0);
        ToggleServerCommand = new RelayCommand(() => ShowServer = !ShowServer);
    }

    public ICommand LoginCommand { get; }
    public ICommand ToggleServerCommand { get; }

    public string Login { get => _login; set { if (Set(ref _login, value)) CommandManager.InvalidateRequerySuggested(); } }
    /// <summary>Set by the view's PasswordBox (a password is never bound as plain text in XAML). Cleared after use.</summary>
    public string Password { get => _password; set { if (Set(ref _password, value)) CommandManager.InvalidateRequerySuggested(); } }
    public string ServerUrl { get => _serverUrl; set => Set(ref _serverUrl, value); }
    public string? Error { get => _error; private set { Set(ref _error, value); Raise(nameof(HasError)); } }
    public bool HasError => !string.IsNullOrEmpty(_error);
    public bool Busy { get => _busy; private set { Set(ref _busy, value); Raise(nameof(NotBusy)); } }
    public bool NotBusy => !_busy;
    public bool ShowServer { get => _showServer; set => Set(ref _showServer, value); }

    /// <summary>Raised after a successful sign-in so the view can empty its PasswordBox.</summary>
    public event Action? PasswordCleared;

    private async Task DoLoginAsync()
    {
        Error = null;
        Busy = true;
        try
        {
            var error = await _signIn(Login, Password, ServerUrl);
            Error = error;
            if (error is null)
            {
                Password = "";
                PasswordCleared?.Invoke();
            }
        }
        finally
        {
            Busy = false;
        }
    }
}
