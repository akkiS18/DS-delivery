using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Globalization;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;
using DsTaxi.App.Services;
using DsTaxi.Core.Api;
using DsTaxi.Core.Dispatch;
using DsTaxi.Core.Format;
using DsTaxi.Core.Versioning;

namespace DsTaxi.App.ViewModels;

/// <summary>What the main window needs from the shell (dialogs, clipboard, links). The window implements it; tests could fake it.</summary>
public interface IShell
{
    /// <summary>A yes/no question. <paramref name="defaultYes"/> says which button Enter presses; the safe answer ("no") is the default.</summary>
    bool Confirm(string title, string body, string yes, string no, bool defaultYes = false);
    void Copy(string text);
    void OpenUrl(string url);
    void OpenFolder(string path);
    void ShowWindow();
}

/// <summary>
/// The operator's screen: requests, history, duty, readiness. Everything the phone's MainScreen/SettingsTab does, laid out for a wide window.
/// Dispatcher events arrive on thread-pool threads and are marshalled to the UI thread here.
///
/// Nothing on the screen moves by itself: a NEW request that needs an answer does not change the selection, the tab or the order of the requests the
/// operator is looking at. It is listed after them and announced by a card (<see cref="AlertRequest"/>) pinned at the top; pressing the card opens it.
/// </summary>
public sealed class MainViewModel : ObservableObject
{
    private static readonly TimeSpan OfflineWarnAfter = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan OfflineWarnEvery = TimeSpan.FromSeconds(60);

    private readonly Core.Dispatch.Dispatcher _dispatcher;
    private readonly SessionStore _session;
    private readonly AlarmPlayer _alarm;
    private readonly IShell _shell;
    private readonly System.Windows.Threading.Dispatcher _ui;
    private readonly DispatcherTimer _clockTimer;
    private readonly Dictionary<string, RequestViewModel> _byId = new();
    private readonly SleepGuard _sleep = new();
    private HashSet<string>? _seen; // "id:status" keys the operator has already been shown; null until the first list arrived
    private string? _busyId;
    private RequestViewModel? _selected;
    private RequestViewModel? _alert;
    private int _alertMore;
    private DispatchState _state = new();
    private string? _notice;
    private int _tab;
    private bool _audioMissing;
    private bool _applying;
    private bool _compact;
    private DateTimeOffset? _offlineSince;
    private DateTimeOffset _lastOfflineWarn = DateTimeOffset.MinValue;
    private string _historyText = "";
    private int _historyKind;
    private string _historySignature = "";
    private string _historySummary = "So‘nggi 24 soat";
    private UpdateState _updateInfo = UpdateState.Current;
    private bool _stoppedForUpdate;

    public MainViewModel(Core.Dispatch.Dispatcher dispatcher, SessionStore session, AlarmPlayer alarm, IShell shell, System.Windows.Threading.Dispatcher ui)
    {
        _dispatcher = dispatcher;
        _session = session;
        _alarm = alarm;
        _shell = shell;
        _ui = ui;

        SilenceCommand = new RelayCommand(() => _dispatcher.Silence());
        RefreshCommand = new AsyncCommand(() => _dispatcher.RefreshNowAsync());
        ActCommand = new AsyncCommand(async p => { if (p is ActionItem item) await ActAsync(item, viaKeyboard: false); });
        PrimaryCommand = new AsyncCommand(async _ => { if (Selected?.PrimaryAction is { } a) await ActAsync(a, viaKeyboard: true); },
            _ => Selected?.PrimaryAction is not null && !UpdateRequired);
        TestSoundCommand = new AsyncCommand(TestSoundAsync);
        CopyCommand = new RelayCommand(p => { if (p is string s && s.Length > 0) { _shell.Copy(s); ShowNotice("Nusxalandi"); } });
        OpenMapCommand = new RelayCommand(p => { if (p is string url && url.StartsWith("https://", StringComparison.Ordinal)) _shell.OpenUrl(url); });
        FixCommand = new AsyncCommand(FixAsync);
        SelectTabCommand = new RelayCommand(p => { if (p is string s && int.TryParse(s, out var i)) Tab = i; });
        AlertOpenCommand = new RelayCommand(() => OpenAlert());
        AlertDismissCommand = new RelayCommand(() => DismissAlert());
        DismissNoticeCommand = new RelayCommand(() => Notice = null);
        ToggleCompactCommand = new RelayCommand(() => IsCompact = !IsCompact);
        OpenLogsCommand = new RelayCommand(() => { System.IO.Directory.CreateDirectory(AppPaths.Logs); _shell.OpenFolder(AppPaths.Logs); });
        CopyVersionCommand = new RelayCommand(() => { _shell.Copy($"{VersionText} ({Environment.OSVersion.VersionString})"); ShowNotice("Versiya nusxalandi"); });
        OpenUpdateCommand = new RelayCommand(() =>
        {
            if (_updateInfo.DownloadUrl is { } url && url.StartsWith("https://", StringComparison.Ordinal)) _shell.OpenUrl(url);
        });

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
    public ICommand AlertOpenCommand { get; }
    public ICommand AlertDismissCommand { get; }
    public ICommand DismissNoticeCommand { get; }
    public ICommand ToggleCompactCommand { get; }
    public ICommand OpenLogsCommand { get; }
    public ICommand CopyVersionCommand { get; }
    public ICommand OpenUpdateCommand { get; }

    /// <summary>Raised when the shell should update the tray icon/tooltip.</summary>
    public event Action<TrayState, string, bool>? TrayChanged;
    /// <summary>Raised when requests START ringing: the shell shows the window, flashes the taskbar and shows a balloon.</summary>
    public event Action<int>? AttentionNeeded;
    /// <summary>A balloon (title, text) for the tray: used when the connection stays down.</summary>
    public event Action<string, string>? BalloonRequested;
    /// <summary>The compact (small, always on top) mode was switched.</summary>
    public event Action<bool>? CompactChanged;

    // ---- tabs: 0 = So'rovlar, 1 = Tarix, 2 = Sozlamalar
    public int Tab { get => _tab; set { if (Set(ref _tab, value)) { Raise(nameof(IsRequestsTab)); Raise(nameof(IsHistoryTab)); Raise(nameof(IsSettingsTab)); } } }
    public bool IsRequestsTab => _tab == 0;
    public bool IsHistoryTab => _tab == 1;
    public bool IsSettingsTab => _tab == 2;

    public RequestViewModel? Selected
    {
        get => _selected;
        set
        {
            if (!Set(ref _selected, value)) return;
            CommandManager.InvalidateRequerySuggested();
            // Looking at a request counts as having seen it; this also moves it to its place in the list.
            if (!_applying && value is not null) Apply(_state);
        }
    }

    // ---- the "new request" card
    public RequestViewModel? AlertRequest { get => _alert; private set { if (Set(ref _alert, value)) Raise(nameof(HasAlert)); } }
    public int AlertMore { get => _alertMore; private set { if (Set(ref _alertMore, value)) { Raise(nameof(HasAlertMore)); Raise(nameof(AlertMoreText)); } } }
    public bool HasAlert => _alert is not null;
    public bool HasAlertMore => _alertMore > 0;
    public string AlertMoreText => $"+{_alertMore} ta yana";

    private void OpenAlert()
    {
        if (_alert is null) return;
        Tab = 0;
        Selected = _alert; // marks it seen, moves it to its place and the view scrolls it into sight
    }

    private void DismissAlert()
    {
        if (_alert is null || _seen is null) return;
        _seen.Add(AttentionTracker.KeyOf(_alert.Dto));
        Apply(_state);
    }

    public string CompanyName => _session.CompanyName ?? "";
    /// <summary>The taxi park's name in capitals for the top bar.</summary>
    public string CompanyTitle => CompanyName.ToUpperInvariant();
    public string LoginName => _session.Login ?? "";
    public string VersionText => "DS " + AppInfo.Version;

    public bool Loaded => _state.Loaded;
    public bool Offline => _state.Offline;
    public bool Ringing => _state.Ringing;
    public bool IsEmpty => _state.Loaded && Requests.Count == 0;
    public bool NotLoaded => !_state.Loaded;
    public string LoadingText => _state.Offline ? "Serverga ulanib bo‘lmadi. Internetni tekshiring — qayta urinilmoqda..." : "Yuklanmoqda...";
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
            RefreshReadiness();
        }
    }

    public string DutyHelp => Duty
        ? "Dastur fonda ishlaydi, yangi so‘rovda gudok chaladi (ekran o‘chiq bo‘lsa ham)."
        : "Dastur yopiq bo‘lsa so‘rovlar kelmaydi va signal chalinmaydi.";

    // ---- status strip (offline -> red, off duty -> grey, else green): same words as the phone
    public string StatusText => _state.Offline ? "Ulanish yo‘q — yangi so‘rovlar kelmayapti" : !Duty ? "Navbatchilik o‘chirilgan" : "Ulangan • navbatchilik yoqilgan";
    public Brush StatusBrush => _state.Offline ? Palette.Urgent : !Duty ? Palette.Neutral : Palette.Ok;

    // ---- short messages: a toast at the bottom (never pushes the content), errors stay longer
    public string? Notice { get => _notice; private set { Set(ref _notice, value); Raise(nameof(HasNotice)); } }
    public bool HasNotice => !string.IsNullOrEmpty(_notice);

    // ---- readiness (the PC replacement of the phone's "Tayyorlik")
    public bool AutostartOn => Autostart.IsEnabled();
    public bool AudioMissing => _audioMissing;
    private static string Today => DateTime.Now.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
    public bool SoundTestedToday => _session.Settings.LastSoundTest == Today;
    public bool ReadinessProblem => !AutostartOn || _audioMissing || (Duty && !SoundTestedToday);
    public string ReadinessText
    {
        get
        {
            var problems = new List<string>();
            if (_audioMissing) problems.Add("tovush chiqarish qurilmasi topilmadi");
            if (Duty && !SoundTestedToday) problems.Add("bugun ovoz sinalmagan (Tuzatish bosilsa, gudok bir marta chalinadi)");
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
        catch (Exception e) when (e is UnauthorizedAccessException or System.Security.SecurityException) { Log.Error("autostart could not be changed", e); ShowNotice("Avtoyuklashni o‘zgartirib bo‘lmadi.", sticky: true); }
    }

    public void RefreshReadiness()
    {
        _audioMissing = !AudioDevices.HasOutput();
        Raise(nameof(AutostartOn));
        Raise(nameof(AudioMissing));
        Raise(nameof(SoundTestedToday));
        Raise(nameof(ReadinessProblem));
        Raise(nameof(ReadinessText));
    }

    private async Task TestSoundAsync()
    {
        await _alarm.TestAsync();
        _session.Update(s => s.LastSoundTest = Today);
        RefreshReadiness();
    }

    private async Task FixAsync()
    {
        if (!AutostartOn) SetAutostart(true);
        if (Duty && !SoundTestedToday) await TestSoundAsync();
        RefreshReadiness();
    }

    // ---- compact mode: a small window that stays on top of the other programs
    public bool IsCompact
    {
        get => _compact;
        set
        {
            if (!Set(ref _compact, value)) return;
            Raise(nameof(ListColumnWidth));
            Raise(nameof(DetailColumnWidth));
            Raise(nameof(ListRowHeight));
            Raise(nameof(DetailRowHeight));
            Raise(nameof(CompactButtonText));
            CompactChanged?.Invoke(value);
        }
    }

    public string CompactButtonText => _compact ? "Kengaytirish" : "Ixcham";
    public GridLength ListColumnWidth => _compact ? new GridLength(1, GridUnitType.Star) : new GridLength(340);
    public GridLength DetailColumnWidth => _compact ? new GridLength(0) : new GridLength(1, GridUnitType.Star);
    public GridLength ListRowHeight => _compact ? new GridLength(150) : new GridLength(1, GridUnitType.Star);
    public GridLength DetailRowHeight => _compact ? new GridLength(1, GridUnitType.Star) : new GridLength(0);

    // ---- program version rules from the server
    public bool UpdateRequired => _updateInfo.Level == UpdateLevel.Required;
    public bool UpdateAvailable => _updateInfo.Level == UpdateLevel.Available;
    public bool HasUpdateLink => !string.IsNullOrEmpty(_updateInfo.DownloadUrl);
    public bool HasUpdateLinkNot => !HasUpdateLink;
    public string UpdateText => UpdateRequired
        ? "Dastur versiyasi eskirgan. Ishlashni davom ettirish uchun yangi versiyani o‘rnating."
        : $"Yangi versiya bor: {_updateInfo.LatestVersion}. Qulay vaqtda yangilang.";

    public void ApplyUpdateState(UpdateState state)
    {
        _updateInfo = state;
        Raise(nameof(UpdateRequired));
        Raise(nameof(UpdateAvailable));
        Raise(nameof(HasUpdateLink));
        Raise(nameof(HasUpdateLinkNot));
        Raise(nameof(UpdateText));
        CommandManager.InvalidateRequerySuggested();
        if (state.Level == UpdateLevel.Required && !_stoppedForUpdate)
        {
            _stoppedForUpdate = true; // an old program must not keep answering a server it no longer understands
            _dispatcher.Stop();
        }
        else if (state.Level != UpdateLevel.Required && _stoppedForUpdate)
        {
            _stoppedForUpdate = false;
            _dispatcher.Start();
        }
    }

    // ---- history: search + outcome filter + summary
    public string HistoryText { get => _historyText; set { if (Set(ref _historyText, value)) RebuildHistory(DateTimeOffset.UtcNow); } }
    public int HistoryKindIndex { get => _historyKind; set { if (Set(ref _historyKind, value)) RebuildHistory(DateTimeOffset.UtcNow); } }
    public string HistorySummary { get => _historySummary; private set => Set(ref _historySummary, value); }
    public bool HistoryEmpty => _state.Loaded && History.Count == 0;
    public string HistoryEmptyText => _historyText.Trim().Length > 0 || _historyKind != 0 ? "Hech narsa topilmadi." : "Hozircha tarix yo‘q";

    private void RebuildHistory(DateTimeOffset now)
    {
        var rows = HistoryFilter.Apply(_state.History, _historyText, (HistoryKind)Math.Clamp(_historyKind, 0, 2));
        // The list is rebuilt only when it really changed, so a poll every 3 seconds does not reset the operator's scrolling.
        var signature = string.Join("|", rows.Select(r => r.Id + ":" + r.Status + ":" + r.UpdatedAt));
        HistorySummary = HistoryFilter.Summary(_state.History.ToList());
        if (signature != _historySignature)
        {
            _historySignature = signature;
            History.Clear();
            foreach (var r in rows) History.Add(new HistoryRowViewModel(r, now));
        }
        Raise(nameof(HistoryEmpty));
        Raise(nameof(HistoryEmptyText));
    }

    // ---- life cycle
    public void Start()
    {
        if (!_stoppedForUpdate) _dispatcher.Start();
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
        _applying = true;
        try
        {
            _state = s;
            var now = DateTimeOffset.UtcNow;
            var ordered = Fmt.SortActive(s.Active);

            // What the operator has already been shown: everything present when the first list arrived, whatever is selected, whatever he opened.
            if (_seen is null && s.Loaded) _seen = ordered.Select(AttentionTracker.KeyOf).ToHashSet();
            if (_seen is not null)
            {
                if (Selected is not null && ordered.FirstOrDefault(r => r.Id == Selected.Id) is { } current) _seen.Add(AttentionTracker.KeyOf(current));
                var live = ordered.Select(AttentionTracker.KeyOf).ToHashSet();
                _seen.RemoveWhere(k => !live.Contains(k));
            }

            // A new request that needs an answer waits at the END of the list (the order the operator is looking at does not change) and gets the card.
            var unseen = _seen is null
                ? new HashSet<string>()
                : ordered.Where(r => r.Attention && !_seen.Contains(AttentionTracker.KeyOf(r))).Select(r => r.Id).ToHashSet();
            var shown = ordered.Where(r => !unseen.Contains(r.Id)).Concat(ordered.Where(r => unseen.Contains(r.Id))).ToList();
            var ids = shown.Select(r => r.Id).ToHashSet();

            foreach (var gone in _byId.Keys.Where(k => !ids.Contains(k)).ToList())
            {
                if (_byId.Remove(gone, out var vm)) Requests.Remove(vm);
            }

            for (var i = 0; i < shown.Count; i++)
            {
                var dto = shown[i];
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

            // Keep the selection while the request exists; otherwise the first one in the list (what is selected has been seen).
            if (Selected is null || !_byId.ContainsKey(Selected.Id)) Selected = Requests.FirstOrDefault();
            if (Selected is not null && unseen.Remove(Selected.Id)) _seen?.Add(AttentionTracker.KeyOf(Selected.Dto));

            var alertDto = ordered.FirstOrDefault(r => unseen.Contains(r.Id));
            AlertRequest = alertDto is not null && _byId.TryGetValue(alertDto.Id, out var alertVm) ? alertVm : null;
            AlertMore = Math.Max(0, unseen.Count - 1);

            RebuildHistory(now);

            if (!s.Offline) _offlineSince = null;

            Raise(nameof(Loaded));
            Raise(nameof(NotLoaded));
            Raise(nameof(Offline));
            Raise(nameof(Ringing));
            Raise(nameof(IsEmpty));
            Raise(nameof(LoadingText));
            RaiseStatus();
            UpdateTray();
        }
        finally
        {
            _applying = false;
        }
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
        // Deliberately NO change of selection or tab: the new request is announced by the card (and the window comes up, flashes and rings).
        AttentionNeeded?.Invoke(_state.Waiting.Count);
    }

    private void OnSecond()
    {
        var now = DateTimeOffset.UtcNow;
        foreach (var r in Requests) r.Tick(now, _state.ClockOffsetMs);

        // A lost connection is silent by nature: remind the operator with a short warning sound every minute (and one balloon) while on duty.
        if (_state.Offline && Duty && !UpdateRequired)
        {
            _offlineSince ??= now;
            if (now - _offlineSince >= OfflineWarnAfter && now - _lastOfflineWarn >= OfflineWarnEvery)
            {
                var first = _lastOfflineWarn == DateTimeOffset.MinValue;
                _lastOfflineWarn = now;
                _alarm.PlayWarning();
                if (first) BalloonRequested?.Invoke("Ulanish yo‘q", "Yangi so‘rovlar kelmayapti. Internetni tekshiring.");
            }
        }
        else
        {
            _offlineSince = null;
            _lastOfflineWarn = DateTimeOffset.MinValue;
        }
    }

    // ---- actions
    private async Task ActAsync(ActionItem item, bool viaKeyboard)
    {
        var request = item.Owner;
        if (_busyId is not null || UpdateRequired) return;
        if (!Fmt.ActionEnabled(item.Action, request.Dto, request.Busy)) return;

        if (Fmt.NeedsConfirm(item.Action))
        {
            // Hard to undo: its own question, and "no" is the answer Enter gives.
            var (title, body, yes) = Fmt.ConfirmTexts(item.Action);
            if (!_shell.Confirm(title, body, yes, "Yo‘q, ortga", defaultYes: false)) return;
        }
        else if (viaKeyboard)
        {
            // Enter must never accept a request by habit: ask once, in the button's own words.
            var (title, body, yes) = Fmt.KeyboardConfirmTexts(item.Action, request.Dto.Status);
            if (!_shell.Confirm(title, body, yes, "Yo‘q, ortga", defaultYes: true)) return;
        }

        // The list kept refreshing while the question was open: do it only if the server still offers this button.
        if (!_byId.ContainsKey(request.Id) || !request.Dto.Actions.Contains(item.Action) || !Fmt.ActionEnabled(item.Action, request.Dto, request.Busy)) return;

        _busyId = request.Id;
        request.SetBusy(true);
        try
        {
            var message = await _dispatcher.ActAsync(request.Id, item.Action);
            if (message is not null) ShowNotice(message, sticky: true);
        }
        finally
        {
            _busyId = null;
            if (_byId.ContainsKey(request.Id)) request.SetBusy(false);
        }
    }

    private CancellationTokenSource? _noticeTimer;

    /// <param name="sticky">Errors stay for 12 seconds (or until closed), plain confirmations for 3.</param>
    public void ShowNotice(string text, bool sticky = false)
    {
        Notice = text;
        _noticeTimer?.Cancel();
        _noticeTimer = new CancellationTokenSource();
        var token = _noticeTimer.Token;
        _ = Task.Delay(TimeSpan.FromSeconds(sticky ? 12 : 3), token).ContinueWith(t =>
        {
            if (!t.IsCanceled) _ui.BeginInvoke(new Action(() => { if (!token.IsCancellationRequested) Notice = null; }));
        }, TaskScheduler.Default);
    }
}
