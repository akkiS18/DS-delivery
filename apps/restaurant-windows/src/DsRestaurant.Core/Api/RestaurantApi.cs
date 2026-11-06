using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using DsRestaurant.Core.Api.Dtos;
using DsRestaurant.Core.Common;

namespace DsRestaurant.Core.Api;

public class RestaurantApi
{
    private readonly HttpClient _httpClient;
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    public string BaseUrl { get; private set; }
    public string? AccessToken { get; set; }

    public event Action? OnSessionExpired;

    public RestaurantApi(HttpClient httpClient, string baseUrl = ApiConfig.DefaultBaseUrl)
    {
        _httpClient = httpClient;
        BaseUrl = ApiConfig.NormalizeUrl(baseUrl);
    }

    public void UpdateBaseUrl(string newBaseUrl)
    {
        BaseUrl = ApiConfig.NormalizeUrl(newBaseUrl);
    }

    private HttpRequestMessage CreateRequest(HttpMethod method, string relativePath, object? body = null)
    {
        var cleanRelative = relativePath.TrimStart('/');
        var url = $"{BaseUrl}api/v1/restaurant/{cleanRelative}";
        var request = new HttpRequestMessage(method, url);
        request.Headers.UserAgent.Clear();
        request.Headers.UserAgent.Add(new ProductInfoHeaderValue("DsRestaurant", "1.0.0"));

        if (!string.IsNullOrEmpty(AccessToken))
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", AccessToken);
        }

        if (body != null)
        {
            var json = JsonSerializer.Serialize(body, JsonOptions);
            request.Content = new StringContent(json, Encoding.UTF8, "application/json");
        }

        return request;
    }

    private async Task<Result<T>> SendAsync<T>(HttpRequestMessage request, bool isAuthOrUnlock = false, CancellationToken ct = default)
    {
        try
        {
            using var response = await _httpClient.SendAsync(request, ct);
            var content = await response.Content.ReadAsStringAsync(ct);

            if (response.IsSuccessStatusCode)
            {
                if (typeof(T) == typeof(bool))
                {
                    return Result<T>.Ok((T)(object)true);
                }

                var data = JsonSerializer.Deserialize<T>(content, JsonOptions);
                return Result<T>.Ok(data!);
            }

            // Extract error code if present
            string? errorCode = null;
            int? retryAfter = null;
            int? attemptsLeft = null;
            try
            {
                if (!string.IsNullOrWhiteSpace(content))
                {
                    var node = JsonNode.Parse(content);
                    errorCode = node?["code"]?.GetValue<string>() ?? node?["error"]?.GetValue<string>() ?? node?["message"]?.GetValue<string>();
                    retryAfter = node?["retryAfterSeconds"]?.GetValue<int?>();
                    attemptsLeft = node?["attemptsLeft"]?.GetValue<int?>();
                }
            }
            catch
            {
                // Ignore parse failures on non-json errors
            }

            int statusCode = (int)response.StatusCode;

            // 401 on non-login/non-unlock calls means session expired
            if (statusCode == 401 && !isAuthOrUnlock)
            {
                OnSessionExpired?.Invoke();
            }

            var uzbekMessage = ApiError.MapToUzbek(statusCode, errorCode);
            return Result<T>.Fail(uzbekMessage, errorCode, statusCode, retryAfter, attemptsLeft);
        }
        catch (Exception ex)
        {
            return Result<T>.Fail(ApiError.MapExceptionToUzbek(ex), "NETWORK_ERROR");
        }
    }

    private async Task<Result> SendAsync(HttpRequestMessage request, bool isAuthOrUnlock = false, CancellationToken ct = default)
    {
        var res = await SendAsync<bool>(request, isAuthOrUnlock, ct);
        return res.IsSuccess
            ? Result.Ok()
            : Result.Fail(res.ErrorMessage ?? "Xatolik", res.ErrorCode, res.StatusCode, res.RetryAfterSeconds, res.AttemptsLeft);
    }

    // --- Auth Endpoints ---

    public async Task<Result<LoginResponse>> LoginAsync(string slug, string password, CancellationToken ct = default)
    {
        var request = CreateRequest(HttpMethod.Post, "auth/login", new LoginRequest(slug, password));
        var result = await SendAsync<LoginResponse>(request, isAuthOrUnlock: true, ct);
        if (result.IsSuccess && result.Value != null)
        {
            AccessToken = result.Value.AccessToken;
        }
        return result;
    }

    public Task<Result<MeResponse>> GetMeAsync(CancellationToken ct = default)
    {
        var request = CreateRequest(HttpMethod.Get, "auth/me");
        return SendAsync<MeResponse>(request, ct: ct);
    }

    public async Task<Result> LogoutAsync(CancellationToken ct = default)
    {
        var request = CreateRequest(HttpMethod.Post, "auth/logout");
        var result = await SendAsync(request, ct: ct);
        AccessToken = null;
        return result;
    }

    // --- Orders Endpoints ---

    public Task<Result<OrdersResponse>> GetOrdersAsync(string filter = "all", int limit = 20, string? cursor = null, CancellationToken ct = default)
    {
        var sb = new StringBuilder($"orders?filter={Uri.EscapeDataString(filter)}&limit={limit}");
        if (!string.IsNullOrEmpty(cursor))
        {
            sb.Append($"&cursor={Uri.EscapeDataString(cursor)}");
        }
        var request = CreateRequest(HttpMethod.Get, sb.ToString());
        return SendAsync<OrdersResponse>(request, ct: ct);
    }

    public Task<Result<OrderDto>> GetOrderByIdAsync(string id, CancellationToken ct = default)
    {
        var request = CreateRequest(HttpMethod.Get, $"orders/{Uri.EscapeDataString(id)}");
        return SendAsync<OrderDto>(request, ct: ct);
    }

    public Task<Result> AcceptOrderAsync(string id, int? prepMinutes, string expectedStatus, CancellationToken ct = default)
    {
        var request = CreateRequest(HttpMethod.Post, $"orders/{Uri.EscapeDataString(id)}/accept", new AcceptOrderRequest(prepMinutes, expectedStatus));
        return SendAsync(request, ct: ct);
    }

    public Task<Result> RejectOrderAsync(string id, string reason, string expectedStatus, CancellationToken ct = default)
    {
        var request = CreateRequest(HttpMethod.Post, $"orders/{Uri.EscapeDataString(id)}/reject", new RejectOrderRequest(reason, expectedStatus));
        return SendAsync(request, ct: ct);
    }

    public Task<Result> SetOrderPreparingAsync(string id, int? prepMinutes, string expectedStatus, CancellationToken ct = default)
    {
        var request = CreateRequest(HttpMethod.Post, $"orders/{Uri.EscapeDataString(id)}/preparing", new PreparingOrderRequest(prepMinutes, expectedStatus));
        return SendAsync(request, ct: ct);
    }

    public Task<Result> SetPrepTimeAsync(string id, int? minutes, string expectedStatus, CancellationToken ct = default)
    {
        var request = CreateRequest(HttpMethod.Post, $"orders/{Uri.EscapeDataString(id)}/prep-time", new SetPrepTimeRequest(minutes, expectedStatus));
        return SendAsync(request, ct: ct);
    }

    public Task<Result> SetOrderReadyAsync(string id, string? delivery, string expectedStatus, CancellationToken ct = default)
    {
        var request = CreateRequest(HttpMethod.Post, $"orders/{Uri.EscapeDataString(id)}/ready", new ReadyOrderRequest(delivery, expectedStatus));
        return SendAsync(request, ct: ct);
    }

    public Task<Result> SetSelfDeliveredAsync(string id, string expectedStatus, CancellationToken ct = default)
    {
        var request = CreateRequest(HttpMethod.Post, $"orders/{Uri.EscapeDataString(id)}/delivered-self", new DeliveredSelfRequest(expectedStatus));
        return SendAsync(request, ct: ct);
    }

    public Task<Result> VerifyPaymentAsync(string id, bool confirmReceived, string expectedStatus, CancellationToken ct = default)
    {
        var request = CreateRequest(HttpMethod.Post, $"orders/{Uri.EscapeDataString(id)}/verify-payment", new VerifyPaymentRequest(confirmReceived, expectedStatus));
        return SendAsync(request, ct: ct);
    }

    public Task<Result> CancelOrderAsync(string id, string reason, string expectedStatus, CancellationToken ct = default)
    {
        var request = CreateRequest(HttpMethod.Post, $"orders/{Uri.EscapeDataString(id)}/cancel", new CancelOrderRequest(reason, expectedStatus));
        return SendAsync(request, ct: ct);
    }

    public Task<Result> ApproveRefundAsync(string id, string expectedStatus, CancellationToken ct = default)
    {
        var request = CreateRequest(HttpMethod.Post, $"orders/{Uri.EscapeDataString(id)}/refund/approve", new ApproveRefundRequest(expectedStatus));
        return SendAsync(request, ct: ct);
    }

    public Task<Result> RejectRefundAsync(string id, string rejectReason, string expectedStatus, CancellationToken ct = default)
    {
        var request = CreateRequest(HttpMethod.Post, $"orders/{Uri.EscapeDataString(id)}/refund/reject", new RejectRefundRequest(rejectReason, expectedStatus));
        return SendAsync(request, ct: ct);
    }

    // --- Finance Endpoints ---

    public Task<Result<FinanceStateResponse>> GetFinanceStateAsync(CancellationToken ct = default)
    {
        var request = CreateRequest(HttpMethod.Get, "finance/state");
        return SendAsync<FinanceStateResponse>(request, ct: ct);
    }

    public Task<Result<FinanceUnlockResponse>> UnlockFinanceAsync(string pin, CancellationToken ct = default)
    {
        var request = CreateRequest(HttpMethod.Post, "finance/unlock", new FinanceUnlockRequest(pin));
        return SendAsync<FinanceUnlockResponse>(request, isAuthOrUnlock: true, ct: ct);
    }

    public Task<Result> LockFinanceAsync(CancellationToken ct = default)
    {
        var request = CreateRequest(HttpMethod.Post, "finance/lock");
        return SendAsync(request, ct: ct);
    }

    public Task<Result<FinanceOverviewResponse>> GetFinanceOverviewAsync(CancellationToken ct = default)
    {
        var request = CreateRequest(HttpMethod.Get, "finance/overview");
        return SendAsync<FinanceOverviewResponse>(request, ct: ct);
    }

    public Task<Result<FinanceLedgerResponse>> GetFinanceLedgerAsync(string filter = "all", string? from = null, string? to = null, string? cursor = null, int limit = 20, CancellationToken ct = default)
    {
        var sb = new StringBuilder($"finance/ledger?filter={Uri.EscapeDataString(filter)}&limit={limit}");
        if (!string.IsNullOrEmpty(from)) sb.Append($"&from={Uri.EscapeDataString(from)}");
        if (!string.IsNullOrEmpty(to)) sb.Append($"&to={Uri.EscapeDataString(to)}");
        if (!string.IsNullOrEmpty(cursor)) sb.Append($"&cursor={Uri.EscapeDataString(cursor)}");

        var request = CreateRequest(HttpMethod.Get, sb.ToString());
        return SendAsync<FinanceLedgerResponse>(request, ct: ct);
    }

    // --- Phase 2: Operations Endpoints ---

    public Task<Result<OperationsResponseDto>> GetOperationsAsync(CancellationToken ct = default)
    {
        var request = CreateRequest(HttpMethod.Get, "operations");
        return SendAsync<OperationsResponseDto>(request, ct: ct);
    }

    public Task<Result<OperationsResponseDto>> UpdateOperationsStatusAsync(bool isPaused, CancellationToken ct = default)
    {
        var request = CreateRequest(HttpMethod.Patch, "operations/status", new UpdateStatusRequestDto(isPaused));
        return SendAsync<OperationsResponseDto>(request, ct: ct);
    }

    public Task<Result<OperationsResponseDto>> UpdateWorkingHoursAsync(List<WorkingDayDto> days, CancellationToken ct = default)
    {
        var request = CreateRequest(HttpMethod.Put, "operations/working-hours", new UpdateWorkingHoursRequestDto(days));
        return SendAsync<OperationsResponseDto>(request, ct: ct);
    }

    public Task<Result<OperationsResponseDto>> UpdatePrepTimeAsync(int defaultPrepMinutes, CancellationToken ct = default)
    {
        var request = CreateRequest(HttpMethod.Patch, "operations/prep-time", new UpdatePrepTimeRequestDto(defaultPrepMinutes));
        return SendAsync<OperationsResponseDto>(request, ct: ct);
    }

    // --- Phase 2: Categories Endpoints ---

    public Task<Result<CategoriesResponseDto>> GetCategoriesAsync(CancellationToken ct = default)
    {
        var request = CreateRequest(HttpMethod.Get, "categories");
        return SendAsync<CategoriesResponseDto>(request, ct: ct);
    }

    public Task<Result<CategoryDto>> CreateCategoryAsync(string name, int? position = null, CancellationToken ct = default)
    {
        var request = CreateRequest(HttpMethod.Post, "categories", new CreateCategoryRequestDto(name, position));
        return SendAsync<CategoryDto>(request, ct: ct);
    }

    public Task<Result<CategoryDto>> UpdateCategoryAsync(string id, string name, int position, int version, CancellationToken ct = default)
    {
        var request = CreateRequest(HttpMethod.Put, $"categories/{Uri.EscapeDataString(id)}", new UpdateCategoryRequestDto(name, position, version));
        return SendAsync<CategoryDto>(request, ct: ct);
    }

    public Task<Result> DeleteCategoryAsync(string id, string? reassignTo = null, CancellationToken ct = default)
    {
        var path = $"categories/{Uri.EscapeDataString(id)}";
        if (!string.IsNullOrEmpty(reassignTo)) path += $"?reassignTo={Uri.EscapeDataString(reassignTo)}";
        var request = CreateRequest(HttpMethod.Delete, path);
        return SendAsync(request, ct: ct);
    }

    // --- Phase 2: Products Endpoints ---

    public Task<Result<ProductsResponseDto>> GetProductsAsync(bool includeArchived = true, CancellationToken ct = default)
    {
        var path = includeArchived ? "products?includeArchived=true" : "products";
        var request = CreateRequest(HttpMethod.Get, path);
        return SendAsync<ProductsResponseDto>(request, ct: ct);
    }

    public Task<Result<ProductDto>> CreateProductAsync(CreateProductRequestDto req, CancellationToken ct = default)
    {
        var request = CreateRequest(HttpMethod.Post, "products", req);
        return SendAsync<ProductDto>(request, ct: ct);
    }

    public Task<Result<ProductDto>> UpdateProductAsync(string id, UpdateProductRequestDto req, CancellationToken ct = default)
    {
        var request = CreateRequest(HttpMethod.Put, $"products/{Uri.EscapeDataString(id)}", req);
        return SendAsync<ProductDto>(request, ct: ct);
    }

    public Task<Result<ProductDto>> UpdateProductAvailabilityAsync(string id, bool isAvailable, int? version = null, CancellationToken ct = default)
    {
        var request = CreateRequest(HttpMethod.Patch, $"products/{Uri.EscapeDataString(id)}/availability", new UpdateAvailabilityRequestDto(isAvailable, version));
        return SendAsync<ProductDto>(request, ct: ct);
    }

    public Task<Result> DeleteProductAsync(string id, CancellationToken ct = default)
    {
        var request = CreateRequest(HttpMethod.Delete, $"products/{Uri.EscapeDataString(id)}");
        return SendAsync(request, ct: ct);
    }

    public async Task<Result<ProductImageResponseDto>> UploadProductImageAsync(string id, byte[] jpegBytes, CancellationToken ct = default)
    {
        try
        {
            var url = $"{BaseUrl}api/v1/restaurant/products/{Uri.EscapeDataString(id)}/image";
            var request = new HttpRequestMessage(HttpMethod.Put, url);
            request.Headers.UserAgent.Add(new ProductInfoHeaderValue("DsRestaurant", "1.0.0"));
            if (!string.IsNullOrEmpty(AccessToken))
            {
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", AccessToken);
            }
            request.Content = new ByteArrayContent(jpegBytes);
            request.Content.Headers.ContentType = new MediaTypeHeaderValue("image/jpeg");

            using var response = await _httpClient.SendAsync(request, ct);
            var content = await response.Content.ReadAsStringAsync(ct);
            if (response.IsSuccessStatusCode)
            {
                var data = JsonSerializer.Deserialize<ProductImageResponseDto>(content, JsonOptions);
                return Result<ProductImageResponseDto>.Ok(data!);
            }
            return Result<ProductImageResponseDto>.Fail(ApiError.MapToUzbek((int)response.StatusCode, "IMAGE_UPLOAD_FAILED"), null, (int)response.StatusCode);
        }
        catch (Exception ex)
        {
            return Result<ProductImageResponseDto>.Fail(ApiError.MapExceptionToUzbek(ex), "NETWORK_ERROR");
        }
    }

    public Task<Result> DeleteProductImageAsync(string id, CancellationToken ct = default)
    {
        var request = CreateRequest(HttpMethod.Delete, $"products/{Uri.EscapeDataString(id)}/image");
        return SendAsync(request, ct: ct);
    }

    // --- Phase 2: Payee Cards Endpoints ---

    public Task<Result<CardsResponseDto>> GetCardsAsync(CancellationToken ct = default)
    {
        var request = CreateRequest(HttpMethod.Get, "cards");
        return SendAsync<CardsResponseDto>(request, ct: ct);
    }

    public Task<Result<CardResponseDto>> AddCardAsync(string number, string holderName, CancellationToken ct = default)
    {
        var request = CreateRequest(HttpMethod.Post, "cards", new AddCardRequestDto(number, holderName));
        return SendAsync<CardResponseDto>(request, ct: ct);
    }

    public Task<Result<CardResponseDto>> DisableCardAsync(string id, CancellationToken ct = default)
    {
        var request = CreateRequest(HttpMethod.Post, $"cards/{Uri.EscapeDataString(id)}/disable", new object());
        return SendAsync<CardResponseDto>(request, ct: ct);
    }

    public Task<Result<CardResponseDto>> EnableCardAsync(string id, CancellationToken ct = default)
    {
        var request = CreateRequest(HttpMethod.Post, $"cards/{Uri.EscapeDataString(id)}/enable", new object());
        return SendAsync<CardResponseDto>(request, ct: ct);
    }

    // --- Phase 2: Reservations Endpoints ---

    public Task<Result<ReservationsReportDto>> GetReservationsAsync(CancellationToken ct = default)
    {
        var request = CreateRequest(HttpMethod.Get, "reservations");
        return SendAsync<ReservationsReportDto>(request, ct: ct);
    }

    public Task<Result> MarkReservationSeenAsync(string id, CancellationToken ct = default)
    {
        var request = CreateRequest(HttpMethod.Post, $"reservations/{Uri.EscapeDataString(id)}/seen");
        return SendAsync(request, ct: ct);
    }

    public Task<Result> ConfirmReservationPaymentAsync(string id, CancellationToken ct = default)
    {
        var request = CreateRequest(HttpMethod.Post, $"reservations/{Uri.EscapeDataString(id)}/confirm-payment", new object());
        return SendAsync(request, ct: ct);
    }

    public Task<Result> CancelReservationAsync(string id, string reason, CancellationToken ct = default)
    {
        var request = CreateRequest(HttpMethod.Post, $"reservations/{Uri.EscapeDataString(id)}/cancel", new ReservationCancelRequestDto(reason));
        return SendAsync(request, ct: ct);
    }

    public Task<Result> UpdateReservationSettingsAsync(bool enabled, int depositSom, CancellationToken ct = default)
    {
        var request = CreateRequest(HttpMethod.Put, "reservations/settings", new ReservationSettingsRequestDto(enabled, depositSom));
        return SendAsync(request, ct: ct);
    }

    // --- Phase 2: Ratings Endpoints ---

    public Task<Result<RatingsReportDto>> GetRatingsAsync(CancellationToken ct = default)
    {
        var request = CreateRequest(HttpMethod.Get, "ratings");
        return SendAsync<RatingsReportDto>(request, ct: ct);
    }
}
