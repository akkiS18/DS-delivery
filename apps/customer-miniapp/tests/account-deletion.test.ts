import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/lib/apiError';
import { deletionErrorText } from '../src/lib/accountDeletion';
import { RU } from '../src/i18n/ru';

describe('account deletion messages', () => {
  it('names the blocker for each 409 code', () => {
    expect(deletionErrorText(new ApiError(409, 'OPEN_ORDER'))).toContain('buyurtma');
    expect(deletionErrorText(new ApiError(409, 'OPEN_RESERVATION'))).toContain('bron');
    expect(deletionErrorText(new ApiError(409, 'OPEN_REFUND'))).toContain('qaytarish');
  });
  it('falls back to a generic line for network and unknown failures', () => {
    for (const e of [new ApiError(0, 'NETWORK'), new ApiError(500, 'HTTP_500'), new Error('x')]) expect(deletionErrorText(e)).toContain('o‘chirib bo‘lmadi');
    expect(deletionErrorText(new ApiError(429, 'TOO_MANY_REQUESTS'))).toContain('Juda ko‘p');
  });
  it('every possible message has a Russian line', () => {
    const codes = [new ApiError(409, 'OPEN_ORDER'), new ApiError(409, 'OPEN_RESERVATION'), new ApiError(409, 'OPEN_REFUND'), new ApiError(429, 'X'), new ApiError(0, 'NETWORK')];
    for (const e of codes) expect(RU[deletionErrorText(e)], deletionErrorText(e)).toBeTruthy();
  });
});
