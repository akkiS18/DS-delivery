using System;
using System.Linq;
using System.Net.Http;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Threading;
using DsTaxi.App.Services;
using DsTaxi.App.ViewModels;
using DsTaxi.App.Views;
using DsTaxi.Core.Api;
using DsTaxi.Core.Format;
using DsTaxi.Core.Versioning;

namespace DsTaxi.App;

/// <summary>Start-up, wiring and shutdown. One window, one tray icon, one poll loop; everything else lives in the view models.</summary>
public partial class App : System.Windows.Application
{
    private SingleInstance? _single;
    private SessionStore _session = null!;
    private AlarmPlayer _alarm = null!;
    private TrayService _tray = null!;
    private MainWindow _window = null!;

    private HttpClient? _http;
    private TaxiApi? _api;
    private DsTaxi.Core.Dispatch.Dispatcher? _dispatcher;
    private MainViewModel? _main;
    private bool _loggingOut;
    private bool _exited;
    private UpdateState? _lastUpdate;
    private DispatcherTimer? _updateTimer;

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        _single = SingleInstance.TryStart();
        if (_single is null)
        {
            Shutdown(); // another copy is running and was asked to show itself
            return;
        }

        DispatcherUnhandledException += (_, args) =>
        {
            Log.Error("unhandled UI error", args.Exception);
            args.Handled = true; // an alarm program must keep running; the poll and the tray survive a failed click
        };
        AppDomain.CurrentDomain.UnhandledException += (_, args) => Log.Error("unhandled error", args.ExceptionObject as Exception);
        TaskScheduler.UnobservedTaskException += (_, args) => { Log.Error("unobserved task error", args.Exception); args.SetObserved(); };

        Log.Cleanup();
        Log.Info("start");
        var minimized = e.Args.Contains("--minimized", StringComparer.OrdinalIgnoreCase);

        _session = SessionStore.Load();
        _alarm = new AlarmPlayer(Dispatcher);

        _window = new MainWindow { Store = _session };
        _window.ApplySavedBounds(_session.Settings);
        _window.MinimizeToTrayOnClose = () => _session.IsLoggedIn && _session.Settings.MinimizeToTray;
        _window.CloseRequested += () => !_session.IsLoggedIn || ConfirmExit();
        _window.LogoutRequested += () => _ = LogoutAsync();
        _window.Closed += (_, _) => ExitNow();

        _tray = new TrayService();
        _tray.OpenRequested += () => _window.ShowWindow();
        _tray.MuteRequested += () => _dispatcher?.Silence();
        _tray.DutyToggleRequested += () => { if (_main is not null) _main.Duty = !_main.Duty; };
        _tray.ExitRequested += () => { if (!_session.IsLoggedIn || ConfirmExit()) ExitNow(); };
        _tray.Set(TrayState.OffDuty, "Kirish kerak", false);

        _single.ActivationRequested += () => Dispatcher.BeginInvoke(new Action(() => _window.ShowWindow()));
        SessionEnding += (_, _) => ExitNow(); // Windows is shutting down: no questions

        // A program that stays open for weeks asks the server again every half hour whether it is still allowed.
        _updateTimer = new DispatcherTimer(TimeSpan.FromMinutes(30), DispatcherPriority.Background, (_, _) => { if (_main is not null) _ = CheckForUpdateAsync(); }, Dispatcher);
        _updateTimer.Start();

        if (_session.IsLoggedIn)
        {
            EnterMain();
            if (!minimized) _window.ShowWindow();
        }
        else
        {
            ShowLogin();
            _window.ShowWindow(); // there is nothing to run in the background without a sign-in
        }
    }

    // ---- sign in
    private void ShowLogin()
    {
        _window.ShowLogin(new LoginViewModel(_session.Settings.Login, SignInAsync));
        _tray.Set(TrayState.OffDuty, "Kirish kerak", false);
    }

    private async Task<string?> SignInAsync(string login, string password)
    {
        // The server address is not on the screen. It is the production address unless settings.json (a developer's file) says otherwise.
        var update = await CheckForUpdateAsync();
        if (update.Level == UpdateLevel.Required)
            return "Dastur versiyasi eskirgan. Yangi versiyani o‘rnating" + (update.DownloadUrl is { } link ? ": " + link : ".");

        HttpClient http;
        try { http = TaxiApi.CreateClient(_session.Settings.ServerUrl, clientVersion: AppInfo.Version); }
        catch (ArgumentException e)
        {
            Log.Error("saved server address invalid, default used", e);
            _session.Update(s => s.ServerUrl = AppSettings.DefaultServerUrl);
            http = TaxiApi.CreateClient(AppSettings.DefaultServerUrl, clientVersion: AppInfo.Version);
        }

        ApiResult<LoginResponse> result;
        using (http)
        {
            result = await new TaxiApi(http, () => null).LoginAsync(login, password);
        }
        if (!result.IsOk || result.Data is null) return Fmt.LoginErrorText(result.Status, result.HttpStatus, result.RetryAfterSeconds);

        _session.SignIn(result.Data.AccessToken, result.Data.Company.Name, result.Data.Company.Login);
        Log.Info("signed in");
        EnterMain();
        return null;
    }

    // ---- the operator screen
    private void EnterMain()
    {
        LeaveMain();
        try
        {
            _http = TaxiApi.CreateClient(_session.Settings.ServerUrl, clientVersion: AppInfo.Version);
        }
        catch (ArgumentException e)
        {
            Log.Error("saved server address invalid, default used", e);
            _session.Update(s => s.ServerUrl = AppSettings.DefaultServerUrl);
            _http = TaxiApi.CreateClient(AppSettings.DefaultServerUrl, clientVersion: AppInfo.Version);
        }

        _api = new TaxiApi(_http, () => _session.Token);
        _dispatcher = new DsTaxi.Core.Dispatch.Dispatcher(_api, _session, _alarm);
        _dispatcher.SignedOut += () => Dispatcher.BeginInvoke(new Action(OnSignedOut));
        _main = new MainViewModel(_dispatcher, _session, _alarm, _window, Dispatcher);
        _main.TrayChanged += (state, text, duty) => _tray.Set(state, text, duty);
        _main.AttentionNeeded += OnAttention;
        _main.BalloonRequested += (title, text) => _tray.Balloon(title, text);
        if (_lastUpdate is { } known) _main.ApplyUpdateState(known);
        _window.ShowMain(_main);
        _main.Start();
        _ = CheckForUpdateAsync();
    }

    /// <summary>Asks the server which program versions it allows (public call, no sign-in needed). When the answer cannot be had, the last known rule stays.</summary>
    private async Task<UpdateState> CheckForUpdateAsync()
    {
        try
        {
            using var http = TaxiApi.CreateClient(_session.Settings.ServerUrl, clientVersion: AppInfo.Version);
            var result = await new TaxiApi(http, () => null).ClientConfigAsync();
            if (!result.IsOk || result.Data is null) return _lastUpdate ?? UpdateState.Current;
            var state = UpdateCheck.Evaluate(AppInfo.Version, result.Data.Windows);
            _lastUpdate = state;
            _main?.ApplyUpdateState(state);
            return state;
        }
        catch (ArgumentException)
        {
            return _lastUpdate ?? UpdateState.Current;
        }
    }

    private void LeaveMain()
    {
        _main?.Shutdown();
        _main = null;
        _dispatcher = null;
        _api = null;
        _http?.Dispose();
        _http = null;
    }

    /// <summary>A new request started ringing: bring the window up, flash the taskbar, show a balloon (no addresses or phones in it).</summary>
    private void OnAttention(int waiting)
    {
        _window.ShowWindow();
        WindowAttention.Flash(_window);
        _tray.Balloon("Yangi so‘rov", waiting > 1 ? $"{waiting} ta so‘rov javob kutmoqda" : "Taksi so‘rovi javob kutmoqda");
    }

    /// <summary>The server ended the session (password changed, signed out elsewhere): back to the sign-in screen with a warning sound.</summary>
    private void OnSignedOut()
    {
        if (_loggingOut) return;
        Log.Info("session ended by the server");
        LeaveMain();
        _alarm.PlayWarning();
        ShowLogin();
        _window.ShowWindow();
    }

    private async Task LogoutAsync()
    {
        var ok = _window.Confirm("Chiqasizmi?", "Chiqsangiz bu kompyuter yangi so‘rovlarni eshitmaydi.", "Chiqish", "Yo‘q, ortga");
        if (!ok) return;

        _loggingOut = true;
        try
        {
            var api = _api;
            _main?.Shutdown(); // stop polling first so a late answer cannot bring the screen back
            if (api is not null)
            {
                // Best effort: the server forgets this session; a slow network must not keep the operator waiting.
                await Task.WhenAny(api.LogoutAsync(), Task.Delay(TimeSpan.FromSeconds(3)));
            }
            _session.Clear();
            LeaveMain();
            Log.Info("signed out");
            ShowLogin();
        }
        finally
        {
            _loggingOut = false;
        }
    }

    // ---- leaving
    private bool ConfirmExit() =>
        _window.Confirm("Chiqilsinmi?", "Yangi so‘rovlar eshitilmaydi. Chiqilsinmi?", "Chiqish", "Yo‘q, ortga");

    private void ExitNow()
    {
        if (_exited) return;
        _exited = true;
        Log.Info("exit");
        try
        {
            _main?.Shutdown();
            _alarm.SetRinging(false);
            _tray.Dispose();
            _single?.Dispose();
            _window.AllowClose();
        }
        finally
        {
            Shutdown();
        }
    }
}
