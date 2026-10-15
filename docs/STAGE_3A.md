# Stage 3A — taxi recovery and notifications

Baseline: full v0.5 archive; all 19 patch files match it byte-for-byte.

## Changes
- Interrupted/failed operator sends enter NEEDS_HELP instead of automatically resending an uncertain request.
- The original operator can confirm SENT or NO_TAXI via /taxi. Fallback still requires explicit NO_TAXI and customer consent.
- Status changes clear recipient notification markers, so a timeout message no longer suppresses the final result.
- Pending outcome notifications are selected instead of repeatedly scanning the latest already-notified outcomes.
- NEEDS_HELP/timeout/decline admin alerts are retried from persisted state.

## Local verification (not run in Work)
Use your existing configured local database and .env. Do not seed or reset an existing database.

```sh
npm install
npm run db:generate
npm run db:migrate
npm run typecheck
npm run test:taxi
npm run smoke:taxi
npm run dev
```

The smoke test uses fake Telegram transport and isolated MOCK records, then cleans up. Run it on a local development DB with the bot worker stopped. A configured TAXI_ALERT_TELEGRAM_ID is recommended for manual testing.

Manual: allow an operator request to expire; confirm SENT; verify customer/staff receive the final notice. Restart with a stale SENDING row; verify NEEDS_HELP, no second request, and /taxi recovery. Verify the first operator cannot act after fallback.

## Remaining stage 3 scope
Two-admin support claim flow, full cancellation, price consent, durable per-recipient outbox and multi-worker fencing remain. Notifications are at-least-once, not exactly-once. Run only one polling worker. Failed recipient delivery currently retries each cycle; backoff/dead-letter handling remains. This is not production approval or completion of all day-3 requirements.
