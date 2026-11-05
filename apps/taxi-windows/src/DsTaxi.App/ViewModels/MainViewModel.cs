using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;
using DsTaxi.App.Services;
using DsTaxi.Core.Api;
using DsTaxi.Core.Dispatch;
using DsTaxi.Core.Format;

namespace DsTaxi.App.ViewModels;

/// <summary>What the main window needs from the shell (dialogs, clipboard, links). The window implements it; tests could fake it.</summary>
public interface IShell
{
    bool Confirm(string title, string body, string yes, string no);
    void Copy(string text);
    void OpenUrl(string url);
    void ShowWindow();
}

/// <summary>
/// The operator's screen: requests, history, duty, readiness. Everything the phone's MainScreen/SettingsTab does, laid out for a wide window.
/// Dispatcher events arrive on thread-pool threads and are marshalled to the UI thread here.
/// </summary>
public sealed class MainViewModel : ObservableObject
{
    private readonly Core.Dispatch.Dispatcher _dispatcher;
    private readonly SessionStore _session;
    private readonly AlarmPlayer _alarm;
    private readonly IShell _shell;
    private readonly System.Windows.Threading.Dispatcher _ui;
    private readonly DispatcherTimer _clockTimer;
    private readonly Dictionary<string, RequestViewModel> _byId = new();
    private readonly SleepGuard _sleep = new();
    private string? _busyId;
    private RequestViewModel? _selected;
    private DispatchState _state = new();
    private string? _notice;
    private int _tab;
    private bool _audioMissing;

    public MainViewModel(Core.Dispatch.Dispatcher dispatcher, SessionStore session, AlarmPlayer alarm, IShell shell, System.Windows.Threading.Dispatcher ui)
    {
        _dispatcher = dispatcher;
        _session = session;
        _alarm = alarm;
        _shell = shell;
        _ui = ui;

        SilenceCommand = new RelayCommand(() => _dispatcher.Silence());
        RefreshCommand = new AsyncCommand(() => _dispatcher.RefreshNowAsync());
        ActCommand = new AsyncCommand(async p => { if (p is ActionItem item) await ActAsync(item); });
        PrimaryCommand = new AsyncCommand(async _ => { if (Selected?.PrimaryAction is { } a && !Fmt.NeedsConfirm(a.Action)) await ActAsync(a); },
            _ => Selected?.PrimaryAction is { } a && !Fmt.NeedsConfirm(a.Action));
        TestSoundCommand = new AsyncCommand(() => _alarm.TestAsync());
        CopyCommand = new RelayCommand(p => { if (p is string s && s.Length > 0) { _shell.Copy(s); ShowNotice("Nusxalandi"); } });
        OpenMapCommand = new RelayCommand(p => { if (p is string url && url.StartsWith("https://", StringComparison.Ordinal)) _shell.OpenUrl(url); });
        FixCommand = new RelayCommand(() => { SetAutostart(true); RefreshReadiness(); });
        SelectTabCommand = new RelayCommand(p => { if (p is string s && int.TryParse(s, out var i)) Tab = i; });

        _dispatcher.StateChanged += s => _ui.BeginInvoke(new Action(() => Apply(s)));
        _dispatcher.RingingStarted += list => _ui.BeginInvoke(new Action(() => OnRingingStarted(list)));

        _clockTimer = new DispatcherTimer(TimeSpan.FromSeconds(1), DispatcherPriority.Normal, (_, _) => OnSecond(), _ui);
        _clockTimer.Start();
        RefreshReadiness();
        Apply(_dispatcher.State);
    }

    public ObservableCollection<RequestViewModel> Requests { get; } = new();
    public ObservableCollection<HistoryRowViewModel> History { get; } = new();

    public ICommand SilenceCommand { get; }
    public ICommand RefreshCommand { get; }
    public ICommand ActCommand { get; }
    public ICommand PrimaryCommand { get; }
    public ICommand TestSoundCommand { get; }
    public ICommand CopyCommand { get; }
    public ICommand OpenMapCommand { get; }
    public ICommand FixCommand { get; }
    public ICommand SelectTabCommand { get; }

    /// <summary>Raised when the shell should update the tray icon/tooltip.</summary>
    public event Action<TrayState, string, bool>? TrayChanged;
    /// <summary>Raised when requests START ringing: the shell shows the window, flashes the taskbar and shows a balloon.</summary>
    public event Action<int>? AttentionNeeded;

    // ---- tabs: 0 = So'rovlar, 1 = Tarix, 2 = Sozlamalar
    public int Tab { get => _tab; set { if (Set(ref _tab, value)) { Raise(nameof(IsRequestsTab)); Raise(nameof(IsHistoryTab)); Raise(nameof(IsSettingsTab)); } } }
    public bool IsRequestsTab => _tab == 0;
    public bool IsHistoryTab => _tab == 1;
    public bool IsSettingsTab => _tab == 2;

    public RequestViewModel? Selected
    {
        get => _selected;
        set { if (Set(ref _selected, value)) CommandManager.InvalidateRequerySuggested(); }
    }

    public string CompanyName => _session.CompanyName ?? "";
    /// <summary>The taxi park's name in capitals for the top bar.</summary>
    public string CompanyTitle => CompanyName.ToUpperInvariant();
    public string LoginName => _session.Login ?? "";
    public string VersionText => "DS " + (typeof(MainViewModel).Assembly.GetName().Version?.ToString(3) ?? "1.0.0");

    public bool Loaded => _state.Loaded;
    public bool Offline => _state.Offline;
    public bool Ringing => _state.Ringing;
    public bool IsEmpty => _state.Loaded && Requests.Count == 0;
    public bool NotLoaded => !_state.Loaded;
    public bool HistoryEmpty => _state.Loaded && History.Count == 0;
    public string EmptyText => Duty ? "Yangi so‘rov kelsa, kompyuter gudok chaladi." : "Navbatchilik o‘chirilgan: dastur yopiq bo‘lsa so‘rov kelmaydi.";

    public bool Duty
    {
        get => _session.Duty;
        set
        {
            if (_session.Duty == value) return;
            _session.Update(s => s.Duty = value);
            Raise();
            Raise(nameof(DutyHelp));
            Raise(nameof(EmptyText));
            _dispatcher.DutyChanged();
            UpdateSleepGuard();
            UpdateTray();
            RaiseStatus();
        }
    }

    public string DutyHelp => Duty
        ? "Dastur fonda ishlaydi, yangi so‘rovda gudok chaladi (ekran o‘chiq bo‘lsa ham)."
        : "Dastur yopiq bo‘lsa so‘rovlar kelmaydi va signal chalinmaydi.";

    // ---- status strip (offline -> red, off duty -> grey, else green): same words as the phone
    public string StatusText => _state.Offline ? "Ulanish yo‘q — yangi so‘rovlar kelmayapti" : !Duty ? "Navbatchilik o‘chirilgan" : "Ulangan • navbatchilik yoqilgan";
    public Brush StatusBrush => _state.Offline ? Palette.Urgent : !Duty ? Palette.Neutral : Palette.Ok;

    public string? Notice { get => _notice; private set { Set(ref _notice, value); Raise(nameof(HasNotice)); } }
    public bool HasNotice => !string.IsNullOrEmpty(_notice);

    // ---- readiness (the PC replacement of the phone's "Tayyorlik")
    public bool AutostartOn => Autostart.IsEnabled();
    public bool AudioMissing => _audioMissing;
    public bool ReadinessProblem => !AutostartOn || _audioMissing;
    public string ReadinessText
    {
        get
        {
            var problems = new List<string>();
            if (_audioMissing) problems.Add("tovush chiqarish qurilmasi topilmadi");
            if (!AutostartOn) problems.Add("Windows bilan ishga tushmaydi");
            return problems.Count == 0 ? "" : char.ToUpperInvariant(problems[0][0]) + string.Join(", ", problems)[1..] + ".";
        }
    }

    public bool MinimizeToTray
    {
        get => _session.Settings.MinimizeToTray;
        set { _session.Update(s => s.MinimizeToTray = value); Raise(); }
    }

    public bool AutostartSetting
    {
        get => AutostartOn;
        set { SetAutostart(value); RefreshReadiness(); Raise(); }
    }

    private void SetAutostart(bool on)
    {
        try { Autostart.Set(on); }
        catch (Exception e) when (e is UnauthorizedAccessException or System.Security.SecurityException) { Log.Error("autostart could not be changed", e); ShowNotice("Avtoyuklashni o‘zgartirib bo‘lmadi."); }
    }

    public void RefreshReadiness()
    {
        _audioMissing = !AudioDevices.HasOutput();
        Raise(nameof(AutostartOn));
        Raise(nameof(AudioMissing));
        Raise(nameof(ReadinessProblem));
        Raise(nameof(ReadinessText));
    }

    // ---- life cycle
    public void Start()
    {
        _dispatcher.Start();
        UpdateSleepGuard();
        UpdateTray();
    }

    public void Shutdown()
    {
        _clockTimer.Stop();
        _sleep.Dispose();
        _dispatcher.Stop();
    }

    private void UpdateSleepGuard()
    {
        if (Duty && _session.IsLoggedIn) _sleep.Hold(); else _sleep.Release();
    }

    // ---- applying a poll result (UI thread)
    private void Apply(DispatchState s)
    {
        _state = s;
        var now = DateTimeOffset.UtcNow;
        var ordered = Fmt.SortActive(s.Active);
        var ids = ordered.Select(r => r.Id).ToHashSet();

        foreach (var gone in _byId.Keys.Where(k => !ids.Contains(k)).ToList())
        {
            if (_byId.Remove(gone, out var vm)) Requests.Remove(vm);
        }

        for (var i = 0; i < ordered.Count; i++)
        {
            var dto = ordered[i];
            var ringing = s.Ringing && s.Waiting.Contains(AttentionTracker.KeyOf(dto));
            if (!_byId.TryGetValue(dto.Id, out var vm))
            {
                vm = new RequestViewModel(dto);
                _byId[dto.Id] = vm;
                Requests.Insert(Math.Min(i, Requests.Count), vm);
            }
            vm.Update(dto, ringing, _busyId == dto.Id, now, s.ClockOffsetMs);
            var at = Requests.IndexOf(vm);
            if (at != i && i < Requests.Count) Requests.Move(at, i);
        }

        History.Clear();
        foreach (var h in s.History.OrderByDescending(r => r.UpdatedAt, StringComparer.Ordinal)) History.Add(new HistoryRowViewModel(h));

        // Keep the selection while the request exists; otherwise jump to the one that needs an answer first.
        if (Selected is null || !_byId.ContainsKey(Selected.Id)) Selected = Requests.FirstOrDefault();

        Raise(nameof(Loaded));
        Raise(nameof(NotLoaded));
        Raise(nameof(Offline));
        Raise(nameof(Ringing));
        Raise(nameof(IsEmpty));
        Raise(nameof(HistoryEmpty));
        RaiseStatus();
        UpdateTray();
    }

    private void RaiseStatus()
    {
        Raise(nameof(StatusText));
        Raise(nameof(StatusBrush));
    }

    private void UpdateTray()
    {
        var waiting = _state.Waiting.Count;
        var state = _state.Offline ? TrayState.Offline : !Duty ? TrayState.OffDuty : TrayState.Connected;
        var text = _state.Offline ? "Ulanish yo‘q" : !Duty ? "Navbatchilik o‘chirilgan" : Fmt.DutyText(_state.Active.Count, waiting);
        TrayChanged?.Invoke(state, text, Duty);
    }

    private void OnRingingStarted(IReadOnlyList<RequestDto> started)
    {
        // Jump to the first request that rings, so the operator sees it at once.
        var first = started.Select(r => r.Id).FirstOrDefault(id => _byId.ContainsKey(id));
        if (first is not null) Selected = _byId[first];
        Tab = 0;
        AttentionNeeded?.Invoke(_state.Waiting.Count);
    }

    private void OnSecond()
    {
        var now = DateTimeOffset.UtcNow;
        foreach (var r in Requests) r.Tick(now, _state.ClockOffsetMs);
    }

    // ---- actions
    private async Task ActAsync(ActionItem item)
    {
        var request = item.Owner;
        if (_busyId is not null) return;
        if (!Fmt.ActionEnabled(item.Action, request.Dto, request.Busy)) return;

        if (Fmt.NeedsConfirm(item.Action))
        {
            var (title, body, yes) = Fmt.ConfirmTexts(item.Action);
            if (!_shell.Confirm(title, body, yes, "Yo‘q, ortga")) return;
        }

        _busyId = request.Id;
        request.SetBusy(true);
        try
        {
            var message = await _dispatcher.ActAsync(request.Id, item.Action);
            if (message is not null) ShowNotice(message);
        }
        finally
        {
            _busyId = null;
            if (_byId.ContainsKey(request.Id)) request.SetBusy(false);
        }
    }

    private CancellationTokenSource? _noticeTimer;

    public void ShowNotice(string text)
    {
        Notice = text;
        _noticeTimer?.Cancel();
        _noticeTimer = new CancellationTokenSource();
        var token = _noticeTimer.Token;
        _ = Task.Delay(TimeSpan.FromSeconds(6), token).ContinueWith(t =>
        {
            if (!t.IsCanceled) _ui.BeginInvoke(new Action(() => { if (!token.IsCancellationRequested) Notice = null; }));
        }, TaskScheduler.Default);
    }
}
