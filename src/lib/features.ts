/**
 * Stage 6E: restaurants work in the Android app. The legacy Telegram staff panel (order notices, /staff, staff buttons,
 * payment verification, price proposals, refund handling) is kept in the code for rollback but is OFF unless this is
 * explicitly "true". Customer, taxi-operator and support Telegram features never depend on it.
 */
export const restaurantTelegramEnabled = (env: NodeJS.ProcessEnv = process.env): boolean =>
  env.RESTAURANT_TELEGRAM_ENABLED?.trim().toLowerCase() === 'true';

export const RESTAURANT_TELEGRAM_DISABLED_MESSAGE =
  'ℹ️ Restoran boshqaruvi endi DS Restoran ilovasida (Android). Telegram orqali restoran amallari o‘chirilgan; hech narsa o‘zgartirilmadi.';

/**
 * Taxi operators work in the DS Taxi Android app. The Telegram taxi panel (/taxi, taxi:* buttons, request messages to operators) stays in the code
 * for rollback and is ON unless this is explicitly "false". Customer, restaurant and administrator Telegram features never depend on it.
 */
export const taxiTelegramEnabled = (env: NodeJS.ProcessEnv = process.env): boolean =>
  env.TAXI_TELEGRAM_ENABLED?.trim().toLowerCase() !== 'false';

export const TAXI_TELEGRAM_DISABLED_MESSAGE =
  'ℹ️ Taksi operatorlari endi DS Taxi ilovasida (Android) ishlaydi. Telegram orqali taksi amallari o‘chirilgan; hech narsa o‘zgartirilmadi.';
