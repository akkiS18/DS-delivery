import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient, type Card, type Payment } from '@prisma/client';
import {
  classifyAmountMismatch, couldBelongToEarlierPayment, incomingFingerprint, isDelayedNotification, overlapsPaymentWindow,
} from './matching.js';
import { CASH_ACCEPTED, CASH_PENDING, cashAcceptWindowMs } from './method.js';
import { formatSom } from './uzcard.js';

export type Incoming = {
  sourceId: string;
  source: 'MOCK' | 'GMAIL' | 'HUMO_TG';
  cardLast4: string;
  amountTiyin: bigint;
  occurredAt: Date;
  emailReceivedAt?: Date;
  minutePrecision: boolean;
  trustedSender: boolean;
};
export type MatchResult = {
  status: 'MATCHED_UNVERIFIED' | 'REVIEW_REQUIRED' | 'DUPLICATE';
  reason?: string;
  paymentNumber?: number;
};
export type Options = {
  paymentWindowMs: number;
  queueWindowMs: number;
  cooldownMs: number;
  /** Stage 9: after the customer cancels an unpaid order / after a payment is matched the card is free at once (default: same as cooldownMs, i.e. unchanged). Expiry always uses cooldownMs. */
  cancelCooldownMs?: number;
  matchCooldownMs?: number;
  ambiguityMs: number;
  /** Stage 4A: a bank mail older than this (vs. the operation time) is never auto-matched. Default 30 min. */
  maxNotificationDelayMs?: number;
};
export const defaultOptions: Options = {
  paymentWindowMs: 300_000,
  queueWindowMs: 600_000,
  cooldownMs: 120_000,
  ambiguityMs: 900_000,
};
const key = (p: Payment): string => `P${String(p.number).padStart(4, '0')}`;
export const displayPayment = key;
/** Append-only payment history (Stage 4A). */
type PaymentEventInput = {
  paymentId: string; action: string; fromStatus?: string; toStatus?: string; actorType?: string;
  actorId?: string; incomingTransactionId?: string; details?: Prisma.InputJsonValue;
};
const record = (tx: Prisma.TransactionClient, e: PaymentEventInput) =>
  tx.paymentEvent.create({ data: { ...e, actorType: e.actorType ?? 'SYSTEM' } });
const allowedMoney = (n: bigint): void => {
  if (n < 100n || n > 10_000_000_000_000n) throw new Error('Noto‘g‘ri summa (tiyin).');
};

export class PaymentEngineV3 {
  constructor(
    public readonly db: PrismaClient,
    private readonly options: Options = defaultOptions,
    private readonly log: (line: string) => void = console.log,
  ) {}

  // One transaction-scoped lock serializes scheduling/matching across all Node processes.
  // Additionally, PostgreSQL's partial UNIQUE INDEX enforces the cardinal invariant.
  private async locked<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1::integer AS locked FROM pg_advisory_xact_lock(7013, 3001)`;
      return fn(tx);
    }, { maxWait: 60_000, timeout: 120_000 });
  }

  /** Stage 6A: run a callback under the same advisory lock that serializes matching and scheduling. */
  runLocked<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.locked(fn);
  }

  /** Stage 6A: unpaid cancellation of an order's single payment attempt. Only QUEUED/AWAITING can be cancelled; a
   *  matched or confirmed payment is never touched here. Call inside runLocked. The card/amount cooldown protects
   *  against reassigning the pair while the first payer's late transfer may still arrive; such a late mail is
   *  classified LATE_FOR_EXPIRED_PAYMENT (manual review) by ingest. */
  async cancelOpenPayment(
    tx: Prisma.TransactionClient, orderId: string, now: Date, actor: { type: string; id: string },
  ): Promise<{ cancelled: boolean; status: string | null }> {
    const p = await tx.payment.findUnique({ where: { orderId } });
    if (!p) return { cancelled: false, status: null };
    // A cash order the restaurant has not accepted yet can be cancelled too (it never held a card, so there is no cooldown).
    if (p.status !== 'QUEUED' && p.status !== 'AWAITING' && p.status !== CASH_PENDING) return { cancelled: false, status: p.status };
    const { count } = await tx.payment.updateMany({ where: { id: p.id, status: p.status }, data: { status: 'CANCELLED' } });
    if (count !== 1) return { cancelled: false, status: p.status };
    if (p.status === 'AWAITING' && p.cardId) await this.setCooldown(tx, p.cardId, p.amountTiyin, now, this.options.cancelCooldownMs ?? this.options.cooldownMs);
    await record(tx, { paymentId: p.id, action: 'CANCELLED', fromStatus: p.status, toStatus: 'CANCELLED', actorType: actor.type, actorId: actor.id });
    return { cancelled: true, status: 'CANCELLED' };
  }

  async addCard(last4: string, isTest = false, restaurantId: string | null = null): Promise<Card> {
    if (!/^\d{4}$/.test(last4)) throw new Error('Oxirgi 4 raqam kerak: card add 8167');
    const { card, assigned } = await this.locked(async tx => {
      const existing = await tx.card.findUnique({ where: { last4 } });
      if (existing) {
        if (existing.isTest !== isTest || existing.restaurantId !== restaurantId) throw new Error('Karta boshqa tur yoki restoranga tegishli.');
        return { card: existing, assigned: [] as Payment[] };
      }
      const card = await tx.card.create({ data: { last4, isTest, restaurantId, label: isTest ? 'MOCK' : 'UZCARD' } });
      const assigned = await this.assignQueued(tx, new Date());
      return { card, assigned };
    });
    this.log(`[CARD] ${card.label} ***${card.last4} | ${card.isTest ? 'faqat MOCK' : 'UZCARD'}`);
    this.printAssignments(assigned);
    return card;
  }

  async createPayment(amountTiyin: bigint, isTest = false, isStress = false, orderId: string | null = null, restaurantId: string | null = null): Promise<Payment> {
    allowedMoney(amountTiyin);
    if (orderId && !restaurantId) throw new Error('Buyurtma to‘lovi uchun restaurantId majburiy.');
    const { created, assigned } = await this.locked(async tx => {
      const now = new Date();
      await this.expireWithin(tx, now);
      const created = await tx.payment.create({ data: { amountTiyin, isTest, isStress, orderId, restaurantId, status: 'QUEUED' } });
      await record(tx, { paymentId: created.id, action: 'CREATED', toStatus: 'QUEUED' });
      const assigned = await this.assignForAmount(tx, amountTiyin, isTest, restaurantId, now);
      return { created, assigned };
    });
    this.printAssignments(assigned);
    if (!assigned.some(a => a.id === created.id)) {
      this.log(`[QUEUE] ${key(created)} | ${formatSom(created.amountTiyin)} | hozir mos karta band`);
    }
    return this.db.payment.findUniqueOrThrow({ where: { id: created.id } });
  }

  /** Atomic checkout: an Order and its Payment are created under one DB transaction.
   * No orphan PAYMENT_PENDING order after an application crash between two writes.
   */
  async createCheckout<T extends { id: string; restaurantId: string; totalSom: number }>(
    createOrder: (tx: Prisma.TransactionClient) => Promise<T>,
    isTest: boolean,
  ): Promise<{ order: T; payment: Payment }> {
    const { order, payment, assigned } = await this.locked(async tx => {
      const now = new Date();
      await this.expireWithin(tx, now);
      const order = await createOrder(tx);
      const amountTiyin = BigInt(order.totalSom) * 100n;
      allowedMoney(amountTiyin);
      const payment = await tx.payment.create({
        data: { amountTiyin, isTest, status: 'QUEUED', restaurantId: order.restaurantId, orderId: order.id },
      });
      await record(tx, { paymentId: payment.id, action: 'CREATED', toStatus: 'QUEUED' });
      const assigned = await this.assignForAmount(tx, amountTiyin, isTest, order.restaurantId, now);
      return { order, payment, assigned };
    });
    this.printAssignments(assigned);
    if (!assigned.some(p => p.id === payment.id)) this.log(`[QUEUE] ${key(payment)} | ${formatSom(payment.amountTiyin)}`);
    return { order, payment: await this.db.payment.findUniqueOrThrow({ where: { id: payment.id } }) };
  }

  /** Cash on delivery: the order and a CASH_PENDING payment are created together. No card is allocated and nothing is matched against bank mail;
   *  the restaurant's acceptance (restaurant/cash.ts) is what makes the order cookable. */
  async createCashCheckout<T extends { id: string; restaurantId: string; totalSom: number }>(
    createOrder: (tx: Prisma.TransactionClient) => Promise<T>,
    isTest: boolean,
  ): Promise<{ order: T; payment: Payment }> {
    return this.locked(async tx => {
      const now = new Date();
      await this.expireWithin(tx, now);
      const order = await createOrder(tx);
      const amountTiyin = BigInt(order.totalSom) * 100n;
      allowedMoney(amountTiyin);
      const payment = await tx.payment.create({
        data: { amountTiyin, isTest, status: CASH_PENDING, method: 'CASH', restaurantId: order.restaurantId, orderId: order.id, expiresAt: new Date(now.getTime() + cashAcceptWindowMs()) },
      });
      await record(tx, { paymentId: payment.id, action: 'CREATED', toStatus: CASH_PENDING, details: { method: 'CASH' } });
      return { order, payment };
    });
  }

  /** The customer's card payment is still QUEUED (no card was free, nothing to pay yet): turn it into a cash order. A payment that already has a
   *  card (AWAITING) is never converted: the customer may already have transferred the money. Call inside runLocked. */
  async switchQueuedToCash(tx: Prisma.TransactionClient, orderId: string, now: Date, actor: { type: string; id: string }): Promise<'SWITCHED' | 'NOT_QUEUED'> {
    const p = await tx.payment.findUnique({ where: { orderId } });
    if (!p || p.method !== 'CARD' || p.status !== 'QUEUED') return 'NOT_QUEUED';
    const { count } = await tx.payment.updateMany({
      where: { id: p.id, status: 'QUEUED', method: 'CARD', cardId: null },
      data: { status: CASH_PENDING, method: 'CASH', expiresAt: new Date(now.getTime() + cashAcceptWindowMs()) },
    });
    if (count !== 1) return 'NOT_QUEUED';
    await record(tx, { paymentId: p.id, action: 'SWITCHED_TO_CASH', fromStatus: 'QUEUED', toStatus: CASH_PENDING, actorType: actor.type, actorId: actor.id });
    return 'SWITCHED';
  }

  /** Fair, FIFO within each amount. Tests cards by minimum total active allocations. */
  private async assignForAmount(
    tx: Prisma.TransactionClient,
    amountTiyin: bigint,
    isTest: boolean,
    restaurantId: string | null,
    now: Date,
  ): Promise<Payment[]> {
    const cards = await tx.card.findMany({ where: { active: true, isTest, restaurantId } });
    if (!cards.length) return [];
    const cooldown = await tx.cardCooldown.findMany({ where: { amountTiyin, until: { gt: now } }, select: { cardId: true } });
    const blocked = new Set(cooldown.map(c => c.cardId));
    const already = await tx.payment.findMany({ where: { amountTiyin, status: 'AWAITING', isTest, restaurantId }, select: { cardId: true } });
    for (const active of already) if (active.cardId) blocked.add(active.cardId);
    const activeCounts = await tx.payment.groupBy({ by: ['cardId'], where: { isTest, status: 'AWAITING', restaurantId }, _count: { _all: true } });
    const count = new Map(activeCounts.map(c => [c.cardId, c._count._all]));
    const available = cards.filter(c => !blocked.has(c.id)).sort((a, b) =>
      (count.get(a.id) ?? 0) - (count.get(b.id) ?? 0) ||
      (a.lastAssignedAt?.getTime() ?? 0) - (b.lastAssignedAt?.getTime() ?? 0) ||
      a.last4.localeCompare(b.last4));
    const assigned: Payment[] = [];
    for (const card of available) {
      const next = await tx.payment.findFirst({
        where: { status: 'QUEUED', amountTiyin, isTest, restaurantId }, orderBy: { number: 'asc' },
      });
      if (!next) break;
      const updated = await tx.payment.update({
        where: { id: next.id },
        data: {
          status: 'AWAITING', cardId: card.id,
          assignedAt: now, expiresAt: new Date(now.getTime() + this.options.paymentWindowMs),
        },
      });
      await tx.card.update({ where: { id: card.id }, data: { lastAssignedAt: now } });
      await record(tx, { paymentId: updated.id, action: 'ASSIGNED', fromStatus: 'QUEUED', toStatus: 'AWAITING', details: { cardId: card.id } });
      assigned.push(updated);
      count.set(card.id, (count.get(card.id) ?? 0) + 1);
    }
    return assigned;
  }

  private async assignQueued(tx: Prisma.TransactionClient, now: Date): Promise<Payment[]> {
    // DISTINCT per amount prevents 1,000 identical queued payments from causing 1,000 DB lookups.
    const distinct = await tx.payment.groupBy({
      by: ['amountTiyin', 'isTest', 'restaurantId'], where: { status: 'QUEUED' },
      _min: { number: true }, orderBy: { _min: { number: 'asc' } },
    });
    const assigned: Payment[] = [];
    for (const group of distinct) {
      assigned.push(...await this.assignForAmount(tx, group.amountTiyin, group.isTest, group.restaurantId, now));
    }
    return assigned;
  }

  private async setCooldown(tx: Prisma.TransactionClient, cardId: string, amountTiyin: bigint, at: Date, ms: number = this.options.cooldownMs): Promise<void> {
    if (ms <= 0) return; // released immediately; an existing (longer) cooldown from an earlier expiry stays
    const until = new Date(at.getTime() + ms);
    const previous = await tx.cardCooldown.findUnique({ where: { cardId_amountTiyin: { cardId, amountTiyin } } });
    if (previous && previous.until > until) return;
    await tx.cardCooldown.upsert({
      where: { cardId_amountTiyin: { cardId, amountTiyin } },
      create: { cardId, amountTiyin, until }, update: { until },
    });
  }

  private async expireWithin(tx: Prisma.TransactionClient, now: Date): Promise<Payment[]> {
    const expiring = await tx.payment.findMany({
      where: { status: 'AWAITING', expiresAt: { lte: now } },
    });
    for (const payment of expiring) {
      await tx.payment.update({ where: { id: payment.id }, data: { status: 'EXPIRED' } });
      await record(tx, { paymentId: payment.id, action: 'EXPIRED', fromStatus: 'AWAITING', toStatus: 'EXPIRED' });
      if (payment.orderId) await tx.order.updateMany({
        where: { id: payment.orderId, status: 'PAYMENT_PENDING' }, data: { status: 'PAYMENT_EXPIRED' },
      });
      if (payment.cardId) await this.setCooldown(tx, payment.cardId, payment.amountTiyin, now);
    }
    const queuedOut = await tx.payment.findMany({
      where: { status: 'QUEUED', createdAt: { lte: new Date(now.getTime() - this.options.queueWindowMs) } },
      select: { id: true, orderId: true },
    });
    if (queuedOut.length) {
      await tx.payment.updateMany({ where: { id: { in: queuedOut.map(p => p.id) } }, data: { status: 'QUEUE_EXPIRED' } });
      await tx.paymentEvent.createMany({ data: queuedOut.map(p => ({
        paymentId: p.id, action: 'QUEUE_EXPIRED', fromStatus: 'QUEUED', toStatus: 'QUEUE_EXPIRED', actorType: 'SYSTEM',
      })) });
      const orderIds = queuedOut.map(p => p.orderId).filter((id): id is string => id !== null);
      if (orderIds.length) await tx.order.updateMany({
        where: { id: { in: orderIds }, status: 'PAYMENT_PENDING' }, data: { status: 'PAYMENT_EXPIRED' },
      });
    }
    // Cash orders nobody accepted in time. The order is expired exactly like an unpaid card order; nothing was ever charged.
    const cashOut = await tx.payment.findMany({ where: { method: 'CASH', status: CASH_PENDING, expiresAt: { lte: now } }, select: { id: true, orderId: true } });
    if (cashOut.length) {
      await tx.payment.updateMany({ where: { id: { in: cashOut.map(p => p.id) }, status: CASH_PENDING }, data: { status: 'EXPIRED' } });
      await tx.paymentEvent.createMany({ data: cashOut.map(p => ({
        paymentId: p.id, action: 'EXPIRED', fromStatus: CASH_PENDING, toStatus: 'EXPIRED', actorType: 'SYSTEM',
      })) });
      const orderIds = cashOut.map(p => p.orderId).filter((id): id is string => id !== null);
      if (orderIds.length) await tx.order.updateMany({ where: { id: { in: orderIds }, status: 'PAYMENT_PENDING' }, data: { status: 'PAYMENT_EXPIRED' } });
    }
    return expiring;
  }

  async maintenance(): Promise<{ expired: Payment[]; assigned: Payment[] }> {
    const result = await this.locked(async tx => {
      const now = new Date();
      const expired = await this.expireWithin(tx, now);
      const assigned = await this.assignQueued(tx, now);
      return { expired, assigned };
    });
    for (const p of result.expired) this.log(`[EXPIRED] ${key(p)} | ${formatSom(p.amountTiyin)}`);
    this.printAssignments(result.assigned);
    return result;
  }

  private printAssignments(payments: Payment[]): void {
    for (const payment of payments) {
      this.log(`[ASSIGN] ${key(payment)} | ${formatSom(payment.amountTiyin)} | karta biriktirildi`);
    }
  }

  async ingest(input: Incoming): Promise<MatchResult> {
    if (!input.sourceId || !/^[0-9]{4}$/.test(input.cardLast4) ||
        Number.isNaN(input.occurredAt.getTime()) || input.amountTiyin < 1n ||
        (input.emailReceivedAt && Number.isNaN(input.emailReceivedAt.getTime()))) {
      throw new Error('Kirim maʼlumotlari yaroqsiz.');
    }
    const result = await this.locked(async tx => {
      const prior = await tx.incomingTransaction.findUnique({ where: { sourceId: input.sourceId } });
      if (prior) return { status: 'DUPLICATE' } as MatchResult;
      const now = new Date();
      // Keep proof of EVERY incoming event, including unmatched / suspicious events.
      const incoming = await tx.incomingTransaction.create({
        data: {
          sourceId: input.sourceId, source: input.source, cardLast4: input.cardLast4,
          amountTiyin: input.amountTiyin, occurredAt: input.occurredAt,
          emailReceivedAt: input.emailReceivedAt,
          minutePrecision: input.minutePrecision, trustedSender: input.trustedSender,
          fingerprint: input.source !== 'MOCK' ? incomingFingerprint(input.cardLast4, input.amountTiyin, input.occurredAt) : null,
        },
      });
      // Stage 4A: every doubtful event ends here. Candidate payments get an audit entry but are never changed.
      const reviewed = async (
        reason: string, paymentNumber?: number, details?: Prisma.InputJsonValue, candidateIds: string[] = [],
      ): Promise<MatchResult> => {
        await tx.incomingTransaction.update({
          where: { id: incoming.id },
          data: { status: 'REVIEW_REQUIRED', reason, ...(details !== undefined ? { reviewDetails: details } : {}) },
        });
        for (const paymentId of candidateIds) {
          await record(tx, { paymentId, action: 'INCOMING_FLAGGED', incomingTransactionId: incoming.id, details: { reason } });
        }
        return { status: 'REVIEW_REQUIRED', reason, paymentNumber };
      };
      if (input.occurredAt.getTime() > now.getTime() + 120_000) return reviewed('FUTURE_OPERATION_TIME');
      const card = await tx.card.findUnique({ where: { last4: input.cardLast4 } });
      if (!card) return reviewed('UNKNOWN_CARD');
      if (card.isTest && input.source !== 'MOCK') return reviewed('GMAIL_FOR_MOCK_CARD'); // any real bank signal (mail or Telegram) for a test card
      if (!card.isTest && input.source === 'MOCK') return reviewed('MOCK_FOR_REAL_CARD');
      if (!input.trustedSender) return reviewed('UNVERIFIED_EMAIL_SENDER');
      // Same bank event under a different Gmail id (forward, resend): keep it, but never match it twice.
      if (incoming.fingerprint) {
        const twins = await tx.incomingTransaction.findMany({
          where: { fingerprint: incoming.fingerprint, id: { not: incoming.id } }, select: { sourceId: true }, take: 5,
        });
        if (twins.length) return reviewed('POSSIBLE_DUPLICATE_NOTIFICATION', undefined, { sameAs: twins.map(t => t.sourceId) });
      }
      const maxDelay = this.options.maxNotificationDelayMs ?? 1_800_000;
      if (input.emailReceivedAt && isDelayedNotification(input.occurredAt.getTime(), input.emailReceivedAt.getTime(), maxDelay)) {
        return reviewed('DELAYED_NOTIFICATION', undefined,
          { delayMs: input.emailReceivedAt.getTime() - input.occurredAt.getTime() });
      }
      const active = await tx.payment.findMany({
        where: { cardId: card.id, amountTiyin: input.amountTiyin, status: 'AWAITING' },
      });
      // The partial unique index makes this impossible; if it ever happens a human decides.
      if (active.length > 1) {
        return reviewed('MULTIPLE_ACTIVE_PAYMENTS', undefined, { payments: active.map(p => p.number) }, active.map(p => p.id));
      }
      const payment = active[0];
      if (!payment || !payment.assignedAt || !payment.expiresAt) {
        const t = input.occurredAt.getTime();
        const inWindow = {
          assignedAt: { lt: new Date(t + (input.minutePrecision ? 60_000 : 1)) }, expiresAt: { gt: new Date(t) },
        };
        // Same amount, already settled or expired attempt: duplicate/excess or late money, not a new match.
        const settled = await tx.payment.findMany({
          where: { cardId: card.id, amountTiyin: input.amountTiyin,
            status: { in: ['EXPIRED', 'CANCELLED', 'MATCHED_UNVERIFIED', 'CONFIRMED_MANUAL'] }, ...inWindow },
          orderBy: { number: 'asc' }, take: 5,
        });
        if (settled.length) {
          const late = settled.every(p => p.status === 'EXPIRED' || p.status === 'CANCELLED');
          return reviewed(late ? 'LATE_FOR_EXPIRED_PAYMENT' : 'ALREADY_MATCHED_PAYMENT', settled[0]!.number,
            { payments: settled.map(p => ({ number: p.number, status: p.status })) }, settled.map(p => p.id));
        }
        // Different amount on the same card inside an open window: partial or excess payment.
        const other = await tx.payment.findMany({
          where: { cardId: card.id, status: 'AWAITING', amountTiyin: { not: input.amountTiyin }, ...inWindow },
          orderBy: { number: 'asc' }, take: 5,
        });
        if (other.length) {
          const kind = other.length === 1 ? classifyAmountMismatch(other[0]!.amountTiyin, input.amountTiyin) : null;
          return reviewed(kind ?? 'AMOUNT_MISMATCH_MULTIPLE_CANDIDATES', other[0]!.number,
            { receivedTiyin: input.amountTiyin.toString(),
              expected: other.map(p => ({ number: p.number, tiyin: p.amountTiyin.toString() })) }, other.map(p => p.id));
        }
        return reviewed('NO_ACTIVE_PAYMENT');
      }
      if (payment.restaurantId !== card.restaurantId || payment.isTest !== card.isTest) {
        return reviewed('CARD_PAYMENT_SCOPE_MISMATCH', payment.number, undefined, [payment.id]);
      }
      if (input.emailReceivedAt && input.emailReceivedAt.getTime() < payment.assignedAt.getTime()) {
        return reviewed('EMAIL_ARRIVED_BEFORE_PAYMENT');
      }
      if (!overlapsPaymentWindow(
        input.occurredAt.getTime(), payment.assignedAt.getTime(), payment.expiresAt.getTime(), input.minutePrecision,
      )) return reviewed('OPERATION_OUTSIDE_WINDOW', payment.number);
      // Prior allocation of same pair: an old payer could be late; bank mail has no sender ID.
      // Stage 9: only a prior attempt that can still be PAID counts. EXPIRED (nobody paid, a late transfer is plausible) always does; a CANCELLED or an
      // already MATCHED/CONFIRMED one only while the operator keeps a cooldown for it (cancelCooldownMs / matchCooldownMs; 0 = the card was released at
      // once, so that attempt cannot be the sender). Production runs with 0, so an ordinary repeat order of the same dish is not held for review.
      const priorStatuses = [
        'EXPIRED',
        ...((this.options.cancelCooldownMs ?? this.options.cooldownMs) > 0 ? ['CANCELLED'] : []),
        ...((this.options.matchCooldownMs ?? this.options.cooldownMs) > 0 ? ['MATCHED_UNVERIFIED', 'CONFIRMED_MANUAL'] : []),
      ];
      const preceding = await tx.payment.findMany({
        where: {
          cardId: card.id, amountTiyin: input.amountTiyin, status: { in: priorStatuses },
          id: { not: payment.id }, assignedAt: {
            lt: payment.assignedAt,
            gte: new Date(input.occurredAt.getTime() - this.options.ambiguityMs - 60_000),
          },
        },
        select: { assignedAt: true },
      });
      if (preceding.some(p => p.assignedAt && couldBelongToEarlierPayment(
        p.assignedAt.getTime(), input.occurredAt.getTime(), this.options.ambiguityMs,
      ))) return reviewed('PRIOR_SAME_CARD_AND_AMOUNT', payment.number);

      // Compare-and-set: the payment must still be AWAITING; a transaction links to one payment only.
      const claimed = await tx.payment.updateMany({ where: { id: payment.id, status: 'AWAITING' }, data: {
        status: 'MATCHED_UNVERIFIED', matchedAt: now, matchedTransactionId: incoming.id,
      } });
      if (claimed.count !== 1) return reviewed('PAYMENT_STATE_CHANGED', payment.number, undefined, [payment.id]);
      await record(tx, {
        paymentId: payment.id, action: 'MATCHED_UNVERIFIED', fromStatus: 'AWAITING', toStatus: 'MATCHED_UNVERIFIED',
        incomingTransactionId: incoming.id, details: { source: input.source, signalOnly: true },
      });
      await tx.incomingTransaction.update({ where: { id: incoming.id }, data: {
        status: 'MATCHED_UNVERIFIED', matchedPaymentId: payment.id,
      } });
      if (payment.orderId) {
        await tx.order.updateMany({
          where: { id: payment.orderId, status: 'PAYMENT_PENDING' },
          data: { status: 'PAYMENT_MATCHED_UNVERIFIED' },
        });
      }
      await this.setCooldown(tx, card.id, input.amountTiyin, now, this.options.matchCooldownMs ?? this.options.cooldownMs);
      return { status: 'MATCHED_UNVERIFIED', paymentNumber: payment.number } as MatchResult;
    });
    if (result.status === 'MATCHED_UNVERIFIED') {
      this.log(`[✅ MATCH] P${String(result.paymentNumber).padStart(4, '0')} | ${formatSom(input.amountTiyin)} | ***${input.cardLast4} | MATCHED_UNVERIFIED (BANK TASDIG‘I EMAS)`);
    } else if (result.status === 'DUPLICATE') {
      this.log(`[DUPLICATE] ${input.sourceId} | ikkinchi marta ishlanmadi`);
    } else {
      this.log(`[⚠ REVIEW_REQUIRED] ${result.reason} | ${formatSom(input.amountTiyin)} | ***${input.cardLast4} | ${input.sourceId}`);
    }
    return result;
  }

  async ingestMock(amountTiyin: bigint, cardLast4: string, secondsAgo = 0): Promise<MatchResult> {
    allowedMoney(amountTiyin);
    if (!Number.isInteger(secondsAgo) || secondsAgo < 0 || secondsAgo > 86400) throw new Error('Sekundlar 0–86400 bo‘lsin.');
    return this.ingest({
      sourceId: `mock:${randomUUID()}`, source: 'MOCK', cardLast4, amountTiyin,
      occurredAt: new Date(Date.now() - secondsAgo * 1000),
      minutePrecision: false, trustedSender: true,
    });
  }

  async markGmailIgnored(gmailId: string, reason: string): Promise<void> {
    await this.db.gmailIngestion.upsert({
      where: { gmailId }, create: { gmailId, reason, status: 'IGNORED' }, update: {},
    });
    this.log(`[⚠ GMAIL IGNORED] ${gmailId}: ${reason}`);
  }
  async ingestGmail(gmailId: string, incoming: Omit<Incoming, 'sourceId' | 'source'>): Promise<MatchResult> {
    const result = await this.ingest({ ...incoming, sourceId: `gmail:${gmailId}`, source: 'GMAIL' });
    await this.db.gmailIngestion.upsert({
      where: { gmailId }, create: { gmailId, status: result.status, reason: result.reason },
      update: { status: result.status, reason: result.reason },
    });
    return result;
  }
  /**
   * A credit read from the Humocard Telegram bot chat. `messageKey` is stable per Telegram message (`<chatId>:<messageId>`), so a restart that
   * re-reads recent history, or a second listener, can never match the same message twice (IncomingTransaction.sourceId is unique).
   * `messageDate` is when Telegram delivered it (the analogue of the e-mail date: it feeds the delay and "before the payment existed" checks).
   * `trustedSender` must be true only when the listener has verified that the message came from the configured Humocard bot account.
   */
  async ingestHumo(messageKey: string, incoming: Omit<Incoming, 'sourceId' | 'source' | 'emailReceivedAt'> & { messageDate: Date }): Promise<MatchResult> {
    const { messageDate, ...rest } = incoming;
    return this.ingest({ ...rest, emailReceivedAt: messageDate, sourceId: `humo:${messageKey}`, source: 'HUMO_TG' });
  }
  async seenHumo(messageKeys: string[]): Promise<Set<string>> {
    const rows = await this.db.incomingTransaction.findMany({ where: { sourceId: { in: messageKeys.map(k => `humo:${k}`) } }, select: { sourceId: true } });
    return new Set(rows.map(r => r.sourceId.slice('humo:'.length)));
  }
  async seenGmail(gmailIds: string[]): Promise<Set<string>> {
    const [processed, incoming] = await Promise.all([
      this.db.gmailIngestion.findMany({ where: { gmailId: { in: gmailIds } }, select: { gmailId: true } }),
      this.db.incomingTransaction.findMany({ where: { sourceId: { in: gmailIds.map(x => `gmail:${x}`) } }, select: { sourceId: true } }),
    ]);
    return new Set([...processed.map(x => x.gmailId), ...incoming.map(x => x.sourceId.slice('gmail:'.length))]);
  }

  async listPayments(limit = 25): Promise<Array<Payment & { card: Card | null }>> {
    return this.db.payment.findMany({ orderBy: { number: 'desc' }, take: limit, include: { card: true } });
  }
  async listReviews(limit = 30) {
    return this.db.incomingTransaction.findMany({ where: { status: 'REVIEW_REQUIRED' }, orderBy: { receivedAt: 'desc' }, take: limit });
  }
  async status() {
    const [byStatus, byCard, cards, reviews] = await Promise.all([
      this.db.payment.groupBy({ by: ['status'], _count: { _all: true } }),
      this.db.payment.groupBy({ by: ['cardId'], where: { status: 'AWAITING' }, _count: { _all: true } }),
      this.db.card.findMany({ orderBy: { last4: 'asc' } }),
      this.db.incomingTransaction.count({ where: { status: 'REVIEW_REQUIRED' } }),
    ]);
    return { byStatus, byCard, cards, reviews };
  }

  /** Test-only cards/payments: no real Gmail event can be assigned to them. */
  async runStress(count: number): Promise<{ count: number; awaiting: number; queued: number; seconds: number; collisions: number }> {
    if (!Number.isInteger(count) || count < 1 || count > 1000) throw new Error('stress 1–1000');
    const last4s = ['9091', '9092', '9093', '9094'];
    for (const last4 of last4s) await this.addCard(last4, true);
    const before = Date.now();
    const created: Payment[] = [];
    const silent = new PaymentEngineV3(this.db, this.options, () => {});
    for (let i = 0; i < count; i += 20) {
      const batch = Array.from({ length: Math.min(20, count - i) }, (_, j) =>
        silent.createPayment(BigInt(10_000 + ((i + j) % 12) * 1_000) * 100n, true, true));
      created.push(...await Promise.all(batch));
    }
    const ids = created.map(p => p.id);
    const payments = await this.db.payment.findMany({ where: { id: { in: ids } } });
    const active = await this.db.payment.findMany({ where: { isTest: true, status: 'AWAITING' } });
    const used = new Set<string>();
    let collisions = 0;
    for (const p of active) {
      const key = `${p.cardId}:${p.amountTiyin.toString()}`;
      if (used.has(key)) collisions++;
      used.add(key);
    }
    const result = {
      count, awaiting: payments.filter(p => p.status === 'AWAITING').length,
      queued: payments.filter(p => p.status === 'QUEUED').length,
      seconds: (Date.now() - before) / 1000, collisions,
    };
    this.log(`[STRESS] ${count} parallel yuborilgan buyurtma | ${result.awaiting} AWAITING | ${result.queued} QUEUED | to‘qnashuvlar: ${collisions} | ${result.seconds.toFixed(2)}s`);
    if (collisions !== 0) throw new Error('QATʼIY INVARIANT BUZILDI!');
    return result;
  }

  async clearStressData(): Promise<void> {
    // Deletes ONLY stress-generated payments; user-created mock orders remain intact.
    await this.locked(async tx => {
      await tx.payment.deleteMany({ where: { isStress: true } });
      for (const last4 of ['9091', '9092', '9093', '9094']) {
        const card = await tx.card.findUnique({ where: { last4 } });
        if (card?.isTest && (await tx.payment.count({ where: { cardId: card.id } })) === 0) {
          await tx.card.delete({ where: { id: card.id } });
        }
      }
    });
    this.log('[STRESS CLEAN] Faqat stress-test yozuvlari o‘chirildi.');
  }
}
