import { ApiError } from './apiError';
import { apiOrigin, isAndroidApp } from './platform';
import { dropGuestToken, getGuestToken } from './session';
import { getInitData } from './telegram';
import type { Address, AppConfig, Banner, LinkStatus, MenuResponse, OrderSummary, OrderView, Profile, QuoteResponse, ReservationView, Restaurant, SearchResponse, TaxiOption, TicketSummary, TicketThread } from './types';

export { ApiError };

const PATH = '/api/v1/miniapp';

interface Opts { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown; signal?: AbortSignal | undefined }

/**
 * Telegram: `Authorization: tma <initData>` (signed by Telegram). Android app: `Authorization: Bearer <guest session>` (issued by the server).
 * Either way the server derives the customer from the credential; nothing in a body or query names a customer. Failures are normalised to
 * ApiError so screens never parse HTTP themselves.
 */
async function authorization(): Promise<{ header: string; guestToken: string | null }> {
  if (isAndroidApp) {
    const guestToken = await getGuestToken();
    return { header: `Bearer ${guestToken}`, guestToken };
  }
  const initData = getInitData();
  if (!initData) throw new ApiError(401, 'NO_TELEGRAM');
  return { header: `tma ${initData}`, guestToken: null };
}

export async function request<T>(path: string, opts: Opts = {}, retried = false): Promise<T> {
  let auth: Awaited<ReturnType<typeof authorization>>;
  try { auth = await authorization(); }
  catch (e) { throw e instanceof ApiError ? e : new ApiError(0, e instanceof Error && e.message.startsWith('API_URL') ? e.message : 'NETWORK'); }
  // Every non-GET request carries an explicit JSON body (`{}` when there is none). The native HTTP layer of the Android app labels a
  // bodiless POST as form-urlencoded and the server answers 415; a JSON `{}` is accepted by every route and ignored by those without a body.
  const reqBody = opts.body !== undefined ? opts.body : (opts.method && opts.method !== 'GET' ? {} : undefined);
  let res: Response;
  try {
    res = await fetch(`${apiOrigin()}${PATH}${path}`, {
      method: opts.method ?? 'GET',
      headers: { Authorization: auth.header, ...(reqBody !== undefined ? { 'Content-Type': 'application/json' } : {}), Accept: 'application/json' },
      ...(reqBody !== undefined ? { body: JSON.stringify(reqBody) } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
      cache: 'no-store',
    });
  } catch (err) {
    if ((err as { name?: string }).name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK');
  }
  if (res.status === 204) return undefined as T;
  let payload: unknown = null;
  try { payload = await res.json(); } catch { /* empty or non-JSON body */ }
  if (res.status === 401 && auth.guestToken && !retried) {
    // The server no longer knows this session (expired / revoked). Forget it and continue as a new guest once.
    await dropGuestToken(auth.guestToken);
    return request<T>(path, opts, true);
  }
  if (!res.ok) {
    const p = (payload ?? {}) as { error?: unknown; details?: unknown };
    const retry = Number(res.headers.get('Retry-After'));
    throw new ApiError(res.status, typeof p.error === 'string' ? p.error : `HTTP_${res.status}`, p.details, Number.isFinite(retry) && retry > 0 ? retry : undefined);
  }
  return payload as T;
}

export interface CheckoutBody {
  checkoutKey: string;
  restaurantId: string;
  items: Array<{ productId: string; quantity: number }>;
  expectedTotalSom: number;
  expectedUnitPrices: Record<string, number>;
  addressId?: string;
  address?: { label?: string; addressText: string; lat?: number; lng?: number; save?: boolean };
  phone?: string;
  /** The taxi service the customer picked; omitted = the server assigns one. */
  taxiCompanyId?: string;
  /** CARD (default) or CASH on delivery. */
  paymentMethod?: 'CARD' | 'CASH';
  /** WALK_OK = "my home is close, the restaurant may bring it on foot" (the restaurant decides; otherwise a taxi comes). Omitted = taxi. */
  deliveryPreference?: 'WALK_OK';
}

export interface ReservationBody {
  checkoutKey: string;
  restaurantId: string;
  /** ISO time with an offset (the restaurant's local time). */
  startsAt: string;
  partySize: number;
  note?: string;
  phone?: string;
}

export const api = {
  config: (signal?: AbortSignal) => request<AppConfig>('/config', { signal }),
  me: (signal?: AbortSignal) => request<Profile>('/me', { signal }),
  setPhone: (phone: string) => request<{ phone: string }>('/me/phone', { method: 'PUT', body: { phone } }),
  addAddress: (a: { label: string; addressText: string; lat?: number; lng?: number; makeDefault?: boolean }) => request<Address>('/me/addresses', { method: 'POST', body: a }),
  updateAddress: (id: string, a: { label: string; addressText: string; lat?: number; lng?: number }) => request<Address>(`/me/addresses/${id}`, { method: 'PUT', body: a }),
  deleteAddress: (id: string) => request<void>(`/me/addresses/${id}`, { method: 'DELETE' }),
  setDefaultAddress: (id: string) => request<Address>(`/me/addresses/${id}/default`, { method: 'POST' }),
  restaurants: (q: string, signal?: AbortSignal) => request<{ restaurants: Restaurant[] }>(`/restaurants${q ? `?q=${encodeURIComponent(q)}` : ''}`, { signal }),
  banners: (signal?: AbortSignal) => request<{ banners: Banner[] }>('/banners', { signal }),
  search: (q: string, signal?: AbortSignal) => request<SearchResponse>(`/search?q=${encodeURIComponent(q)}`, { signal }),
  menu: (id: string, signal?: AbortSignal) => request<MenuResponse>(`/restaurants/${encodeURIComponent(id)}/menu`, { signal }),
  quote: (restaurantId: string, items: Array<{ productId: string; quantity: number }>, signal?: AbortSignal) =>
    request<QuoteResponse>('/quote', { method: 'POST', body: { restaurantId, items }, signal }),
  taxiCompanies: (signal?: AbortSignal) => request<{ companies: TaxiOption[] }>('/taxi-companies', { signal }),
  createOrder: (body: CheckoutBody) => request<{ order: OrderView; replayed: boolean }>('/orders', { method: 'POST', body }),
  orders: (signal?: AbortSignal) => request<{ orders: OrderSummary[] }>('/orders', { signal }),
  order: (id: string, signal?: AbortSignal) => request<{ order: OrderView }>(`/orders/${encodeURIComponent(id)}`, { signal }),
  cancelOrder: (id: string, reasonCode?: string) => request<{ order: OrderView }>(`/orders/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: reasonCode ? { reasonCode } : {} }),
  /** "Rekvizit band": the queued card order becomes a cash order (the restaurant then accepts it). */
  payCash: (id: string) => request<{ order: OrderView }>(`/orders/${encodeURIComponent(id)}/pay-cash`, { method: 'POST', body: {} }),
  confirmReceived: (id: string) => request<{ order: OrderView }>(`/orders/${encodeURIComponent(id)}/received`, { method: 'POST', body: {} }),
  startTelegramLink: () => request<LinkStatus & { deepLink: string }>('/me/telegram-link', { method: 'POST' }),
  telegramLink: (id: string, signal?: AbortSignal) => request<LinkStatus>(`/me/telegram-link/${encodeURIComponent(id)}`, { signal }),
  confirmTelegramLink: (id: string) => request<{ status: 'COMPLETED'; merged: boolean | null; session: { token: string; expiresAt: string } | null }>(`/me/telegram-link/${encodeURIComponent(id)}/confirm`, { method: 'POST' }),
  cancelTelegramLink: (id: string) => request<LinkStatus>(`/me/telegram-link/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
  /** The bank-receipt photo the restaurant attached to a sent refund (base64 JSON; the order's own customer only). */
  refundReceipt: (id: string, signal?: AbortSignal) => request<{ mime: string; dataBase64: string; sentAt: string | null }>(`/orders/${encodeURIComponent(id)}/refund/receipt`, { signal }),
  /** Support chat: the caller's tickets, one conversation (opening it marks it read), a new ticket for an order, a message, and the unread count. */
  tickets: (signal?: AbortSignal) => request<{ tickets: TicketSummary[] }>('/support', { signal }),
  ticketsUnread: (signal?: AbortSignal) => request<{ unread: number }>('/support/unread', { signal }),
  ticket: (id: string, signal?: AbortSignal) => request<TicketThread>(`/support/${encodeURIComponent(id)}`, { signal }),
  openTicket: (orderId: string, message: string) => request<{ ticketId: string; number: number; created: boolean }>(`/orders/${encodeURIComponent(orderId)}/support`, { method: 'POST', body: { message } }),
  sendTicketMessage: (id: string, text: string, clientKey: string) => request<{ sent: boolean }>(`/support/${encodeURIComponent(id)}/messages`, { method: 'POST', body: { text, clientKey } }),
  /** Rate the food of a delivered order (1-5; reasons and a short note only matter for 1-3). */
  rateOrder: (id: string, body: { stars: number; reasons?: string[]; note?: string }) => request<{ order: OrderView }>(`/orders/${encodeURIComponent(id)}/rating`, { method: 'PUT', body }),
  /** Table reservations: a deposit paid to the restaurant's card books the table. */
  createReservation: (body: ReservationBody) => request<{ reservation: ReservationView; replayed: boolean }>('/reservations', { method: 'POST', body }),
  reservations: (signal?: AbortSignal) => request<{ reservations: ReservationView[] }>('/reservations', { signal }),
  reservation: (id: string, signal?: AbortSignal) => request<{ reservation: ReservationView }>(`/reservations/${encodeURIComponent(id)}`, { signal }),
  mockPay: (id: string) => request<{ order: OrderView }>(`/orders/${encodeURIComponent(id)}/mock-payment`, { method: 'POST' }),
};
