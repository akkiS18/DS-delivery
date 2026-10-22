export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, readonly details?: unknown, readonly retryAfterSeconds?: number) { super(code); }
}
