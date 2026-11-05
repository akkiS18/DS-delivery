import { T } from '../i18n';
import { ApiError } from './apiError';

/** Screen text (Uzbek key, translated by t()) for a failed "delete my account" call. 409 codes mean something is still in motion. */
export function deletionErrorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'OPEN_ORDER') return T('Tugallanmagan buyurtmangiz bor. U yetkazilgach yoki bekor qilingach, hisobni o‘chirishingiz mumkin.');
    if (e.code === 'OPEN_RESERVATION') return T('Tugallanmagan stol broningiz bor. U o‘tgach yoki bekor qilingach, hisobni o‘chirishingiz mumkin.');
    if (e.code === 'OPEN_REFUND') return T('Pulni qaytarish so‘rovi hali yopilmagan. U tugagach, hisobni o‘chirishingiz mumkin.');
    if (e.status === 429) return T('Juda ko‘p urinish. Birozdan keyin qayta urinib ko‘ring.');
  }
  return T('Hisobni o‘chirib bo‘lmadi. Internetni tekshirib, qayta urinib ko‘ring.');
}
