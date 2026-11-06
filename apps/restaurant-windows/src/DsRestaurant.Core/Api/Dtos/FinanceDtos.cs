using System.Text.Json.Serialization;

namespace DsRestaurant.Core.Api.Dtos;

public record FinanceStateResponse(
    [property: JsonPropertyName("hasPin")] bool HasPin,
    [property: JsonPropertyName("unlocked")] bool Unlocked,
    [property: JsonPropertyName("unlockedUntil")] string? UnlockedUntil = null
);

public record FinanceUnlockRequest(
    [property: JsonPropertyName("pin")] string Pin
);

public record FinanceUnlockResponse(
    [property: JsonPropertyName("unlocked")] bool Unlocked,
    [property: JsonPropertyName("unlockedUntil")] string? UnlockedUntil = null
);

public record FinanceSourceBlockDto(
    [property: JsonPropertyName("orders")] int Orders = 0,
    [property: JsonPropertyName("collectedSom")] long CollectedSom = 0,
    [property: JsonPropertyName("platformFeeSom")] long PlatformFeeSom = 0,
    [property: JsonPropertyName("refundsSom")] long RefundsSom = 0,
    [property: JsonPropertyName("restaurantEarnedSom")] long RestaurantEarnedSom = 0,
    [property: JsonPropertyName("feeSettledSom")] long FeeSettledSom = 0,
    [property: JsonPropertyName("feeRemainingSom")] long FeeRemainingSom = 0,
    [property: JsonPropertyName("paidOutSom")] long PaidOutSom = 0,
    [property: JsonPropertyName("remainingSom")] long RemainingSom = 0,
    [property: JsonPropertyName("inProgressOrders")] int InProgressOrders = 0,
    [property: JsonPropertyName("inProgressSom")] long InProgressSom = 0
);

public record FinanceOpenRefundsDto(
    [property: JsonPropertyName("count")] int Count = 0,
    [property: JsonPropertyName("amountSom")] long AmountSom = 0
);

public record FinanceOverviewResponse(
    [property: JsonPropertyName("collectsToPlatform")] bool? CollectsToPlatform = null,
    [property: JsonPropertyName("platformCard")] FinanceSourceBlockDto? PlatformCard = null,
    [property: JsonPropertyName("ownCard")] FinanceSourceBlockDto? OwnCard = null,
    [property: JsonPropertyName("cash")] FinanceSourceBlockDto? Cash = null,
    [property: JsonPropertyName("openRefunds")] FinanceOpenRefundsDto? OpenRefunds = null
);

public record FinanceTotalsDto(
    [property: JsonPropertyName("orders")] int Orders = 0,
    [property: JsonPropertyName("collectedSom")] long CollectedSom = 0,
    [property: JsonPropertyName("platformFeeSom")] long PlatformFeeSom = 0,
    [property: JsonPropertyName("refundsSom")] long RefundsSom = 0,
    [property: JsonPropertyName("restaurantEarnedSom")] long RestaurantEarnedSom = 0,
    [property: JsonPropertyName("paidOutSom")] long PaidOutSom = 0
);

public record FinanceLedgerItemDto(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("at")] string At,
    [property: JsonPropertyName("kind")] string Kind, // INCOME | PAYOUT
    [property: JsonPropertyName("orderCode")] string? OrderCode = null,
    [property: JsonPropertyName("source")] string? Source = null, // platform | own | cash
    [property: JsonPropertyName("collectedSom")] long? CollectedSom = null,
    [property: JsonPropertyName("platformFeeSom")] long? PlatformFeeSom = null,
    [property: JsonPropertyName("refundsSom")] long? RefundsSom = null,
    [property: JsonPropertyName("restaurantShareSom")] long? RestaurantShareSom = null,
    [property: JsonPropertyName("amountSom")] long? AmountSom = null
);

public record FinanceLedgerResponse(
    [property: JsonPropertyName("totals")] FinanceTotalsDto? Totals = null,
    [property: JsonPropertyName("items")] List<FinanceLedgerItemDto>? Items = null,
    [property: JsonPropertyName("nextCursor")] string? NextCursor = null
);
