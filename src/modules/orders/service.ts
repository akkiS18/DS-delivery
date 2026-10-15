import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '../../lib/db.js';
import type { PaymentEngineV3 } from '../payment/engine.js';

export const orderSchema = z.object({
  restaurantId: z.string().min(1),
  telegramUserId: z.string().regex(/^\d{1,20}$/),
  customerName: z.string().trim().max(100).optional(),
  phone: z.string().regex(/^\+998\d{9}$/).optional(),
  addressText: z.string().trim().min(3).max(500),
  deliveryLat: z.number().min(-90).max(90).optional(),
  deliveryLng: z.number().min(-180).max(180).optional(),
  taxiCompanyId: z.string().min(1).optional(),
  checkoutKey: z.string().uuid().optional(),
  createdViaBot: z.boolean().default(false),
  allowTaxiFallback: z.boolean().default(false),
  items: z.array(z.object({ productId: z.string().min(1), quantity: z.number().int().min(1).max(30) })).min(1).max(20),
  paymentMode: z.enum(['MOCK', 'REAL']).default('MOCK'),
}).refine(x => (x.deliveryLat === undefined) === (x.deliveryLng === undefined), {
  message: 'Lat/lng ikkalasi birga berilishi kerak.',
}).refine(x => !x.createdViaBot || (Boolean(x.phone) && Boolean(x.taxiCompanyId) && Boolean(x.checkoutKey)), {
  message: 'Bot buyurtmasi uchun telefon, taksi va checkoutKey kerak.',
});

export type PlaceOrderInput = z.input<typeof orderSchema>;
type PlaceOrderData = z.output<typeof orderSchema>;

export function paymentView(p: {
  id: string; number: number; status: string; amountTiyin: bigint;
  card: { last4: string; label: string; isTest: boolean } | null; expiresAt: Date | null;
} | null) {
  return p ? {
    id: p.id, number: p.number, status: p.status,
    amountSom: Number(p.amountTiyin / 100n),
    card: p.card && { last4: p.card.last4, label: p.card.label, isTest: p.card.isTest },
    expiresAt: p.expiresAt,
  } : null;
}

export async function orderDetails(orderId: string) {
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: {
      customer: { select: { telegramUserId: true } },
      restaurant: { select: { name: true } },
      taxiCompany: { select: { name: true } },
      items: { select: { name: true, unitSom: true, quantity: true, subtotalSom: true } },
      payment: { include: { card: true } },
    },
  });
  if (!order) return null;
  return {
    id: order.id, number: order.number, status: order.status,
    totalSom: order.totalSom, addressText: order.addressText,
    phone: order.phoneSnapshot, customerTelegramUserId: order.customer.telegramUserId,
    restaurantName: order.restaurant.name, taxiCompanyName: order.taxiCompany?.name ?? null,
    items: order.items, payment: paymentView(order.payment),
  };
}

function hasUniqueConstraint(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export async function placeOrder(engine: PaymentEngineV3, input: PlaceOrderInput) {
  const data: PlaceOrderData = orderSchema.parse(input);
  if (process.env.NODE_ENV === 'production' && data.paymentMode === 'MOCK') {
    const error = new Error('Mock payments disabled in production') as Error & { statusCode: number };
    error.statusCode = 403;
    throw error;
  }
  const amounts = new Map<string, number>();
  for (const i of data.items) amounts.set(i.productId, (amounts.get(i.productId) ?? 0) + i.quantity);
  if ([...amounts.values()].some(quantity => quantity > 30)) {
    const error = new Error('Too many units per product') as Error & { statusCode: number };
    error.statusCode = 400;
    throw error;
  }

  // A double-tap or retried callback must not create a second order/payment.
  async function previouslyCreated() {
    if (!data.checkoutKey) return null;
    const existing = await db.order.findUnique({ where: { checkoutKey: data.checkoutKey }, include: { customer: true } });
    if (!existing) return null;
    if (existing.customer.telegramUserId !== data.telegramUserId) {
      throw new Error('CHECKOUT_KEY_BEGONA');
    }
    return orderDetails(existing.id);
  }
  const existing = await previouslyCreated();
  if (existing) return existing;

  try {
    const { order } = await engine.createCheckout(async tx => {
      if (data.checkoutKey) {
        const found = await tx.order.findUnique({ where: { checkoutKey: data.checkoutKey } });
        if (found) throw new Error('CHECKOUT_ALREADY_CREATED');
      }
      const restaurant = await tx.restaurant.findUnique({ where: { id: data.restaurantId } });
      if (!restaurant?.isActive || restaurant.isPaused) throw new Error('RESTORAN_BUYURTMA_QABUL_QILMAYDI');
      if (data.taxiCompanyId) {
        const taxi = await tx.taxiCompany.findUnique({ where: { id: data.taxiCompanyId } });
        if (!taxi?.isActive) throw new Error('TAKSI_XIZMATI_MAVJUD_EMAS');
        if (data.paymentMode === 'REAL' && !taxi.operatorTelegramUserId) throw new Error('TAKSI_OPERATOR_BIRIKTIRILMAGAN');
      }
      const products = await tx.product.findMany({
        where: { id: { in: [...amounts.keys()] }, restaurantId: data.restaurantId, isAvailable: true },
      });
      if (products.length !== amounts.size) throw new Error('MAHSULOT_MAVJUD_EMAS');
      const lines = products.map(p => {
        const quantity = amounts.get(p.id)!;
        return { productId: p.id, name: p.name, unitSom: p.priceSom, quantity, subtotalSom: p.priceSom * quantity };
      });
      const totalSom = lines.reduce((sum, item) => sum + item.subtotalSom, 0);
      if (!Number.isSafeInteger(totalSom) || totalSom > 100_000_000) throw new Error('BUYURTMA_SUMMASI_JUDA_KATTA');
      const customer = await tx.customer.upsert({
        where: { telegramUserId: data.telegramUserId },
        create: { telegramUserId: data.telegramUserId, displayName: data.customerName, phone: data.phone },
        update: {
          ...(data.customerName ? { displayName: data.customerName } : {}),
          ...(data.phone ? { phone: data.phone } : {}),
        },
      });
      return tx.order.create({
        data: {
          restaurantId: data.restaurantId, customerId: customer.id,
          addressText: data.addressText,
          deliveryLat: data.deliveryLat, deliveryLng: data.deliveryLng,
          phoneSnapshot: data.phone, taxiCompanyId: data.taxiCompanyId,
          checkoutKey: data.checkoutKey, createdViaBot: data.createdViaBot,
          allowTaxiFallback: data.allowTaxiFallback,
          totalSom, status: 'PAYMENT_PENDING', items: { create: lines },
        },
      });
    }, data.paymentMode === 'MOCK');
    return orderDetails(order.id);
  } catch (error) {
    if ((hasUniqueConstraint(error) || (error instanceof Error && error.message === 'CHECKOUT_ALREADY_CREATED')) && data.checkoutKey) {
      const retried = await previouslyCreated();
      if (retried) return retried;
    }
    throw error;
  }
}
