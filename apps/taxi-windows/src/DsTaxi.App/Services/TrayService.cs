using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

namespace DsTaxi.App.Services;

public enum TrayState { Connected, OffDuty, Offline }

/// <summary>Only one copy of the program runs; a second start brings the first window to the front instead.</summary>
public sealed class SingleInstance : IDisposable
{
    private const string MutexName = @"Local\DsTaxi.SingleInstance";
    private const string ActivateName = @"Local\DsTaxi.Activate";

    private readonly Mutex _mutex;
    private readonly EventWaitHandle _activate;
    private readonly Thread _listener;
    private volatile bool _closing;

    public event Action? ActivationRequested;

    private SingleInstance(Mutex mutex, EventWaitHandle activate)
    {
        _mutex = mutex;
        _activate = activate;
        _listener = new Thread(Listen) { IsBackground = true, Name = "SingleInstance" };
        _listener.Start();
    }

    /// <summary>Returns the guard when this is the first copy; otherwise asks the first copy to show itself and returns null.</summary>
    public static SingleInstance? TryStart()
    {
        var mutex = new Mutex(true, MutexName, out var first);
        if (first) return new SingleInstance(mutex, new EventWaitHandle(false, EventResetMode.AutoReset, ActivateName));
        try
        {
            using var other = EventWaitHandle.OpenExisting(ActivateName);
            other.Set();
        }
        catch (Exception e) when (e is WaitHandleCannotBeOpenedException or UnauthorizedAccessException) { }
        mutex.Dispose();
        return null;
    }

    private void Listen()
    {
        while (!_closing)
        {
            _activate.WaitOne();
            if (_closing) break;
            ActivationRequested?.Invoke();
        }
    }

    public void Dispose()
    {
        _closing = true;
        _activate.Set();
        try { _mutex.ReleaseMutex(); } catch (ApplicationException) { }
        _mutex.Dispose();
        _activate.Dispose();
    }
}

/// <summary>The tray (notification area) icon: status colour, tooltip, balloon and the menu Ochish / Ovozni o‘chirish / Navbatchilik / Chiqish.</summary>
public sealed class TrayService : IDisposable
{
    [DllImport("user32.dll")]
    private static extern bool DestroyIcon(IntPtr handle);

    private readonly NotifyIcon _icon;
    private readonly ToolStripMenuItem _duty;
    private readonly Icon _connected = MakeIcon(Color.FromArgb(0x2E, 0x7D, 0x32));
    private readonly Icon _offDuty = MakeIcon(Color.FromArgb(0x61, 0x61, 0x61));
    private readonly Icon _offline = MakeIcon(Color.FromArgb(0xD3, 0x2F, 0x2F));

    public event Action? OpenRequested;
    public event Action? MuteRequested;
    public event Action? DutyToggleRequested;
    public event Action? ExitRequested;

    public TrayService()
    {
        var menu = new ContextMenuStrip();
        menu.Items.Add("Ochish", null, (_, _) => OpenRequested?.Invoke());
        menu.Items.Add("Ovozni o‘chirish (30 s)", null, (_, _) => MuteRequested?.Invoke());
        _duty = new ToolStripMenuItem("Navbatchilik") { CheckOnClick = false };
        _duty.Click += (_, _) => DutyToggleRequested?.Invoke();
        menu.Items.Add(_duty);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Chiqish", null, (_, _) => ExitRequested?.Invoke());

        _icon = new NotifyIcon { Icon = _offDuty, Text = "DS Taxi", ContextMenuStrip = menu, Visible = true };
        _icon.DoubleClick += (_, _) => OpenRequested?.Invoke();
    }

    public void Set(TrayState state, string tooltip, bool duty)
    {
        _icon.Icon = state switch { TrayState.Connected => _connected, TrayState.Offline => _offline, _ => _offDuty };
        _icon.Text = Truncate("DS Taxi — " + tooltip, 63); // NotifyIcon allows 63 characters; the tooltip never shows addresses, phones or money
        _duty.Checked = duty;
    }

    public void Balloon(string title, string text) => _icon.ShowBalloonTip(5_000, title, text, ToolTipIcon.Info);

    private static string Truncate(string s, int max) => s.Length <= max ? s : s[..max];

    /// <summary>A round yellow "taxi" badge with a coloured status dot.</summary>
    private static Icon MakeIcon(Color status)
    {
        using var bmp = new Bitmap(32, 32);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            g.Clear(Color.Transparent);
            using var yellow = new SolidBrush(Color.FromArgb(0xFF, 0xC4, 0x00));
            using var ink = new Pen(Color.FromArgb(0x1B, 0x1B, 0x1F), 2);
            g.FillEllipse(yellow, 1, 1, 29, 29);
            g.DrawEllipse(ink, 1, 1, 29, 29);
            // checker strip: the taxi sign
            using var black = new SolidBrush(Color.FromArgb(0x1B, 0x1B, 0x1F));
            for (var i = 0; i < 6; i++) g.FillRectangle(black, 5 + i * 4, i % 2 == 0 ? 11 : 15, 4, 4);
            using var dot = new SolidBrush(status);
            g.FillEllipse(dot, 17, 17, 14, 14);
            using var ring = new Pen(Color.White, 2);
            g.DrawEllipse(ring, 17, 17, 14, 14);
        }
        var handle = bmp.GetHicon();
        try { return (Icon)Icon.FromHandle(handle).Clone(); }
        finally { DestroyIcon(handle); }
    }

    public void Dispose()
    {
        _icon.Visible = false;
        _icon.Dispose();
        _connected.Dispose();
        _offDuty.Dispose();
        _offline.Dispose();
    }
}
