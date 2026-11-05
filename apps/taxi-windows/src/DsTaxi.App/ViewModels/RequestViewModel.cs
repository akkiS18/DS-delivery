using System;
using System.Collections.ObjectModel;
using System.Linq;
using System.Windows.Input;
using System.Windows.Media;
using DsTaxi.Core.Api;
using DsTaxi.Core.Dispatch;
using DsTaxi.Core.Format;

namespace DsTaxi.App.ViewModels;

/// <summary>One button of a request. The server decides which exist (<c>actions[]</c>); nothing here derives buttons from the status.</summary>
public sealed class ActionItem : ObservableObject
{
    public string Action { get; }
    public string Label { get; }
    public bool IsPrimary { get; }
    private bool _enabled;
    public bool Enabled { get => _enabled; set => Set(ref _enabled, value); }
    public RequestViewModel Owner { get; }

    public ActionItem(RequestViewModel owner, string action, string label, bool primary, bool enabled)
    {
        Owner = owner;
        Action = action;
        Label = label;
        IsPrimary = primary;
        _enabled = enabled;
    }
}

/// <summary>One taxi request as the screen shows it. Refreshed in place on every poll, so the selection and the focus never jump.</summary>
public sealed class RequestViewModel : ObservableObject
{
    private RequestDto _dto;
    private bool _ringing;
    private bool _busy;
    private long _secondsLeft = -1;
    private bool _hasTimer;
    private DateTimeOffset _now = DateTimeOffset.UtcNow;
    private long _offsetMs;

    public RequestViewModel(RequestDto dto) => _dto = dto;

    public string Id => _dto.Id;
    public RequestDto Dto => _dto;

    public string Code => "#" + _dto.OrderCode;
    public bool IsTest => _dto.IsTest;
    public string StatusLabel => Fmt.StatusLookOf(_dto.Status).Label;
    public Brush StatusBrush => Palette.Of(Fmt.StatusLookOf(_dto.Status).Tone);
    public bool IsUrgent => Fmt.StatusLookOf(_dto.Status).Tone == Tone.Urgent;
    public Brush BorderBrush => IsUrgent ? Palette.Urgent : System.Windows.Media.Brushes.Transparent;

    // ---- answer countdown (only for a new request), by the server clock
    public bool HasTimer => _hasTimer;
    public string TimerText => _hasTimer ? Fmt.AnswerTimerText(_secondsLeft) : "";
    public Brush TimerBrush => _secondsLeft > 30 ? Palette.Neutral : Palette.Urgent;

    // ---- pickup / delivery
    public string RestaurantName => _dto.Restaurant.Name;
    public string RestaurantAddress => string.IsNullOrWhiteSpace(_dto.Restaurant.Address) ? "Manzil kiritilmagan" : _dto.Restaurant.Address!;
    public string? RestaurantPhone => string.IsNullOrWhiteSpace(_dto.Restaurant.Phone) ? null : _dto.Restaurant.Phone;
    public bool HasRestaurantPhone => RestaurantPhone is not null;
    public string DeliveryAddress => string.IsNullOrWhiteSpace(_dto.Delivery.Address) ? "Manzil kiritilmagan" : _dto.Delivery.Address;
    public string? CustomerPhone => string.IsNullOrWhiteSpace(_dto.Delivery.CustomerPhone) ? null : _dto.Delivery.CustomerPhone;
    public bool HasCustomerPhone => CustomerPhone is not null;
    public string? MapUrl => Fmt.MapUrl(_dto.Delivery.Lat, _dto.Delivery.Lng);
    public bool HasMap => MapUrl is not null;

    // ---- food and money
    public string FoodLine => Fmt.FoodLine(_dto);
    public Brush FoodBrush => _dto.Food.Ready ? Palette.Ok : Palette.Ink;
    public string FoodPriceLine => Fmt.FoodPriceLine(_dto);
    public bool IsCash => _dto.Payment?.Method == "CASH";
    public bool IsCard => _dto.Payment?.Method == "CARD";
    public string CashHeadline => _dto.Payment is { } p ? Fmt.CashHeadline(p) : "";
    public string CashHint => Fmt.CashHint;
    public string CardLine => Fmt.CardLine;
    public string? BlockedReason => _dto.DeliverBlockedReason;
    public bool HasBlockedReason => BlockedReason is not null;

    // ---- state shown on the card
    public bool Ringing { get => _ringing; private set => Set(ref _ringing, value); }
    public bool Busy => _busy;
    public string UpdatedClock => Fmt.ClockOf(_dto.UpdatedAt) ?? "";
    public bool Attention => _dto.Attention;
    public ObservableCollection<ActionItem> Actions { get; } = new();

    /// <summary>The action Enter performs: the first yellow one that does not need a confirmation dialog first.</summary>
    public ActionItem? PrimaryAction => Actions.FirstOrDefault(a => a.IsPrimary && a.Enabled);

    public void Update(RequestDto dto, bool ringing, bool busy, DateTimeOffset now, long clockOffsetMs)
    {
        _dto = dto;
        _busy = busy;
        _now = now;
        _offsetMs = clockOffsetMs;
        Ringing = ringing;
        RebuildActions();
        Tick(now, clockOffsetMs, raise: false);
        RaiseAll();
    }

    /// <summary>Called every second: only the countdown changes.</summary>
    public void Tick(DateTimeOffset now, long clockOffsetMs, bool raise = true)
    {
        _now = now;
        _offsetMs = clockOffsetMs;
        var left = _dto.Status == "REQUESTED" ? Fmt.SecondsLeft(_dto.AnswerBy, now, clockOffsetMs) : null;
        _hasTimer = left is not null;
        _secondsLeft = left ?? -1;
        if (!raise) return;
        Raise(nameof(HasTimer));
        Raise(nameof(TimerText));
        Raise(nameof(TimerBrush));
    }

    public void SetBusy(bool busy)
    {
        _busy = busy;
        foreach (var a in Actions) a.Enabled = Fmt.ActionEnabled(a.Action, _dto, busy);
        Raise(nameof(Busy));
    }

    private void RebuildActions()
    {
        // Keep the button objects when nothing about them changed, so a click in progress is not lost to a refresh.
        var wanted = _dto.Actions.Select(a => (Action: a, Label: Fmt.ActionLabel(a, _dto.Status), Primary: Fmt.IsPrimary(a), Enabled: Fmt.ActionEnabled(a, _dto, _busy))).ToList();
        var same = wanted.Count == Actions.Count && wanted.Select((w, i) => w.Action == Actions[i].Action && w.Label == Actions[i].Label).All(x => x);
        if (same)
        {
            for (var i = 0; i < wanted.Count; i++) Actions[i].Enabled = wanted[i].Enabled;
            return;
        }
        Actions.Clear();
        foreach (var w in wanted) Actions.Add(new ActionItem(this, w.Action, w.Label, w.Primary, w.Enabled));
    }
}

/// <summary>One line of the "Tarix" tab.</summary>
public sealed class HistoryRowViewModel
{
    public HistoryRowViewModel(RequestDto r, DateTimeOffset now)
    {
        Code = "#" + r.OrderCode;
        var look = Fmt.StatusLookOf(r.Status);
        StatusLabel = look.Label;
        StatusBrush = Palette.Of(look.Tone);
        Route = $"{r.Restaurant.Name} → {r.Delivery.Address}";
        Time = Fmt.DayClockOf(r.DeliveredAt ?? r.UpdatedAt, now) ?? "";
    }

    public string Code { get; }
    public string StatusLabel { get; }
    public Brush StatusBrush { get; }
    public string Route { get; }
    public string Time { get; }
}
