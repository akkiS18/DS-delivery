using System.Text.Json.Serialization;

namespace DsRestaurant.Core.Api.Dtos;

public record ReservationDto(
    [property: JsonPropertyName("id")] string? Id = null,
    [property: JsonPropertyName("code")] string? Code = null,
    [property: JsonPropertyName("status")] string? Status = null,
    [property: JsonPropertyName("startsAt")] string? StartsAt = null,
    [property: JsonPropertyName("partySize")] int? PartySize = null,
    [property: JsonPropertyName("note")] string? Note = null,
    [property: JsonPropertyName("customerName")] string? CustomerName = null,
    [property: JsonPropertyName("customerPhone")] string? CustomerPhone = null,
    [property: JsonPropertyName("depositSom")] int? DepositSom = null,
    [property: JsonPropertyName("paidAt")] string? PaidAt = null,
    [property: JsonPropertyName("seen")] bool? Seen = null,
    [property: JsonPropertyName("isTest")] bool? IsTest = null,
    [property: JsonPropertyName("awaitingConfirm")] bool? AwaitingConfirm = null
);

public record ReservationSettingsDto(
    [property: JsonPropertyName("enabled")] bool? Enabled = null,
    [property: JsonPropertyName("depositSom")] int? DepositSom = null
);

public record ReservationsReportDto(
    [property: JsonPropertyName("settings")] ReservationSettingsDto? Settings = null,
    [property: JsonPropertyName("unseenCount")] int? UnseenCount = null,
    [property: JsonPropertyName("upcoming")] List<ReservationDto>? Upcoming = null,
    [property: JsonPropertyName("past")] List<ReservationDto>? Past = null
);

public record ReservationCancelRequestDto(
    [property: JsonPropertyName("reason")] string Reason
);

public record ReservationSettingsRequestDto(
    [property: JsonPropertyName("enabled")] bool Enabled,
    [property: JsonPropertyName("depositSom")] int DepositSom
);
