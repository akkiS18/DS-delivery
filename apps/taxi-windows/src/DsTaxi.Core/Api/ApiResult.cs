namespace DsTaxi.Core.Api;

public enum ApiStatus
{
    Ok,
    /// <summary>The session is gone (password changed, signed out elsewhere, expired): sign in again.</summary>
    Unauthorized,
    /// <summary>Too many attempts (HTTP 429); see <see cref="ApiResult{T}.RetryAfterSeconds"/>.</summary>
    Locked,
    /// <summary>The server answered with an error; <see cref="ApiResult{T}.Message"/> is already Uzbek when the server supplied one.</summary>
    Failed,
    /// <summary>No connection / timeout.</summary>
    Offline,
}

/// <summary>The outcome of one server call. Never carries the password; bodies are never logged.</summary>
public sealed class ApiResult<T>
{
    public ApiStatus Status { get; private init; }
    public T? Data { get; private init; }
    public int HttpStatus { get; private init; }
    public string? Error { get; private init; }
    public string? Message { get; private init; }
    public int RetryAfterSeconds { get; private init; }

    public bool IsOk => Status == ApiStatus.Ok;

    public static ApiResult<T> Ok(T data) => new() { Status = ApiStatus.Ok, Data = data, HttpStatus = 200 };
    public static ApiResult<T> Unauthorized() => new() { Status = ApiStatus.Unauthorized, HttpStatus = 401 };
    public static ApiResult<T> Locked(int retryAfterSeconds) => new() { Status = ApiStatus.Locked, HttpStatus = 429, RetryAfterSeconds = retryAfterSeconds };
    public static ApiResult<T> Failed(int httpStatus, string? error, string? message) => new() { Status = ApiStatus.Failed, HttpStatus = httpStatus, Error = error, Message = message };
    public static ApiResult<T> Offline() => new() { Status = ApiStatus.Offline };
}
