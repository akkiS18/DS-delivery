/** Who performs a restaurant order action. Telegram staff are identified by their linked Telegram id; the restaurant app
 *  (Bearer session) by the restaurant id taken from that session, never from a request body; `actorSystemId` is the
 *  built-in MOCK automation (takeStaffAction restricts it to test payments/orders only). */
export type StaffActor =
  | { actorTelegramId: string; actorRestaurantId?: undefined; actorSystemId?: undefined }
  | { actorRestaurantId: string; actorTelegramId?: undefined; actorSystemId?: undefined }
  | { actorSystemId: string; actorTelegramId?: undefined; actorRestaurantId?: undefined };

/** Value stored in the audit columns (acceptedBy, OrderEvent.actorTelegramId, ...). */
export function actorLabel(a: StaffActor): string {
  if (a.actorSystemId !== undefined) return `system:${a.actorSystemId}`;
  return a.actorRestaurantId !== undefined ? `restaurant-api:${a.actorRestaurantId}` : a.actorTelegramId;
}

/** 'APP' | 'TELEGRAM' | 'SYSTEM' - the channel recorded in audit details. */
export const actorChannel = (a: StaffActor): 'APP' | 'TELEGRAM' | 'SYSTEM' =>
  a.actorSystemId !== undefined ? 'SYSTEM' : a.actorRestaurantId !== undefined ? 'APP' : 'TELEGRAM';

/** Prisma filter on the order's restaurant relation that only matches the acting restaurant. */
export function restaurantScope(a: StaffActor): { id: string } | { staffTelegramUserId: string } | Record<string, never> {
  if (a.actorSystemId !== undefined) return {};
  return a.actorRestaurantId !== undefined ? { id: a.actorRestaurantId } : { staffTelegramUserId: a.actorTelegramId };
}

export function isActorOf(restaurant: { id: string; staffTelegramUserId: string | null }, a: StaffActor): boolean {
  if (a.actorSystemId !== undefined) return true; // callers must restrict what the system actor may do
  return a.actorRestaurantId !== undefined
    ? restaurant.id === a.actorRestaurantId
    : restaurant.staffTelegramUserId === a.actorTelegramId;
}
