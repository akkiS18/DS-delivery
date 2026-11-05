namespace DsTaxi.Core.Api;

// Mirrors src/modules/taxi-app (backend) and apps/taxi-android/.../data/Dtos.kt. Only the fields the app uses.
// Every member has a default: a server older or newer than the program must never crash it. Dates stay ISO-8601 strings (parsed where shown).

public sealed class LoginRequest
{
    public string Login { get; init; } = "";
    public string Password { get; init; } = "";
}

public sealed class CompanyDto
{
    public string Id { get; init; } = "";
    public string Name { get; init; } = "";
    public string Login { get; init; } = "";
}

public sealed class LoginResponse
{
    public string AccessToken { get; init; } = "";
    public string ExpiresAt { get; init; } = "";
    public CompanyDto Company { get; init; } = new();
}

public sealed class RestaurantInfo
{
    public string Name { get; init; } = "";
    public string? Address { get; init; }
    public string? Phone { get; init; }
}

public sealed class DeliveryInfo
{
    public string Address { get; init; } = "";
    public double? Lat { get; init; }
    public double? Lng { get; init; }
    public string? CustomerPhone { get; init; }
}

public sealed class FoodInfo
{
    public bool Ready { get; init; }
    public string Status { get; init; } = "";
    public int? PrepMinutes { get; init; }
    public string? EstimatedReadyAt { get; init; }
    public string? ReadyAt { get; init; }
    public int TotalSom { get; init; }
}

/// <summary>How the food is paid. CASH: the driver pays the restaurant <see cref="PayRestaurantSom"/> at pickup and collects it from the customer. CARD: already paid.</summary>
public sealed class PaymentInfo
{
    public string Method { get; init; } = "";
    public int PayRestaurantSom { get; init; }
}

/// <summary>One taxi request. <see cref="Actions"/> is decided by the server (what this company may press now).</summary>
public sealed class RequestDto
{
    public string Id { get; init; } = "";
    public string OrderCode { get; init; } = "";
    public string Status { get; init; } = "";
    public bool Attention { get; init; }
    public string CreatedAt { get; init; } = "";
    public string? SentAt { get; init; }
    public string? AnswerBy { get; init; }
    public string UpdatedAt { get; init; } = "";
    public string? DeliveredAt { get; init; }
    public bool IsTest { get; init; }
    public RestaurantInfo Restaurant { get; init; } = new();
    public DeliveryInfo Delivery { get; init; } = new();
    public FoodInfo Food { get; init; } = new();
    /// <summary>Absent from an older server.</summary>
    public PaymentInfo? Payment { get; init; }
    public List<string> Actions { get; init; } = new();
    public string? DeliverBlockedReason { get; init; }
}

public sealed class RequestsResponse
{
    public string ServerNow { get; init; } = "";
    public CompanyDto Company { get; init; } = new();
    public List<RequestDto> Active { get; init; } = new();
    public List<RequestDto> History { get; init; } = new();
}

public sealed class ActionRequest
{
    public string Action { get; init; } = "";
}

public sealed class ActionResponse
{
    public bool Changed { get; init; }
    public string FinalStatus { get; init; } = "";
    public string? FallbackCompany { get; init; }
    public RequestDto? Request { get; init; }
}

public sealed class ApiErrorBody
{
    public string? Error { get; init; }
    public string? Message { get; init; }
    public int? RetryAfterSeconds { get; init; }
}

/// <summary>What an operator can press. The wire names are the backend's.</summary>
public static class TaxiAction
{
    public const string Accept = "ACCEPT";
    public const string Sent = "SENT";
    public const string NoTaxi = "NO_TAXI";
    public const string Delivered = "DELIVERED";
}

/// <summary>GET /api/v1/taxi/client-config (public): what the server asks of the Windows program. Any field may be null = no rule.</summary>
public sealed class WindowsClientConfig
{
    public string? MinVersion { get; init; }
    public string? LatestVersion { get; init; }
    public string? DownloadUrl { get; init; }
}

public sealed class ClientConfigResponse
{
    public WindowsClientConfig? Windows { get; init; }
}
