using System;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Threading.Tasks;
using System.Windows.Input;
using System.Windows.Media;
using DsTaxi.Core.Format;

namespace DsTaxi.App.ViewModels;

public abstract class ObservableObject : INotifyPropertyChanged
{
    public event PropertyChangedEventHandler? PropertyChanged;

    protected bool Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (Equals(field, value)) return false;
        field = value;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
        return true;
    }

    protected void Raise([CallerMemberName] string? name = null) => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));

    /// <summary>Tells the view that every property may have changed (used when a request is refreshed in place).</summary>
    protected void RaiseAll() => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(string.Empty));
}

public sealed class RelayCommand : ICommand
{
    private readonly Action<object?> _run;
    private readonly Func<object?, bool>? _can;

    public RelayCommand(Action<object?> run, Func<object?, bool>? can = null)
    {
        _run = run;
        _can = can;
    }

    public RelayCommand(Action run, Func<bool>? can = null) : this(_ => run(), can is null ? null : _ => can()) { }

    public event EventHandler? CanExecuteChanged
    {
        add => CommandManager.RequerySuggested += value;
        remove => CommandManager.RequerySuggested -= value;
    }

    public bool CanExecute(object? parameter) => _can?.Invoke(parameter) ?? true;
    public void Execute(object? parameter) => _run(parameter);
}

/// <summary>An async command that ignores a second click while the first is still running (a double click must not send an action twice).</summary>
public sealed class AsyncCommand : ICommand
{
    private readonly Func<object?, Task> _run;
    private readonly Func<object?, bool>? _can;
    private bool _running;

    public AsyncCommand(Func<object?, Task> run, Func<object?, bool>? can = null)
    {
        _run = run;
        _can = can;
    }

    public AsyncCommand(Func<Task> run, Func<bool>? can = null) : this(_ => run(), can is null ? null : _ => can()) { }

    public event EventHandler? CanExecuteChanged
    {
        add => CommandManager.RequerySuggested += value;
        remove => CommandManager.RequerySuggested -= value;
    }

    public bool CanExecute(object? parameter) => !_running && (_can?.Invoke(parameter) ?? true);

    public async void Execute(object? parameter)
    {
        if (_running) return;
        _running = true;
        CommandManager.InvalidateRequerySuggested();
        try { await _run(parameter); }
        catch (Exception e) { DsTaxi.App.Services.Log.Error("command failed", e); }
        finally
        {
            _running = false;
            CommandManager.InvalidateRequerySuggested();
        }
    }
}

/// <summary>Colours of the phone app (ui/Format.kt, Theme.kt).</summary>
public static class Palette
{
    private static SolidColorBrush Frozen(byte r, byte g, byte b)
    {
        var brush = new SolidColorBrush(Color.FromRgb(r, g, b));
        brush.Freeze();
        return brush;
    }

    public static readonly SolidColorBrush Urgent = Frozen(0xD3, 0x2F, 0x2F);
    public static readonly SolidColorBrush Warn = Frozen(0xEF, 0x6C, 0x00);
    public static readonly SolidColorBrush Ok = Frozen(0x2E, 0x7D, 0x32);
    public static readonly SolidColorBrush Neutral = Frozen(0x61, 0x61, 0x61);
    public static readonly SolidColorBrush TaxiYellow = Frozen(0xFF, 0xC4, 0x00);
    public static readonly SolidColorBrush Ink = Frozen(0x1B, 0x1B, 0x1F);

    public static SolidColorBrush Of(Tone tone) => tone switch
    {
        Tone.Urgent => Urgent,
        Tone.Warn => Warn,
        Tone.Ok => Ok,
        _ => Neutral,
    };
}
