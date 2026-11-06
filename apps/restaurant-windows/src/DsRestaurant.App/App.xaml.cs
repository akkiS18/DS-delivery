using System.IO;
using System.Windows;
using DsRestaurant.App.Audio;
using DsRestaurant.App.Auth;
using DsRestaurant.App.ViewModels;
using DsRestaurant.App.Views;
using DsRestaurant.Core.Api;
using DsRestaurant.Core.Auth;
using DsRestaurant.Core.Cards;
using DsRestaurant.Core.Finance;
using DsRestaurant.Core.Menu;
using DsRestaurant.Core.Operations;
using DsRestaurant.Core.Orders;
using DsRestaurant.Core.Reservations;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Serilog;

namespace DsRestaurant.App;

public partial class App : Application
{
    private IHost? _host;

    protected override async void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        DsRestaurant.App.Native.TitleBar.ApplyToAllWindows();

        // 1. Single Instance check (Plan section 140)
        if (!SingleInstance.Acquire())
        {
            Shutdown();
            return;
        }

        // 2. Serilog Setup (Plan section 25: %LOCALAPPDATA%\DsRestaurant\logs, rolling 5 MB x 3)
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var logDir = Path.Combine(localAppData, "DsRestaurant", "logs");
        Directory.CreateDirectory(logDir);

        Log.Logger = new LoggerConfiguration()
            .MinimumLevel.Information()
            .WriteTo.File(
                Path.Combine(logDir, "app-.log"),
                rollingInterval: RollingInterval.Day,
                fileSizeLimitBytes: 5 * 1024 * 1024,
                retainedFileCountLimit: 3,
                outputTemplate: "{Timestamp:yyyy-MM-dd HH:mm:ss.fff} [{Level:u3}] {Message:lj}{NewLine}{Exception}")
            .CreateLogger();

        Log.Information("DS Restaurant starting up...");

        // 3. DI Container Configuration
        _host = Host.CreateDefaultBuilder(e.Args)
            .UseSerilog()
            .ConfigureServices((context, services) =>
            {
                // HTTP & API
                // ONE RestaurantApi (and so one access token) for the whole program: see RestaurantApiServices.
                services.AddRestaurantApi();

                // Alarm & Attention
                services.AddSingleton<IAlarmSink, AlarmPlayer>();
                services.AddSingleton<NewOrderAttention>();
                services.AddSingleton<OrderPoller>();
                services.AddSingleton<OrdersService>();

                // Phase 2 Services
                services.AddSingleton<OperationsService>();
                services.AddSingleton<MenuService>();
                services.AddSingleton<ReservationsService>();
                services.AddSingleton<CardsService>();

                // Phase 3 Finance Service
                services.AddSingleton<FinanceService>();

                // Auth & Session
                services.AddSingleton<ISessionStore, DpapiSessionStore>();
                services.AddSingleton<AuthService>();

                // ViewModels
                services.AddSingleton<LoginViewModel>();
                services.AddSingleton<OrdersViewModel>();
                services.AddSingleton<MenuViewModel>();
                services.AddSingleton<ReservationsViewModel>();
                services.AddSingleton<FinanceViewModel>();
                services.AddSingleton<SettingsViewModel>();
                services.AddSingleton<MainViewModel>();

                // Views
                services.AddSingleton<MainWindow>();
            })
            .Build();

        await _host.StartAsync();

        // 4. Try restoring saved session
        var authService = _host.Services.GetRequiredService<AuthService>();
        bool restored = await authService.InitializeAsync();
        Log.Information("Session restored from DPAPI: {Restored}", restored);

        // 5. Show Main Window
        var mainWindow = _host.Services.GetRequiredService<MainWindow>();
        mainWindow.Show();
    }

    protected override async void OnExit(ExitEventArgs e)
    {
        Log.Information("DS Restaurant shutting down...");
        SingleInstance.Release();

        if (_host != null)
        {
            await _host.StopAsync();
            _host.Dispose();
        }

        await Log.CloseAndFlushAsync();
        base.OnExit(e);
    }
}
