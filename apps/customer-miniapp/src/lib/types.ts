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
  /** Relative URL of the restaurant's photo (null = none); an older backend omits it. */
  imageUrl?: string | null;
  /** The plain average and the number of ratings; null until enough people rated (and from an older backend). */
  rating?: { avg: number; count: number } | null;
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

/** The platform service fee model (src/modules/pricing/fee.ts). Dish prices shown to the customer already contain it; `Product.priceSom` is the restaurant's own price. */
export interface PublicPricing { mode: 'FLAT' | 'PERCENT' | 'TIERED'; percentBp: number; kneeSom: number; lowBp: number; highBp: number; milestonesSom: number[] }

export interface MenuResponse { restaurant: Restaurant; categories: Category[]; products: Product[]; pricing?: PublicPricing }

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

/** unitSom / subtotalSom are what the customer pays; baseUnitSom is the restaurant's own price (absent from an older backend: then they are the same). */
export interface QuoteLine { productId: string; name: string; unitSom: number; baseUnitSom?: number; quantity: number; subtotalSom: number }
export type CheckoutIssue =
  | { kind: 'RESTAURANT_UNAVAILABLE' }
  | { kind: 'RESTAURANT_CLOSED'; opensNext: OpensNext | null }
  | { kind: 'PRODUCT_UNAVAILABLE'; productId: string }
  | { kind: 'PRICE_CHANGED'; productId: string; name: string; expectedUnitSom: number; currentUnitSom: number }
  | { kind: 'TOTAL_CHANGED'; expectedTotalSom: number; currentTotalSom: number }
  | { kind: 'TOTAL_TOO_LARGE' };
/** What the customer may choose for the food payment (server advice; the server decides again). Absent from an older backend: card only. */
export interface PaymentOptions {
  card: { state: 'FREE' | 'BUSY' | 'NONE' };
  cash: { available: boolean; reason?: 'OFF' | 'TOO_LARGE'; maxSom?: number };
}
export type PaymentMethod = 'CARD' | 'CASH';

export type QuoteResponse =
  | { ok: true; lines: QuoteLine[]; totalSom: number; baseTotalSom?: number; pricing?: PublicPricing; paymentOptions?: PaymentOptions; estimatedPrepMinutes: number }
  | { ok: false; issues: CheckoutIssue[]; lines: QuoteLine[]; totalSom: number; baseTotalSom?: number; pricing?: PublicPricing };

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
  /** Length of the payment window in seconds (the screen says "within N minutes" and counts down to expiresAt). */
  windowSeconds?: number | null;
}

/** A taxi service the customer can pick at checkout. */
export interface TaxiOption { id: string; name: string }

export interface PrepClock {
  minutes: number;
  startedAt: string | null;
  estimatedReadyAt: string | null;
  readyAt: string | null;
  remainingSeconds: number | null;
  overdueMinutes: number;
  isOverdue: boolean;
  /** What the restaurant chose ("ready in N minutes"); null while it has not chosen yet: no time is shown, only "aniqlanmoqda". */
  chosenMinutes?: number | null;
}

export interface OrderView {
  serverNow: string;
  id: string;
  /** The public order reference (short code like K7M2Q). The platform's internal sequence number is never sent. */
  code: string;
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
  payment: {
    status: string; amountSom: number; mode: 'MOCK' | 'REAL'; queued: boolean; instructions: PaymentInstructions | null;
    /** Absent from an older backend: card. */
    method?: PaymentMethod;
    /** Cash on delivery: dueSom is handed to the driver; acceptBy = when the restaurant's answer is due (null once accepted). */
    cash?: { dueSom: number; accepted: boolean; acceptBy: string | null } | null;
  } | null;
  prep: PrepClock;
  readyAt: string | null;
  taxi: { stage: string | null; companyName: string } | null;
  /** The taxi service chosen at checkout; known before any dispatch exists. */
  taxiCompanyName?: string | null;
  deliveredAt: string | null;
  /** "Did you receive it?" is asked once the taxi is on its way; a signal only. */
  receivedAt?: string | null;
  canConfirmReceived?: boolean;
  /** When the payment was accepted (null until then): used to announce the acceptance once. */
  paidAt?: string | null;
  cancel: { allowed: boolean; kind: 'UNPAID' | 'REFUND_REQUEST' | null };
  refund: { status: string; hasReceipt: boolean } | null;
  /** The customer's own rating of the food, and whether it can still be given or changed (24 h after delivery). */
  rating?: { stars: number; reasons: string[]; note: string | null } | null;
  canRate?: boolean;
  rateUntil?: string | null;
}

export interface OrderSummary {
  id: string;
  code: string;
  status: string;
  stage: CustomerStage;
  createdAt: string;
  restaurantName: string;
  foodTotalSom: number;
  itemsCount: number;
  method?: PaymentMethod;
  /** Stars given to the food (null = not rated) and whether the 24 h window is still open. */
  rating?: number | null;
  canRate?: boolean;
  rateUntil?: string | null;
  /** Optional so an older backend (without these list fields) still works. */
  serverNow?: string;
  prep?: PrepClock;
  taxi?: { stage: string | null; companyName: string } | null;
}

/** `priceSom` is the restaurant's own menu price; the customer-facing price comes from pricing (lib/fee.ts). */
export interface CartLine { productId: string; name: string; priceSom: number; quantity: number }
export interface CartState { restaurantId: string | null; restaurantName: string | null; lines: CartLine[]; pricing?: PublicPricing }

/** Support chat (the customer's side; the admins answer in Telegram). `lastFrom` tells whose message is newest. */
export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';
export interface TicketSummary {
  id: string; number: number; orderId: string; orderCode: string; restaurantName: string; status: TicketStatus;
  createdAt: string; lastAt: string; lastFrom: 'CUSTOMER' | 'ADMIN'; lastText: string; unread: boolean;
}
export interface TicketThread {
  ticket: { id: string; number: number; orderId: string; orderCode: string; restaurantName: string; status: TicketStatus; createdAt: string };
  messages: Array<{ id: string; from: 'CUSTOMER' | 'ADMIN'; text: string; at: string }>;
}

export type LinkState = 'CREATED' | 'BOT_BOUND' | 'BOT_CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED';
export interface LinkStatus {
  id: string;
  status: LinkState;
  expiresAt: string;
  /** Present only after the Telegram user confirmed in the bot. */
  telegram?: { name: string | null; username: string | null } | null;
  existingAccount?: boolean;
}
