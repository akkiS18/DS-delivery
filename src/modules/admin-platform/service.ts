import { loadFeeConfig } from '../pricing/config.js';
import { cashEnabled, cashMaxOrderSom } from '../payment/method.js';
import { paymentsPanel, type PaymentsPanel } from '../platform/settings.js';
import { loadTaxiMode, type TaxiDispatchMode } from '../taxi/mode.js';
import { REASON_LABEL, platformRatingsOverview, rankingEnabled, type PlatformRatingsOverview } from '../ratings/service.js';
import type { FeeMode } from '../pricing/fee.js';
import { supportAdminIds } from '../support/service.js';
import { sendToAdmin } from '../admin-auth/messenger.js';

/**
 * DS Admin app, stage A3: platform settings, restaurants, commission. Reads are assembled here; every change goes through the
 * existing audited service that the Telegram command uses (setRealPaymentsOpen, setCashEnabled, setFeeMode, setTaxiMode, ...).
 */
export interface SettingsSnapshot {
  payments: PaymentsPanel;
  cash: { enabled: boolean; maxOrderSom: number };
  fee: { mode: FeeMode; percentBp: number };
  taxiMode: TaxiDispatchMode;
  ranking: { enabled: boolean };
}

export async function settingsSnapshot(env: NodeJS.ProcessEnv = process.env): Promise<SettingsSnapshot> {
  const [payments, cash, fee, taxiMode, ranking] = await Promise.all([paymentsPanel(env), cashEnabled(), loadFeeConfig(), loadTaxiMode(), rankingEnabled()]);
  return {
    payments, cash: { enabled: cash, maxOrderSom: cashMaxOrderSom(env) },
    fee: { mode: fee.mode, percentBp: fee.percentBp }, taxiMode, ranking: { enabled: ranking },
  };
}

export interface RatingsSnapshot extends PlatformRatingsOverview {
  reasonLabels: Record<string, string>;
}

export async function ratingsSnapshot(adminId: string): Promise<RatingsSnapshot> {
  return { ...(await platformRatingsOverview({ adminId })), reasonLabels: REASON_LABEL };
}

/**
 * Tells the administrators on Telegram that something important was changed from the app (the app is a second door: the bot chat is the
 * place where a change nobody expected shows up). Best effort: a failed message never fails or undoes the change.
 */
export async function notifyAdmins(html: string): Promise<void> {
  let ids: string[] = [];
  try { ids = supportAdminIds(); } catch { return; }
  await Promise.all(ids.map(id => sendToAdmin(id, html).catch(() => undefined)));
}
