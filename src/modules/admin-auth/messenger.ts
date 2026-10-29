/**
 * How the admin app reaches an administrator on Telegram (sign-in codes, "new device" notices, later the alert copies).
 * The HTTP app is built before the customer bot starts, so server.ts registers the sender once polling is up.
 * Without a registered sender nothing can be delivered and callers must treat that as a failed send.
 */
export type AdminSend = (telegramUserId: string, htmlText: string) => Promise<void>;

let sender: AdminSend | null = null;

export function setAdminMessenger(fn: AdminSend | null): void {
  sender = fn;
}

export const adminMessengerReady = (): boolean => sender !== null;

export async function sendToAdmin(telegramUserId: string, htmlText: string): Promise<void> {
  if (!sender) throw new Error('ADMIN_MESSENGER_YOQ');
  await sender(telegramUserId, htmlText);
}
