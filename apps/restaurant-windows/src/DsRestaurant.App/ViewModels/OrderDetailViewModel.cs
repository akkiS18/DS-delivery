using CommunityToolkit.Mvvm.ComponentModel;
using DsRestaurant.Core.Api.Dtos;
using DsRestaurant.Core.Common;
using DsRestaurant.Core.Finance;

namespace DsRestaurant.App.ViewModels;

public partial class OrderDetailViewModel : ViewModelBase
{
    public OrderDto Order { get; }
    private readonly ServerClock? _serverClock;
    private readonly long? _createdAtMillis;
    private readonly PrepInfo? _prepInfo;

    [ObservableProperty]
    private string _ageText = "";

    /// <summary>This order is the one open in the right-hand panel: its card in the list is highlighted.</summary>
    [ObservableProperty]
    private bool _isSelected;

    [ObservableProperty]
    private Urgency _urgency = Urgency.Calm;

    [ObservableProperty]
    private string _urgencyColor = "#94A3B8";

    [ObservableProperty]
    private PrepDisplay? _prepDisplay;

    public string Id => Order.Id;
    public string Code => Order.Code;
    public string CodeDisplay => $"#{Order.Code}";
    public string Status => Order.Status;
    public string StatusTitle => GetStatusTitle(Order.Status);

    /// <summary>Cancelled, rejected, expired, failed or completed: nothing more to do.</summary>
    public bool IsFinished => Order.Status is "COMPLETED" or "CANCELLED" or "CUSTOMER_CANCELLED" or "RESTAURANT_REJECTED" or "RESTAURANT_EXPIRED"
        or "PAYMENT_EXPIRED" or "FAILED" or "DELIVERY_ASSUMED";

    /// <summary>Colour of the status chip: red = bad end, grey = finished, amber = needs the restaurant, green = going well.</summary>
    public string StatusColor => Order.Status switch
    {
        "CANCELLED" or "CUSTOMER_CANCELLED" or "RESTAURANT_REJECTED" or "RESTAURANT_EXPIRED" or "PAYMENT_EXPIRED" or "FAILED" or "CANCELLATION_REQUESTED" => "#B91C1C",
        "COMPLETED" or "DELIVERY_ASSUMED" => "#475569",
        "WAITING_RESTAURANT" or "PAYMENT_MATCHED_UNVERIFIED" or "WAITING_CUSTOMER_CONSENT" or "PAYMENT_PENDING" => "#B45309",
        _ => "#16A34A"
    };
    public string TotalFormatted => FinanceFormat.Som(Order.TotalSom);
    public string ServiceFeeFormatted => Order.ServiceFeeSom.HasValue ? FinanceFormat.Som(Order.ServiceFeeSom.Value) : "";
    public bool IsTest => Order.IsTest == true;
    public bool HasRefund => Order.Refund != null;
    public bool NeedsPaymentVerification => Order.AwaitingPaymentVerification == true;

    public string CustomerName => string.IsNullOrWhiteSpace(Order.CustomerName) ? "Mijoz" : Order.CustomerName;
    public string CustomerPhone => Order.CustomerPhone ?? "Ko‘rsatilmagan";
    public string AddressText => Order.AddressText ?? "Olib ketish";

    public string PaymentBadge
    {
        get
        {
            if (Order.Payment?.Method == "CASH" || Order.Cash != null)
            {
                var amount = Order.Cash?.AmountSom ?? Order.TotalSom;
                return $"Naqd: {FinanceFormat.Som(amount)}";
            }
            var card = Order.Payment?.CardLast4;
            return !string.IsNullOrEmpty(card) ? $"Karta (**{card})" : "Karta";
        }
    }

    public string DeliveryBadge
    {
        get
        {
            if (Order.Delivery?.Mode == "SELF") return "O‘zimiz yetkazamiz";
            if (!string.IsNullOrEmpty(Order.TaxiCompanyName)) return $"Taksi: {Order.TaxiCompanyName}";
            if (Order.Delivery?.Preference == "WALK_OK") return "Taksi (Piyoda mumkin)";
            return "Yetkazib berish";
        }
    }

    // Action permissions - strictly from AllowedActions!
    private HashSet<string> Actions { get; }

    public bool CanAccept => Actions.Contains("ACCEPT");
    public bool CanReject => Actions.Contains("REJECT");
    public bool CanStartPreparing => Actions.Contains("START_PREPARING");
    public bool CanSetPrepTime => Actions.Contains("SET_PREP_TIME");
    /// <summary>Paid and cooking, but the kitchen has not said "Qabul qildim" yet (same rule as the phone app).</summary>
    public bool CanAcknowledge => Status == "PREPARING" && CanSetPrepTime && Order.Prep?.ChosenMinutes == null;

    /// <summary>Dishes and quantities, shown large: what the kitchen reads first.</summary>
    public IReadOnlyList<OrderItemDto> Items => Order.Items ?? [];
    public bool HasItems => Order.Items is { Count: > 0 };
    public bool CanMarkReady => Actions.Contains("MARK_READY");
    public bool CanSelfDeliver => Actions.Contains("SELF_DELIVERED");
    public bool CanVerifyPayment => Actions.Contains("VERIFY_PAYMENT");
    public bool CanCancel => Actions.Contains("CANCEL_ORDER");
    public bool CanApproveRefund => Actions.Contains("REFUND_APPROVE");
    public bool CanRejectRefund => Actions.Contains("REFUND_REJECT");
    public bool CanSendRefund => Actions.Contains("REFUND_SENT");

    public OrderDetailViewModel(OrderDto order, ServerClock? clock, long nowElapsed)
    {
        Order = order;
        _serverClock = clock;
        _createdAtMillis = ServerClockHelper.ParseIsoMillis(order.CreatedAt);
        Actions = new HashSet<string>(order.AllowedActions ?? [], StringComparer.OrdinalIgnoreCase);

        if (order.Prep != null && clock != null)
        {
            long started = ServerClockHelper.ParseIsoMillis(order.Prep.StartedAt) ?? clock.ServerNowMillis;
            long? ready = ServerClockHelper.ParseIsoMillis(order.Prep.EstimatedReadyAt);
            _prepInfo = new PrepInfo(
                Minutes: order.Prep.Minutes ?? 20,
                StartedAtMillis: started,
                EstimatedReadyAtMillis: ready,
                ServerNowMillis: clock.ServerNowMillis,
                ReceivedAtElapsed: clock.ReceivedAtElapsed,
                ChosenMinutes: order.Prep.ChosenMinutes
            );
        }

        UpdateTimer(nowElapsed);
    }

    public void UpdateTimer(long nowElapsed)
    {
        AgeText = ServerClockHelper.AgeText(_createdAtMillis, _serverClock, nowElapsed) ?? "";
        long? ageMin = ServerClockHelper.AgeMinutes(_createdAtMillis, _serverClock, nowElapsed);
        // How long an order has waited only matters while it is still open; a finished or cancelled one is never "late".
        Urgency = IsFinished ? Urgency.Calm : ServerClockHelper.UrgencyOf(ageMin);

        UrgencyColor = Urgency switch
        {
            Urgency.Late => "#EF4444", // Red
            Urgency.Soon => "#F59E0B", // Orange
            _ => "#94A3B8"             // Calm slate
        };

        PrepDisplay = _prepInfo?.Display(nowElapsed);
    }

    public static string GetStatusTitle(string raw)
    {
        return raw switch
        {
            "WAITING_RESTAURANT" => "Yangi buyurtma",
            "WAITING_CUSTOMER_CONSENT" => "Mijoz roziligi kutilmoqda",
            "CUSTOMER_CANCELLED" => "Mijoz bekor qilgan",
            "RESTAURANT_REJECTED" => "Rad etilgan",
            "RESTAURANT_EXPIRED" => "Vaqti o‘tgan",
            "PAYMENT_PENDING" => "To‘lov kutilmoqda",
            "PAYMENT_EXPIRED" => "To‘lov muddati o‘tgan",
            "PAYMENT_MATCHED_UNVERIFIED" => "To‘lov keldi",
            "PAYMENT_CONFIRMED" => "To‘langan",
            "ACCEPTED" => "Qabul qilingan",
            "PREPARING" => "Tayyorlanmoqda",
            "READY" => "Tayyor",
            "TAXI_REQUESTED" => "Taksi chaqirilgan",
            "DRIVER_ASSIGNED" => "Haydovchi biriktirildi",
            "DELIVERY_ASSUMED" => "Yetkazildi deb hisoblangan",
            "COMPLETED" => "Yakunlangan",
            "CANCELLATION_REQUESTED" => "Bekor qilish so‘rovi",
            "CANCELLED" => "Bekor qilingan",
            "FAILED" => "Xatolik",
            _ => raw
        };
    }
}
