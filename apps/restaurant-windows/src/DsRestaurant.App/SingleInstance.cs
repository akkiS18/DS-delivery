using System.Runtime.InteropServices;

namespace DsRestaurant.App;

public static class SingleInstance
{
    private const string MutexName = "DsRestaurant_SingleInstance_Mutex";
    private static Mutex? _mutex;

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr FindWindow(string? lpClassName, string lpWindowName);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    private const int SwRestore = 9;

    public static bool Acquire()
    {
        _mutex = new Mutex(true, MutexName, out bool isNew);
        if (!isNew)
        {
            // Activate existing window
            var hWnd = FindWindow(null, "DS Restaurant");
            if (hWnd != IntPtr.Zero)
            {
                ShowWindow(hWnd, SwRestore);
                SetForegroundWindow(hWnd);
            }
            return false;
        }
        return true;
    }

    public static void Release()
    {
        if (_mutex != null)
        {
            try
            {
                _mutex.ReleaseMutex();
            }
            catch
            {
                // Ignore
            }
            _mutex.Dispose();
            _mutex = null;
        }
    }
}
