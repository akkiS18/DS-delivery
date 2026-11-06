using System.Text.Json.Serialization;

namespace DsRestaurant.Core.Api.Dtos;

public record WorkingDayDto(
    [property: JsonPropertyName("dayOfWeek")] int DayOfWeek,
    [property: JsonPropertyName("isOpen")] bool IsOpen,
    [property: JsonPropertyName("openTime")] string OpenTime,
    [property: JsonPropertyName("closeTime")] string CloseTime
);

public record OperationsResponseDto(
    [property: JsonPropertyName("isPaused")] bool? IsPaused = null,
    [property: JsonPropertyName("defaultPrepMinutes")] int? DefaultPrepMinutes = null,
    [property: JsonPropertyName("workingDays")] List<WorkingDayDto>? WorkingDays = null,
    [property: JsonPropertyName("workingHoursSet")] bool? WorkingHoursSet = null
);

public record UpdateStatusRequestDto(
    [property: JsonPropertyName("isPaused")] bool IsPaused
);

public record UpdatePrepTimeRequestDto(
    [property: JsonPropertyName("defaultPrepMinutes")] int DefaultPrepMinutes
);

public record UpdateWorkingHoursRequestDto(
    [property: JsonPropertyName("days")] List<WorkingDayDto> Days
);
