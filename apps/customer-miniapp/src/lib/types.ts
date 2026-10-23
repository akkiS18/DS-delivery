// Shapes returned by the DS backend (/api/v1/miniapp). Mirrors src/modules/miniapp/views.ts and profile.ts.

export interface OpensNext { dayOffset: number; dayOfWeek: number; time: string }

export interface Restaurant {
  id: string;
  slug: string;
  name: string;
  isOpen: boolean;
  closedReason: 'PAUSED' | 'HOURS' | null;
  opensNext: OpensNext | null;
  prepMinutes: number;
}

export interface Category { id: string; name: string }

export interface Product {
  id: string;
  name: string;
  description: string | null;
  priceSom: number;
  isAvailable: boolean;
  categoryId: string | null;
  imageUrl: string | null;
}

export interface MenuResponse { restaurant: Restaurant; categories: Category[]; products: Product[] }

export interface Address {
  id: string;
  label: string;
  addressText: string;
  lat: number | null;
  lng: number | null;
  isDefault: boolean;
  lastUsedAt: string | null;
}

export interface Profile {
  phone: string | null;
  displayName: string | null;
  /** False for an Android guest that has not linked a Telegram account. */
  telegramLinked: boolean;
  addresses: Address[];
  defaultAddressId: string | null;
  lastUsedAddressId: string | null;
}

export interface AppConfig { paymentMode: 'MOCK' | 'REAL'; mockPaymentAvailable: boolean; currency: string }

export interface QuoteLine { productId: string; name: string; unitSom: number; quantity: number; subtotalSom: number }
export type CheckoutIssue =
  | { kind: 'RESTAURANT_UNAVAILABLE' }
  | { kind: 'RESTAURANT_CLOSED'; opensNext: OpensNext | null }
  | { kind: 'PRODUCT_UNAVAILABLE'; productId: string }
  | { kind: 'PRICE_CHANGED'; productId: string; name: string; expectedUnitSom: number; currentUnitSom: number }
  | { kind: 'TOTAL_CHANGED'; expectedTotalSom: number; currentTotalSom: number }
  | { kind: 'TOTAL_TOO_LARGE' };
export type QuoteResponse =
  | { ok: true; lines: QuoteLine[]; totalSom: number; estimatedPrepMinutes: number }
  | { ok: false; issues: CheckoutIssue[]; lines: QuoteLine[]; totalSom: number };

export type CustomerStage =
  | 'PAYMENT_PENDING' | 'PAYMENT_CHECKING' | 'PREPARING' | 'READY' | 'TAXI_REQUESTED' | 'TAXI_ACCEPTED' | 'TAXI_SENT'
  | 'DELIVERED' | 'CANCELLATION_REQUESTED' | 'CANCELLED' | 'EXPIRED' | 'NEEDS_HELP';

export interface PaymentInstructions {
  cardLast4: string;
  isTest: boolean;
  /** The payee card number from operator configuration. null = not configured: the customer must NOT pay. */
  cardNumber: string | null;
  recipientUnavailable: boolean;
  /** The name on the card (null for older cards: the screen then shows the restaurant name). */
  cardHolder?: string | null;
  expiresAt: string | null;
}

export interface PrepClock {
  minutes: number;
  startedAt: string | null;
  estimatedReadyAt: string | null;
  readyAt: string | null;
  remainingSeconds: number | null;
  overdueMinutes: number;
  isOverdue: boolean;
}

export interface OrderView {
  serverNow: string;
  id: string;
  number: number;
  status: string;
  stage: CustomerStage;
  createdAt: string;
  restaurantName: string;
  items: Array<{ name: string; unitSom: number; quantity: number; subtotalSom: number }>;
  foodTotalSom: number;
  delivery: { feeSom: null; note: 'TAXI_TARIFF' };
  address: string;
  phone: string | null;
  isTest: boolean;
  payment: { status: string; amountSom: number; mode: 'MOCK' | 'REAL'; queued: boolean; instructions: PaymentInstructions | null } | null;
  prep: PrepClock;
  readyAt: string | null;
  taxi: { stage: string | null; companyName: string } | null;
  deliveredAt: string | null;
  /** "Did you receive it?" is asked once the taxi is on its way; a signal only. */
  receivedAt?: string | null;
  canConfirmReceived?: boolean;
  cancel: { allowed: boolean; kind: 'UNPAID' | 'REFUND_REQUEST' | null };
  refund: { status: string; hasReceipt: boolean } | null;
}

export interface OrderSummary {
  id: string;
  number: number;
  status: string;
  stage: CustomerStage;
  createdAt: string;
  restaurantName: string;
  foodTotalSom: number;
  itemsCount: number;
  /** Optional so an older backend (without these list fields) still works. */
  serverNow?: string;
  prep?: PrepClock;
  taxi?: { stage: string | null; companyName: string } | null;
}

export interface CartLine { productId: string; name: string; priceSom: number; quantity: number }
export interface CartState { restaurantId: string | null; restaurantName: string | null; lines: CartLine[] }

export type LinkState = 'CREATED' | 'BOT_BOUND' | 'BOT_CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED';
export interface LinkStatus {
  id: string;
  status: LinkState;
  expiresAt: string;
  /** Present only after the Telegram user confirmed in the bot. */
  telegram?: { name: string | null; username: string | null } | null;
  existingAccount?: boolean;
}
