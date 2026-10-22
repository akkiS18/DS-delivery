export const DEFAULT_LEAD_MINUTES = 7;
export const DEFAULT_OPERATOR_TIMEOUT_SECONDS = 180;

/** Call taxi leadMinutes before the expected food readiness, never before prep start. */
export function calculateTaxiDueAt(preparingStartedAt: Date, prepMinutes: number, leadMinutes: number): Date {
  if (!Number.isInteger(prepMinutes) || prepMinutes <= 0 || prepMinutes > 240) throw new Error('INVALID_PREP_MINUTES');
  if (!Number.isInteger(leadMinutes) || leadMinutes < 0 || leadMinutes > 120) throw new Error('INVALID_TAXI_LEAD');
  return new Date(preparingStartedAt.getTime() + Math.max(0, prepMinutes - leadMinutes) * 60_000);
}
export type OperatorAction = 'ACCEPT' | 'SENT' | 'NO_TAXI';
export type CurrentTaxiStatus = 'SCHEDULED' | 'SENDING' | 'REQUESTED' | 'ACCEPTED' | 'CANCELLATION_PENDING' | 'ASSIGNED' | 'DECLINED' | 'NEEDS_HELP' | 'DELIVERED' | 'CANCELLED';

/**
 * A booking notification (REQUESTED) is not an accepted booking (ACCEPTED), an accepted booking is not a dispatched taxi
 * (ASSIGNED = "Taksi yuborildi"), and a dispatched taxi is not a completed delivery (DELIVERED, see completeDelivery).
 *  - ACCEPT   : only from a fresh request.
 *  - SENT     : only after the company accepted; or to clear up an unanswered/uncertain request (the driver may already
 *               have been sent), never straight from an unanswered notification.
 *  - NO_TAXI  : any open state the operator can still answer.
 */
export function operatorTransition(status: CurrentTaxiStatus, action: OperatorAction): 'ACCEPTED' | 'ASSIGNED' | 'DECLINED' {
  if (action === 'ACCEPT') {
    if (status !== 'REQUESTED') throw new Error('TAKSI_SOROVI_ESKIRGAN');
    return 'ACCEPTED';
  }
  if (action === 'SENT') {
    if (status !== 'ACCEPTED' && status !== 'CANCELLATION_PENDING' && status !== 'NEEDS_HELP') throw new Error('TAKSI_SOROVI_ESKIRGAN');
    return 'ASSIGNED';
  }
  if (status !== 'REQUESTED' && status !== 'ACCEPTED' && status !== 'CANCELLATION_PENDING' && status !== 'NEEDS_HELP') throw new Error('TAKSI_SOROVI_ESKIRGAN');
  return 'DECLINED';
}

/** Operator-visible progress of the latest dispatch, shared by the Telegram taxi bot and the restaurant app. */
export type TaxiStage = 'SCHEDULED' | 'REQUESTED' | 'ACCEPTED' | 'DISPATCHED' | 'DELIVERED' | 'NEEDS_HELP' | 'CANCELLED';
export function taxiStage(status: string): TaxiStage {
  switch (status) {
    case 'SCHEDULED': return 'SCHEDULED';
    case 'SENDING': case 'REQUESTED': return 'REQUESTED';
    case 'ACCEPTED': return 'ACCEPTED';
    case 'ASSIGNED': return 'DISPATCHED';
    case 'DELIVERED': return 'DELIVERED';
    case 'CANCELLED': return 'CANCELLED';
    default: return 'NEEDS_HELP'; // DECLINED, CANCELLATION_PENDING, NEEDS_HELP
  }
}

/** Never fallback without explicit agreement; no response is NOT a 'no taxi' reply. */
export function canFallback(allowedByCustomer: boolean, explicitNoTaxi: boolean): boolean {
  return allowedByCustomer && explicitNoTaxi;
}

export function needsCancellationAcknowledgement(status: string, responseDeadline: Date | null, now: Date): boolean {
  return status === 'REQUESTED' && !!responseDeadline && responseDeadline.getTime() <= now.getTime();
}
