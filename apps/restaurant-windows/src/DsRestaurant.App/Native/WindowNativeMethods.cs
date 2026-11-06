using System.Runtime.InteropServices;

namespace DsRestaurant.App.Native;

public static class WindowNativeMethods
{
    [Flags]
    public enum ExecutionState : uint
    {
        EsAwaymodeRequired = 0x00000040,
        EsContinuous = 0x80000000,
        EsDisplayRequired = 0x00000002,
        EsSystemRequired = 0x00000001
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern ExecutionState SetThreadExecutionState(ExecutionState esFlags);

    [StructLayout(LayoutKind.Sequential)]
    public struct FlashwInfo
    {
        public uint CbSize;
        public IntPtr Hwnd;
        public uint DwFlags;
        public uint UCount;
        public uint DwTimeout;
    }

    public const uint FlashwStop = 0;
    public const uint FlashwCaption = 1;
    public const uint FlashwTray = 2;
    public const uint FlashwAll = 3;
    public const uint FlashwTimernofg = 12;

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool FlashWindowEx(ref FlashwInfo pwfi);

    public static void FlashWindow(IntPtr hWnd)
    {
        if (hWnd == IntPtr.Zero) return;

        var fInfo = new FlashwInfo
        {
            CbSize = Convert.ToUInt32(Marshal.SizeOf(typeof(FlashwInfo))),
            Hwnd = hWnd,
            DwFlags = FlashwAll | FlashwTimernofg,
            UCount = uint.MaxValue,
            DwTimeout = 0
        };

        FlashWindowEx(ref fInfo);
    }

    public static void PreventSleep()
    {
        SetThreadExecutionState(ExecutionState.EsContinuous | ExecutionState.EsSystemRequired);
    }

    public static void AllowSleep()
    {
        SetThreadExecutionState(ExecutionState.EsContinuous);
    }
}
