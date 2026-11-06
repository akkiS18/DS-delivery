using System.Text.Json.Serialization;

namespace DsRestaurant.Core.Api.Dtos;

public record CardDto(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("last4")] string Last4,
    [property: JsonPropertyName("masked")] string? Masked = null,
    [property: JsonPropertyName("status")] string? Status = null
);

public record CardsResponseDto(
    [property: JsonPropertyName("cards")] List<CardDto>? Cards = null
);

public record CardResponseDto(
    [property: JsonPropertyName("card")] CardDto? Card = null
);

public record AddCardRequestDto(
    [property: JsonPropertyName("number")] string Number,
    [property: JsonPropertyName("holderName")] string HolderName
);
