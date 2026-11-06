using System.ComponentModel;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Threading;
using DsRestaurant.App.Native;
using DsRestaurant.App.ViewModels;
using Hardcodet.Wpf.TaskbarNotification;
using Microsoft.Win32;

namespace DsRestaurant.App.Views;

public partial class MainWindow : Window
{
    private readonly MainViewModel _viewModel;
    private readonly DispatcherTimer _minimizeTimer;
    private bool _isExplicitExit = false;

    public MainWindow(MainViewModel viewModel)
    {
        InitializeComponent();
        _viewModel = viewModel;
        DataContext = viewModel;

        _viewModel.OnAttentionRequired += HandleAttentionRequired;

        // Plan section 7 & 10: Auto-lock finance on Windows session lock
        SystemEvents.SessionSwitch += OnSessionSwitch;

        // Plan section 7 & 10: Auto-lock finance if minimized > 2 minutes
        _minimizeTimer = new DispatcherTimer
        {
            Interval = TimeSpan.FromMinutes(2)
        };
        _minimizeTimer.Tick += (s, e) =>
        {
            _minimizeTimer.Stop();
            _viewModel.FinanceVm.LockCommand.Execute(null);
        };
        StateChanged += MainWindow_StateChanged;
    }

    private void MainWindow_StateChanged(object? sender, EventArgs e)
    {
        if (WindowState == WindowState.Minimized)
        {
            _minimizeTimer.Start();
        }
        else
        {
            _minimizeTimer.Stop();
        }
    }

    private void OnSessionSwitch(object sender, SessionSwitchEventArgs e)
    {
        if (e.Reason == SessionSwitchReason.SessionLock)
        {
            _viewModel.FinanceVm.LockCommand.Execute(null);
        }
    }

    private void HandleAttentionRequired()
    {
        // 1. Flash taskbar (Plan section 135)
        var handle = new WindowInteropHelper(this).Handle;
        if (handle != IntPtr.Zero)
        {
            WindowNativeMethods.FlashWindow(handle);
        }

        // 2. If window is not active or hidden in tray, notify
        if (!IsVisible || WindowState == WindowState.Minimized)
        {
            TrayIcon.ShowBalloonTip(
                "Yangi buyurtma!",
                "Oshxonaga yangi buyurtma keldi. Qabul qilish uchun bosing.",
                BalloonIcon.Info);
        }
    }

    protected override void OnClosing(CancelEventArgs e)
    {
        if (!_isExplicitExit)
        {
            // Plan section 138: Closing the window (X) hides it to the tray; process keeps running.
            e.Cancel = true;
            Hide();
            TrayIcon.ShowBalloonTip(
                "DS Restaurant",
                "Dastur trayga yashirildi. Yangi buyurtmalar kelganda xabar beriladi.",
                BalloonIcon.Info);
            return;
        }

        base.OnClosing(e);
    }

    private void TrayOpen_Click(object sender, RoutedEventArgs e)
    {
        RestoreWindow();
    }

    private void TraySilence_Click(object sender, RoutedEventArgs e)
    {
        _viewModel.OrdersVm.Silence();
    }

    private void TrayIcon_DoubleClick(object sender, RoutedEventArgs e)
    {
        RestoreWindow();
    }

    private void RestoreWindow()
    {
        Show();
        WindowState = WindowState.Normal;
        Activate();
        Focus();
    }

    private void TrayExit_Click(object sender, RoutedEventArgs e)
    {
        // Plan section 138: Exiting asks "Yangi buyurtmalar eshitilmaydi. Chiqilsinmi?"
        var answer = MessageBox.Show(
            "Yangi buyurtmalar eshitilmaydi. Chiqilsinmi?",
            "DS Restaurant — Chiqish",
            MessageBoxButton.YesNo,
            MessageBoxImage.Question);

        if (answer == MessageBoxResult.Yes)
        {
            _isExplicitExit = true;
            SystemEvents.SessionSwitch -= OnSessionSwitch;
            TrayIcon.Dispose();
            Close();
            Application.Current.Shutdown();
        }
    }
}
