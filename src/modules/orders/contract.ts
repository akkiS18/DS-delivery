import { z } from 'zod';
import { db } from '../../lib/db.js';
import { CUSTOMER_REASONS } from '../refunds/workflow.js';
import { paymentOptions, type PaymentOptions } from '../payment/options.js';
import { loadFeeConfig } from '../pricing/config.js';
import { publicPricing, type PublicPricing } from '../pricing/fee.js';
import { validateCheckout, type CheckoutIssue, type CheckoutLine, type PlaceOrderInput } from './service.js';

/**
 * Stage 6F: the backend contract for the future Telegram Mini App checkout. NO HTTP route is registered here on purpose:
 * the Mini App needs authentication first (Telegram WebApp `initData` verified server-side with the bot token and a freshness
 * window), which belongs to the Mini App stage. These schemas and functions are the reviewed, tested building blocks; see
 * docs/MINIAPP_API_CONTRACT.md for the endpoint layout.
 *
 * Rules the contract enforces:
 *  - the customer's identity is NEVER in the body (it comes from the verified initData) - bodies are strict;
 *  - prices are never trusted from the client: the client only states what it SHOWED, and a mismatch refuses the order;
 *  - cancellation takes at most a reason code - never a bank account, card number or reference.
 */
const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const items = z.array(z.object({ productId: id, quantity: z.number().int().min(1).max(30) }).strict()).min(1).max(20);

export const quoteRequestSchema = z.object({ restaurantId: id, items }).strict();

/** An address sent inline with the order (not yet saved). `save` stores it in the customer's profile after the order is created. */
const inlineAddress = z.object({
  label: z.string().trim().min(1).max(30).optional(),
  addressText: z.string().trim().min(3).max(500),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  save: z.boolean().optional(),
}).strict().refine(x => (x.lat === undefined) === (x.lng === undefined), { message: 'lat/lng together' });

export const checkoutRequestSchema = z.object({
  /** Idempotency key: a retry with the same key returns the first order and never creates a second one. */
  checkoutKey: z.string().uuid(),
  restaurantId: id,
  items,
  /** What the customer saw. Required: the order is refused with 409 NARX_OZGARGAN if the current total differs. */
  expectedTotalSom: z.number().int().min(0).max(100_000_000),
  expectedUnitPrices: z.record(id, z.number().int().min(0)).optional(),
  /** Exactly one of: a saved address of THIS customer, or an inline address. */
  addressId: id.optional(),
  address: inlineAddress.optional(),
  /** Optional: the saved profile phone is used when omitted. A phone sent here is remembered for next time. */
  phone: z.string().trim().regex(/^\+998\d{9}$/).optional(),
  /** The taxi service the customer picked on the checkout screen. Omitted (older app versions): the server assigns one at dispatch and may fall back. */
  taxiCompanyId: id.optional(),
  /** How the customer pays. Omitted (older app versions): CARD, exactly as before. */
  paymentMethod: z.enum(['CARD', 'CASH']).optional(),
}).strict().refine(x => (x.addressId === undefined) !== (x.address === undefined), { message: 'addressId yoki address' });
// A chosen company is the customer's decision (the delivery price is the taxi service's own): no silent fallback to another one.

export const customerCancelRequestSchema = z.object({ reasonCode: z.enum(CUSTOMER_REASONS).optional() }).strict();

export type QuoteResponse =
  | { ok: true; lines: CheckoutLine[]; totalSom: number; baseTotalSom: number; pricing: PublicPricing; paymentOptions: PaymentOptions; estimatedPrepMinutes: number }
  | { ok: false; issues: CheckoutIssue[]; lines: CheckoutLine[]; totalSom: number; baseTotalSom: number; pricing: PublicPricing };

/** Price/availability preview without creating anything. Same validation the order creation runs. */
export async function quoteCheckout(input: z.infer<typeof quoteRequestSchema>, opts: { isTest?: boolean } = {}): Promise<QuoteResponse> {
  const r = await validateCheckout(db, input);
  const pricing = publicPricing(await loadFeeConfig(db)); // lets the app show the same prices locally while the customer edits the cart
  return r.ok
    ? { ok: true, lines: r.lines, totalSom: r.totalSom, baseTotalSom: r.fee.baseTotalSom, pricing,
      paymentOptions: await paymentOptions({ restaurantId: input.restaurantId, totalSom: r.totalSom, isTest: opts.isTest ?? false }), estimatedPrepMinutes: r.restaurant.defaultPrepMinutes }
    : { ok: false, issues: r.issues, lines: r.lines, totalSom: r.totalSom, baseTotalSom: r.fee.baseTotalSom, pricing };
}

/** The only place the customer identity enters: the owner must come from verified initData (Telegram id) or a server-side guest session (customer id), never from the request. */
export function toPlaceOrderInput(
  owner: string | { customerId: string }, customerName: string | undefined,
  resolved: { phone: string; addressText: string; lat?: number | null; lng?: number | null },
  req: Pick<z.infer<typeof checkoutRequestSchema>, 'checkoutKey' | 'restaurantId' | 'items' | 'expectedTotalSom' | 'expectedUnitPrices'> & { taxiCompanyId?: string | undefined; paymentMethod?: 'CARD' | 'CASH' | undefined },
  paymentMode: 'MOCK' | 'REAL',
): PlaceOrderInput {
  return {
    restaurantId: req.restaurantId, ...(typeof owner === 'string' ? { telegramUserId: owner } : { customerId: owner.customerId }), ...(customerName ? { customerName } : {}), phone: resolved.phone, addressText: resolved.addressText,
    ...(resolved.lat != null && resolved.lng != null ? { deliveryLat: resolved.lat, deliveryLng: resolved.lng } : {}),
    checkoutKey: req.checkoutKey, createdViaBot: true, paymentMode, paymentMethod: req.paymentMethod ?? 'CARD', items: req.items, expectedTotalSom: req.expectedTotalSom,
    ...(req.taxiCompanyId ? { taxiCompanyId: req.taxiCompanyId } : { autoTaxi: true }),
    ...(req.expectedUnitPrices ? { expectedUnitPrices: req.expectedUnitPrices } : {}),
  };
}
