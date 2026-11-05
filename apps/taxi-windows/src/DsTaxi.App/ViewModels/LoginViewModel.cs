using System;
using System.Threading.Tasks;
using System.Windows.Input;

namespace DsTaxi.App.ViewModels;

/// <summary>The sign-in screen: logo, "Taksi operatori uchun", login, password, "Kirish". The server address is not shown (it is fixed).</summary>
public sealed class LoginViewModel : ObservableObject
{
    private readonly Func<string, string, Task<string?>> _signIn;
    private string _login = "";
    private string _password = "";
    private string? _error;
    private bool _busy;
    private bool _capsLock;

    /// <param name="signIn">(login, password) -> an Uzbek error text, or null when signed in.</param>
    public LoginViewModel(string? lastLogin, Func<string, string, Task<string?>> signIn)
    {
        _login = lastLogin ?? "";
        _signIn = signIn;
        LoginCommand = new AsyncCommand(DoLoginAsync, () => !_busy && _login.Trim().Length > 0 && _password.Length > 0);
    }

    public ICommand LoginCommand { get; }

    public string Login { get => _login; set { if (Set(ref _login, value)) CommandManager.InvalidateRequerySuggested(); } }
    /// <summary>Set by the view's PasswordBox (a password is never bound as plain text in XAML). Cleared after use.</summary>
    public string Password { get => _password; set { if (Set(ref _password, value)) CommandManager.InvalidateRequerySuggested(); } }
    public string? Error { get => _error; private set { Set(ref _error, value); Raise(nameof(HasError)); } }
    public bool HasError => !string.IsNullOrEmpty(_error);
    public bool Busy { get => _busy; private set { Set(ref _busy, value); Raise(nameof(NotBusy)); } }
    public bool NotBusy => !_busy;

    /// <summary>Set by the view from the keyboard state: a wrong password is very often a forgotten Caps Lock.</summary>
    public bool CapsLockOn { get => _capsLock; set => Set(ref _capsLock, value); }

    /// <summary>Raised after a successful sign-in so the view can empty its PasswordBox.</summary>
    public event Action? PasswordCleared;

    private async Task DoLoginAsync()
    {
        Error = null;
        Busy = true;
        try
        {
            var error = await _signIn(Login, Password);
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
