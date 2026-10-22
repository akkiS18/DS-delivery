import { ApiError } from './api';
import type { CheckoutIssue, QuoteLine } from './types';
import { opensText, som } from './format';

export type ErrorKind = 'PRICE' | 'CLOSED' | 'UNAVAILABLE' | 'PHONE' | 'NETWORK' | 'AUTH' | 'LIMIT' | 'NO_TAXI' | 'VALIDATION' | 'OTHER';
export interface Described {
  kind: ErrorKind;
  message: string;
  retryable: boolean;
  currentLines?: QuoteLine[];
  currentTotalSom?: number;
  unavailableIds?: string[];
}

/** One place that turns every backend refusal into a customer message and the action the screen should take. */
export function describeCheckoutError(e: unknown): Described {
  if (!(e instanceof ApiError)) return { kind: 'OTHER', message: 'Kutilmagan xatolik. Qayta urinib ko‘ring.', retryable: true };
  const d = (e.details ?? {}) as { currentLines?: QuoteLine[]; currentTotalSom?: number; issues?: CheckoutIssue[] };
  switch (e.code) {
    case 'NARX_OZGARGAN':
      return {
        kind: 'PRICE', retryable: true,
        message: `Narxlar o‘zgargan. Yangi jami: ${d.currentTotalSom !== undefined ? som(d.currentTotalSom) : 'savatni ko‘ring'}. Buyurtma yaratilmadi va pul olinmadi.`,
        ...(d.currentLines ? { currentLines: d.currentLines } : {}),
        ...(d.currentTotalSom !== undefined ? { currentTotalSom: d.currentTotalSom } : {}),
      };
    case 'MAHSULOT_MAVJUD_EMAS':
      return {
        kind: 'UNAVAILABLE', retryable: false, message: 'Savatdagi mahsulotlardan biri hozir mavjud emas. Savatni yangilang.',
        unavailableIds: (d.issues ?? []).flatMap(i => (i.kind === 'PRODUCT_UNAVAILABLE' ? [i.productId] : [])),
      };
    case 'RESTORAN_BUYURTMA_QABUL_QILMAYDI':
      return { kind: 'CLOSED', retryable: false, message: 'Restoran hozir buyurtma qabul qilmayapti (pauza). Birozdan keyin urinib ko‘ring.' };
    case 'RESTORAN_YOPIQ': {
      const next = (d.issues ?? []).flatMap(i => (i.kind === 'RESTAURANT_CLOSED' ? [i.opensNext] : []))[0] ?? null;
      return { kind: 'CLOSED', retryable: false, message: `Restoran hozir yopiq. ${opensText(next)}.` };
    }
    case 'TAKSI_XIZMATI_MAVJUD_EMAS':
      return { kind: 'NO_TAXI', retryable: true, message: 'Hozir yetkazib berish uchun taksi xizmati mavjud emas. Birozdan keyin urinib ko‘ring; pul olinmadi.' };
    case 'RESTORAN_OLIB_KETISH_MANZILI_YOQ':
      return { kind: 'CLOSED', retryable: false, message: 'Restoran hozircha buyurtma qabul qila olmaydi. Keyinroq urinib ko‘ring.' };
    case 'KOP_TOLANMAGAN_BUYURTMA':
      return { kind: 'LIMIT', retryable: false, message: 'To‘lanmagan buyurtmangiz bor. Avval uni to‘lang yoki bekor qiling, keyin yangisini bering.' };
    case 'PHONE_REQUIRED':
      return { kind: 'PHONE', retryable: false, message: 'Telefon raqamini kiriting.' };
    case 'BUYURTMA_SUMMASI_JUDA_KATTA':
      return { kind: 'VALIDATION', retryable: false, message: 'Buyurtma summasi juda katta. Savatni kamaytiring.' };
    case 'ADDRESS_NOT_FOUND':
      return { kind: 'VALIDATION', retryable: false, message: 'Saqlangan manzil topilmadi. Manzilni qayta tanlang.' };
    case 'Validation failed':
      return { kind: 'VALIDATION', retryable: false, message: 'Kiritilgan ma’lumotlarni tekshiring (telefon yoki manzil noto‘g‘ri).' };
    case 'TOO_MANY_REQUESTS':
      return { kind: 'LIMIT', retryable: true, message: `Juda ko‘p urinish. ${e.retryAfterSeconds ? `${e.retryAfterSeconds} soniyadan keyin` : 'Birozdan keyin'} qayta urinib ko‘ring.` };
    case 'UNAUTHENTICATED':
    case 'NO_TELEGRAM':
      return { kind: 'AUTH', retryable: false, message: 'Seans tugagan. Ilovani Telegram ichidan qayta oching.' };
    case 'NETWORK':
      return { kind: 'NETWORK', retryable: true, message: 'Internet aloqasi yo‘q yoki server javob bermadi. Buyurtma yaratilgan bo‘lishi mumkin — qayta urinsangiz takroriy buyurtma bo‘lmaydi.' };
    default:
      return { kind: 'OTHER', retryable: e.status >= 500, message: e.status >= 500 ? 'Serverda xatolik. Birozdan keyin qayta urinib ko‘ring.' : 'Amalni bajarib bo‘lmadi.' };
  }
}
