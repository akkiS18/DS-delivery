using System.Text.Json.Serialization;

namespace DsRestaurant.Core.Api.Dtos;

public record OrdersResponse(
    [property: JsonPropertyName("orders")] List<OrderDto>? Orders = null,
    [property: JsonPropertyName("nextCursor")] string? NextCursor = null,
    [property: JsonPropertyName("counts")] OrderCountsDto? Counts = null
);

public record OrderCountsDto(
    [property: JsonPropertyName("incoming")] int Incoming = 0,
    [property: JsonPropertyName("inProgress")] int InProgress = 0,
    [property: JsonPropertyName("ready")] int Ready = 0,
    [property: JsonPropertyName("attention")] int Attention = 0,
    [property: JsonPropertyName("new")] int New = 0,
    [property: JsonPropertyName("cooking")] int Cooking = 0,
    [property: JsonPropertyName("waiting")] int Waiting = 0
);

public record OrderItemDto(
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("unitSom")] int UnitSom,
    [property: JsonPropertyName("quantity")] int Quantity,
    [property: JsonPropertyName("subtotalSom")] int SubtotalSom
);

public record PaymentDto(
    [property: JsonPropertyName("status")] string? Status = null,
    [property: JsonPropertyName("isTest")] bool? IsTest = null,
    [property: JsonPropertyName("amountSom")] int? AmountSom = null,
    [property: JsonPropertyName("cardLast4")] string? CardLast4 = null,
    [property: JsonPropertyName("method")] string? Method = null
);

public record CashDto(
    [property: JsonPropertyName("amountSom")] int? AmountSom = null,
    [property: JsonPropertyName("accepted")] bool? Accepted = null
);

public record TaxiDto(
    [property: JsonPropertyName("status")] string? Status = null,
    [property: JsonPropertyName("stage")] string? Stage = null,
    [property: JsonPropertyName("attemptNo")] int? AttemptNo = null,
    [property: JsonPropertyName("companyName")] string? CompanyName = null,
    [property: JsonPropertyName("acceptedAt")] string? AcceptedAt = null,
    [property: JsonPropertyName("dispatchedAt")] string? DispatchedAt = null,
    [property: JsonPropertyName("deliveredAt")] string? DeliveredAt = null
);

public record LocationDto(
    [property: JsonPropertyName("lat")] double? Lat = null,
    [property: JsonPropertyName("lng")] double? Lng = null
);

public record DeliveryDto(
    [property: JsonPropertyName("preference")] string? Preference = null,
    [property: JsonPropertyName("mode")] string? Mode = null,
    [property: JsonPropertyName("selfDeliveredAt")] string? SelfDeliveredAt = null,
    [property: JsonPropertyName("location")] LocationDto? Location = null
);

/// <summary>The bank-side signal the server matched to this order (Gmail / Humocard message). It is a hint, never proof of a bank credit.</summary>
public record PaymentSignalDto(
    [property: JsonPropertyName("source")] string? Source = null,
    [property: JsonPropertyName("amountSom")] int? AmountSom = null,
    [property: JsonPropertyName("occurredAt")] string? OccurredAt = null,
    [property: JsonPropertyName("receivedAt")] string? ReceivedAt = null,
    [property: JsonPropertyName("trustedSender")] bool? TrustedSender = null,
    [property: JsonPropertyName("cardLast4")] string? CardLast4 = null,
    [property: JsonPropertyName("amountMatches")] bool? AmountMatches = null
);

public record PaymentEvidenceDto(
    [property: JsonPropertyName("expectedAmountSom")] int? ExpectedAmountSom = null,
    [property: JsonPropertyName("status")] string? Status = null,
    [property: JsonPropertyName("isTest")] bool? IsTest = null,
    [property: JsonPropertyName("cardLast4")] string? CardLast4 = null,
    [property: JsonPropertyName("assignedAt")] string? AssignedAt = null,
    [property: JsonPropertyName("matchedAt")] string? MatchedAt = null,
    [property: JsonPropertyName("verifiedAt")] string? VerifiedAt = null,
    [property: JsonPropertyName("signal")] PaymentSignalDto? Signal = null,
    [property: JsonPropertyName("notBankProof")] bool NotBankProof = false
);

public record MenuProblemDto(
    [property: JsonPropertyName("kind")] string? Kind = null,
    [property: JsonPropertyName("name")] string? Name = null
);

public record RefundDto(
    [property: JsonPropertyName("id")] string? Id = null,
    [property: JsonPropertyName("kind")] string? Kind = null,
    [property: JsonPropertyName("status")] string? Status = null,
    [property: JsonPropertyName("reasonCode")] string? ReasonCode = null,
    [property: JsonPropertyName("requestedBy")] string? RequestedBy = null,
    [property: JsonPropertyName("paidAmountSom")] int? PaidAmountSom = null,
    [property: JsonPropertyName("approvedAmountSom")] int? ApprovedAmountSom = null,
    [property: JsonPropertyName("bankReference")] string? BankReference = null,
    [property: JsonPropertyName("hasReceipt")] bool HasReceipt = false,
    [property: JsonPropertyName("rejectReason")] string? RejectReason = null
);

public record PrepDto(
    [property: JsonPropertyName("minutes")] int? Minutes = null,
    [property: JsonPropertyName("startedAt")] string? StartedAt = null,
    [property: JsonPropertyName("estimatedReadyAt")] string? EstimatedReadyAt = null,
    [property: JsonPropertyName("chosenMinutes")] int? ChosenMinutes = null
);

public record OrderDto(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("code")] string Code,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("totalSom")] int TotalSom,
    [property: JsonPropertyName("serviceFeeSom")] int? ServiceFeeSom = null,
    [property: JsonPropertyName("createdAt")] string CreatedAt = "",
    [property: JsonPropertyName("estimatedPrepMinutes")] int? EstimatedPrepMinutes = null,
    [property: JsonPropertyName("items")] List<OrderItemDto>? Items = null,
    [property: JsonPropertyName("payment")] PaymentDto? Payment = null,
    [property: JsonPropertyName("cash")] CashDto? Cash = null,
    [property: JsonPropertyName("taxi")] TaxiDto? Taxi = null,
    [property: JsonPropertyName("taxiCompanyName")] string? TaxiCompanyName = null,
    [property: JsonPropertyName("delivery")] DeliveryDto? Delivery = null,
    [property: JsonPropertyName("customerName")] string? CustomerName = null,
    [property: JsonPropertyName("customerPhone")] string? CustomerPhone = null,
    [property: JsonPropertyName("addressText")] string? AddressText = null,
    [property: JsonPropertyName("isTest")] bool? IsTest = null,
    [property: JsonPropertyName("rejectReason")] string? RejectReason = null,
    [property: JsonPropertyName("restaurantDeadlineAt")] string? RestaurantDeadlineAt = null,
    [property: JsonPropertyName("allowedActions")] List<string>? AllowedActions = null,
    [property: JsonPropertyName("awaitingPaymentVerification")] bool? AwaitingPaymentVerification = null,
    [property: JsonPropertyName("defaultPrepMinutes")] int? DefaultPrepMinutes = null,
    [property: JsonPropertyName("paymentEvidence")] PaymentEvidenceDto? PaymentEvidence = null,
    [property: JsonPropertyName("menuProblems")] List<MenuProblemDto>? MenuProblems = null,
    [property: JsonPropertyName("refund")] RefundDto? Refund = null,
    [property: JsonPropertyName("attention")] List<string>? Attention = null,
    [property: JsonPropertyName("serverNow")] string? ServerNow = null,
    [property: JsonPropertyName("prep")] PrepDto? Prep = null,
    [property: JsonPropertyName("paymentVerifiedAt")] string? PaymentVerifiedAt = null,
    [property: JsonPropertyName("readyAt")] string? ReadyAt = null
);

public record AcceptOrderRequest(
    [property: JsonPropertyName("prepMinutes")] int? PrepMinutes,
    [property: JsonPropertyName("expectedStatus")] string ExpectedStatus
);

public record RejectOrderRequest(
    [property: JsonPropertyName("reason")] string Reason,
    [property: JsonPropertyName("expectedStatus")] string ExpectedStatus
);

public record PreparingOrderRequest(
    [property: JsonPropertyName("prepMinutes")] int? PrepMinutes,
    [property: JsonPropertyName("expectedStatus")] string ExpectedStatus
);

public record SetPrepTimeRequest(
    [property: JsonPropertyName("minutes")] int? Minutes,
    [property: JsonPropertyName("expectedStatus")] string ExpectedStatus
);

public record ReadyOrderRequest(
    [property: JsonPropertyName("delivery")] string? Delivery,
    [property: JsonPropertyName("expectedStatus")] string ExpectedStatus
);

public record DeliveredSelfRequest(
    [property: JsonPropertyName("expectedStatus")] string ExpectedStatus
);

public record VerifyPaymentRequest(
    [property: JsonPropertyName("confirmReceived")] bool ConfirmReceived,
    [property: JsonPropertyName("expectedStatus")] string ExpectedStatus
);

public record CancelOrderRequest(
    [property: JsonPropertyName("reason")] string Reason,
    [property: JsonPropertyName("expectedStatus")] string ExpectedStatus
);

public record ApproveRefundRequest(
    [property: JsonPropertyName("expectedStatus")] string ExpectedStatus
);

public record RejectRefundRequest(
    [property: JsonPropertyName("rejectReason")] string RejectReason,
    [property: JsonPropertyName("expectedStatus")] string ExpectedStatus
);
