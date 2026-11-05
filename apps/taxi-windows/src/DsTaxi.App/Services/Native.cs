using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows;
using System.Windows.Interop;
using Microsoft.Win32;

namespace DsTaxi.App.Services;

/// <summary>Start with Windows: HKCU\Software\Microsoft\Windows\CurrentVersion\Run (per user, no admin rights).</summary>
public static class Autostart
{
    private const string KeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string ValueName = "DsTaxi";

    public static bool IsEnabled()
    {
        using var key = Registry.CurrentUser.OpenSubKey(KeyPath);
        return key?.GetValue(ValueName) is string s && s.Length > 0;
    }

    public static void Set(bool on)
    {
        using var key = Registry.CurrentUser.CreateSubKey(KeyPath);
        if (on)
        {
            var exe = Environment.ProcessPath;
            if (exe is null) return;
            key.SetValue(ValueName, $"\"{exe}\" --minimized");
        }
        else
        {
            key.DeleteValue(ValueName, throwOnMissingValue: false);
        }
    }
}

/// <summary>
/// Keeps Windows from going to sleep while the operator is on duty (the screen may still turn off). SetThreadExecutionState applies to the calling
/// thread, so one dedicated thread holds it until released.
/// </summary>
public sealed class SleepGuard : IDisposable
{
    private const uint EsContinuous = 0x80000000;
    private const uint EsSystemRequired = 0x00000001;

    [DllImport("kernel32.dll")]
    private static extern uint SetThreadExecutionState(uint flags);

    private readonly object _gate = new();
    private Thread? _thread;
    private ManualResetEventSlim? _release;

    public void Hold()
    {
        lock (_gate)
        {
            if (_thread is not null) return;
            _release = new ManualResetEventSlim(false);
            var release = _release;
            _thread = new Thread(() =>
            {
                SetThreadExecutionState(EsContinuous | EsSystemRequired);
                release.Wait();
                SetThreadExecutionState(EsContinuous);
            }) { IsBackground = true, Name = "SleepGuard" };
            _thread.Start();
        }
    }

    public void Release()
    {
        lock (_gate)
        {
            _release?.Set();
            _thread = null;
            _release = null;
        }
    }

    public void Dispose() => Release();
}

/// <summary>Makes the taskbar button flash until the window is used (a new request must be noticed even behind other windows).</summary>
public static class WindowAttention
{
    [StructLayout(LayoutKind.Sequential)]
    private struct FlashInfo
    {
        public uint Size;
        public IntPtr Hwnd;
        public uint Flags;
        public uint Count;
        public uint Timeout;
    }

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool FlashWindowEx(ref FlashInfo info);

    private const uint FlashAll = 3;
    private const uint FlashTimerNoFg = 12;
    private const uint FlashStop = 0;

    public static void Flash(Window window)
    {
        var hwnd = new WindowInteropHelper(window).Handle;
        if (hwnd == IntPtr.Zero) return;
        var info = new FlashInfo { Size = (uint)Marshal.SizeOf<FlashInfo>(), Hwnd = hwnd, Flags = FlashAll | FlashTimerNoFg, Count = uint.MaxValue, Timeout = 0 };
        FlashWindowEx(ref info);
    }

    public static void StopFlash(Window window)
    {
        var hwnd = new WindowInteropHelper(window).Handle;
        if (hwnd == IntPtr.Zero) return;
        var info = new FlashInfo { Size = (uint)Marshal.SizeOf<FlashInfo>(), Hwnd = hwnd, Flags = FlashStop, Count = 0, Timeout = 0 };
        FlashWindowEx(ref info);
    }
}

/// <summary>Is there any sound output device at all? (A muted device cannot be detected this simply; the "Ovozni sinash" button covers it.)</summary>
public static class AudioDevices
{
    [DllImport("winmm.dll")]
    private static extern uint waveOutGetNumDevs();

    public static bool HasOutput() => waveOutGetNumDevs() > 0;
}
