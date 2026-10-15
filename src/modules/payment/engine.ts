import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient, type Card, type Payment } from '@prisma/client';
import { couldBelongToEarlierPayment, overlapsPaymentWindow } from './matching.js';
import { formatSom } from './uzcard.js';

export type Incoming = {
  sourceId: string;
  source: 'MOCK' | 'GMAIL';
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
  ambiguityMs: number;
};
export const defaultOptions: Options = {
  paymentWindowMs: 300_000,
  queueWindowMs: 600_000,
  cooldownMs: 120_000,
  ambiguityMs: 900_000,
};
const key = (p: Payment): string => `P${String(p.number).padStart(4, '0')}`;
export const displayPayment = key;
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
      const assigned = await this.assignForAmount(tx, amountTiyin, isTest, order.restaurantId, now);
      return { order, payment, assigned };
    });
    this.printAssignments(assigned);
    if (!assigned.some(p => p.id === payment.id)) this.log(`[QUEUE] ${key(payment)} | ${formatSom(payment.amountTiyin)}`);
    return { order, payment: await this.db.payment.findUniqueOrThrow({ where: { id: payment.id } }) };
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

  private async setCooldown(tx: Prisma.TransactionClient, cardId: string, amountTiyin: bigint, at: Date): Promise<void> {
    const until = new Date(at.getTime() + this.options.cooldownMs);
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
      const orderIds = queuedOut.map(p => p.orderId).filter((id): id is string => id !== null);
      if (orderIds.length) await tx.order.updateMany({
        where: { id: { in: orderIds }, status: 'PAYMENT_PENDING' }, data: { status: 'PAYMENT_EXPIRED' },
      });
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
        },
      });
      const reviewed = async (reason: string, paymentNumber?: number): Promise<MatchResult> => {
        await tx.incomingTransaction.update({ where: { id: incoming.id }, data: { status: 'REVIEW_REQUIRED', reason } });
        return { status: 'REVIEW_REQUIRED', reason, paymentNumber };
      };
      if (input.occurredAt.getTime() > now.getTime() + 120_000) return reviewed('FUTURE_OPERATION_TIME');
      const card = await tx.card.findUnique({ where: { last4: input.cardLast4 } });
      if (!card) return reviewed('UNKNOWN_CARD');
      if (card.isTest && input.source === 'GMAIL') return reviewed('GMAIL_FOR_MOCK_CARD');
      if (!card.isTest && input.source === 'MOCK') return reviewed('MOCK_FOR_REAL_CARD');
      if (!input.trustedSender) return reviewed('UNVERIFIED_EMAIL_SENDER');
      const payment = await tx.payment.findFirst({
        where: { cardId: card.id, amountTiyin: input.amountTiyin, status: 'AWAITING' },
      });
      if (!payment || !payment.assignedAt || !payment.expiresAt) return reviewed('NO_ACTIVE_PAYMENT');
      if (input.emailReceivedAt && input.emailReceivedAt.getTime() < payment.assignedAt.getTime()) {
        return reviewed('EMAIL_ARRIVED_BEFORE_PAYMENT');
      }
      if (!overlapsPaymentWindow(
        input.occurredAt.getTime(), payment.assignedAt.getTime(), payment.expiresAt.getTime(), input.minutePrecision,
      )) return reviewed('OPERATION_OUTSIDE_WINDOW', payment.number);
      // Prior allocation of same pair: an old payer could be late; bank mail has no sender ID.
      const preceding = await tx.payment.findMany({
        where: {
          cardId: card.id, amountTiyin: input.amountTiyin,
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

      await tx.payment.update({ where: { id: payment.id }, data: {
        status: 'MATCHED_UNVERIFIED', matchedAt: now, matchedTransactionId: incoming.id,
      } });
      await tx.incomingTransaction.update({ where: { id: incoming.id }, data: {
        status: 'MATCHED_UNVERIFIED', matchedPaymentId: payment.id,
      } });
      if (payment.orderId) {
        await tx.order.updateMany({
          where: { id: payment.orderId, status: 'PAYMENT_PENDING' },
          data: { status: 'PAYMENT_MATCHED_UNVERIFIED' },
        });
      }
      await this.setCooldown(tx, card.id, input.amountTiyin, now);
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
