namespace DsRestaurant.Core.Common;

public class Result
{
    public bool IsSuccess { get; }
    public string? ErrorMessage { get; }
    public string? ErrorCode { get; }
    public int? StatusCode { get; }
    public int? RetryAfterSeconds { get; }
    public int? AttemptsLeft { get; }

    protected Result(bool isSuccess, string? errorMessage = null, string? errorCode = null, int? statusCode = null, int? retryAfterSeconds = null, int? attemptsLeft = null)
    {
        IsSuccess = isSuccess;
        ErrorMessage = errorMessage;
        ErrorCode = errorCode;
        StatusCode = statusCode;
        RetryAfterSeconds = retryAfterSeconds;
        AttemptsLeft = attemptsLeft;
    }

    public static Result Ok() => new(true);
    public static Result Fail(string message, string? code = null, int? statusCode = null, int? retryAfterSeconds = null, int? attemptsLeft = null) =>
        new(false, message, code, statusCode, retryAfterSeconds, attemptsLeft);
}

public class Result<T> : Result
{
    public T? Value { get; }

    private Result(bool isSuccess, T? value, string? errorMessage = null, string? errorCode = null, int? statusCode = null, int? retryAfterSeconds = null, int? attemptsLeft = null)
        : base(isSuccess, errorMessage, errorCode, statusCode, retryAfterSeconds, attemptsLeft)
    {
        Value = value;
    }

    public static Result<T> Ok(T value) => new(true, value);
    public new static Result<T> Fail(string message, string? code = null, int? statusCode = null, int? retryAfterSeconds = null, int? attemptsLeft = null) =>
        new(false, default, message, code, statusCode, retryAfterSeconds, attemptsLeft);
}
