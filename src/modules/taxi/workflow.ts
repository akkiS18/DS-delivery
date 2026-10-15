export const DEFAULT_LEAD_MINUTES = 7;
export const DEFAULT_OPERATOR_TIMEOUT_SECONDS = 180;

/** Call taxi leadMinutes before the expected food readiness, never before prep start. */
export function calculateTaxiDueAt(preparingStartedAt: Date, prepMinutes: number, leadMinutes: number): Date {
  if (!Number.isInteger(prepMinutes) || prepMinutes <= 0 || prepMinutes > 240) throw new Error('INVALID_PREP_MINUTES');
  if (!Number.isInteger(leadMinutes) || leadMinutes < 0 || leadMinutes > 120) throw new Error('INVALID_TAXI_LEAD');
  return new Date(preparingStartedAt.getTime() + Math.max(0, prepMinutes - leadMinutes) * 60_000);
}
export type OperatorAction = 'SENT' | 'NO_TAXI';
export type CurrentTaxiStatus = 'SCHEDULED' | 'SENDING' | 'REQUESTED' | 'CANCELLATION_PENDING' | 'ASSIGNED' | 'DECLINED' | 'NEEDS_HELP';

export function operatorTransition(status: CurrentTaxiStatus, action: OperatorAction): 'ASSIGNED' | 'DECLINED' {
  if (status !== 'REQUESTED' && status !== 'CANCELLATION_PENDING' && status !== 'NEEDS_HELP') throw new Error('TAKSI_SOROVI_ESKIRGAN');
  return action === 'SENT' ? 'ASSIGNED' : 'DECLINED';
}

/** Never fallback without explicit agreement; no response is NOT a 'no taxi' reply. */
export function canFallback(allowedByCustomer: boolean, explicitNoTaxi: boolean): boolean {
  return allowedByCustomer && explicitNoTaxi;
}

export function needsCancellationAcknowledgement(status: string, responseDeadline: Date | null, now: Date): boolean {
  return status === 'REQUESTED' && !!responseDeadline && responseDeadline.getTime() <= now.getTime();
}
