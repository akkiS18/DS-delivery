/** Plain-language explanation of every REVIEW_REQUIRED reason code the payment engine can produce (pure, no database). */
export const REVIEW_REASON_TEXT: Record<string, string> = {
  FUTURE_OPERATION_TIME: 'Xatdagi vaqt kelajakda (soat yoki xat xato).',
  UNKNOWN_CARD: 'Karta tizimda ro‘yxatda yo‘q.',
  GMAIL_FOR_MOCK_CARD: 'Sinov kartasiga haqiqiy xat keldi.',
  MOCK_FOR_REAL_CARD: 'Sinov kirimi haqiqiy kartaga to‘g‘ri keldi.',
  UNVERIFIED_EMAIL_SENDER: 'Xat yuboruvchisi tasdiqlanmadi (soxta bo‘lishi mumkin).',
  POSSIBLE_DUPLICATE_NOTIFICATION: 'Xuddi shu kirim ikkinchi marta keldi (qayta yuborilgan xat).',
  DELAYED_NOTIFICATION: 'Xat bank amalidan 30 daqiqadan ortiq keyin keldi.',
  MULTIPLE_ACTIVE_PAYMENTS: 'Bir nechta ochiq to‘lov mos keldi (kutilmagan holat).',
  LATE_FOR_EXPIRED_PAYMENT: 'Pul to‘lov muddati tugagandan keyin keldi.',
  ALREADY_MATCHED_PAYMENT: 'Bu summa uchun to‘lov allaqachon topilgan (ikkinchi o‘tkazma).',
  AMOUNT_BELOW_EXPECTED: 'Summa kutilganidan KAM.',
  AMOUNT_ABOVE_EXPECTED: 'Summa kutilganidan KO‘P.',
  AMOUNT_MISMATCH_MULTIPLE_CANDIDATES: 'Summa hech bir ochiq to‘lovga mos kelmadi.',
  NO_ACTIVE_PAYMENT: 'Bu summa va karta uchun ochiq to‘lov yo‘q (begona pul bo‘lishi mumkin).',
  CARD_PAYMENT_SCOPE_MISMATCH: 'Karta va to‘lov turli restoran/rejimga tegishli.',
  PAYMENT_STATE_CHANGED: 'To‘lov holati xat kelishi bilan bir vaqtda o‘zgardi.',
  EMAIL_ARRIVED_BEFORE_PAYMENT: 'Xat to‘lov ochilishidan oldin kelgan.',
  OPERATION_OUTSIDE_WINDOW: 'Amal vaqti to‘lov oynasiga to‘g‘ri kelmadi.',
  PRIOR_SAME_CARD_AND_AMOUNT: 'Shu karta va summa yaqinda boshqa to‘lovga ham berilgan: kimniki ekani noaniq.',
};

export const explainReason = (code: string | null | undefined): string =>
  (code && REVIEW_REASON_TEXT[code]) || 'Sabab noma’lum, qo‘lda tekshiring.';

export const REVIEW_ACTIONS = ['NOT_OURS', 'REFUNDED', 'ORDER_RESOLVED', 'OTHER'] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];
export const REVIEW_ACTION_LABEL: Record<ReviewAction, string> = {
  NOT_OURS: 'Bizniki emas (begona pul)',
  REFUNDED: 'Pul to‘lovchiga qaytarildi',
  ORDER_RESOLVED: 'Buyurtma qo‘lda hal qilindi',
  OTHER: 'Boshqa',
};
