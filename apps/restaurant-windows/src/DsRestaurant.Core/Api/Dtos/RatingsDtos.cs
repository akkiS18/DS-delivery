using System.Text.Json.Serialization;

namespace DsRestaurant.Core.Api.Dtos;

public record RatingPeriodDto(
    [property: JsonPropertyName("count")] int? Count = null,
    [property: JsonPropertyName("avg")] double? Avg = null
);

public record RecentRatingDto(
    [property: JsonPropertyName("stars")] int? Stars = null,
    [property: JsonPropertyName("reasons")] List<string>? Reasons = null,
    [property: JsonPropertyName("note")] string? Note = null,
    [property: JsonPropertyName("at")] string? At = null
);

public record RatingsReportDto(
    [property: JsonPropertyName("count")] int? Count = null,
    [property: JsonPropertyName("avg")] double? Avg = null,
    [property: JsonPropertyName("last30")] RatingPeriodDto? Last30 = null,
    [property: JsonPropertyName("stars")] Dictionary<string, int>? Stars = null,
    [property: JsonPropertyName("reasons")] Dictionary<string, int>? Reasons = null,
    [property: JsonPropertyName("reasonLabels")] Dictionary<string, string>? ReasonLabels = null,
    [property: JsonPropertyName("recent")] List<RecentRatingDto>? Recent = null
);
