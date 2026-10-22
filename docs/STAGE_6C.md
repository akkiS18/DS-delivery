# Stage 6C — Operations fix + Restaurant Orders API

## Operations (B4 / B6)
- B4: the Android build that was tested still had `updateWorkingHours` hard-coded to return "API not implemented"
  (see the `DS-Gemini-after-Stage4` / `-after-ClaudeReview` backups). The backend endpoint
  `PUT /api/v1/restaurant/operations/working-hours` existed; the repository now calls it, validates HH:MM and
  open < close in the dialog (same rule as the server), and rolls back the UI if the server rejects the write.
- B6: migration `20261025000100_restaurant_operations` is applied to `ds_delivery_test` (columns `workingHours jsonb`,
  `defaultPrepMinutes integer default 25`). The running Prisma Studio process was started before that migration
  finished, so it kept the old schema. Restart Studio (`npx prisma studio`) with `DATABASE_URL` pointing at
  `ds_delivery_test`.
- Working hours are stored and shown only. They do **not** restrict ordering (behaviour unchanged);
  `isPaused` is still the only switch that refuses new orders.

## Orders API (`/api/v1/restaurant`, Bearer session; restaurant id comes from the session only)
| Method | Path | Notes |
| --- | --- | --- |
| GET | `/orders?filter=all\|incoming\|inProgress\|ready\|history&limit=1..50&cursor=<number>` | keyset by order number desc; returns `orders`, `nextCursor`, `counts` |
| GET | `/orders/:id` | superset of the 5A view: items, payment, taxi dispatch state, customer, address, `allowedActions` |
| POST | `/orders/:id/accept` `{prepMinutes}` | `acceptOrder` (creates the single payment attempt) |
| POST | `/orders/:id/reject` `{reason}` | `rejectOrder`; the existing notifier tells the customer |
| POST | `/orders/:id/preparing` `{prepMinutes}` | `takeStaffAction(START_PREPARING)` → schedules taxi (no send) |
| POST | `/orders/:id/ready` `{}` | `takeStaffAction(MARK_READY)` |

All bodies are strict (a client `restaurantId` is a 400). Optional `expectedStatus` makes a stale tap a 409.
Errors: 404 `NOT_FOUND` (also for another restaurant's order), 409 `STALE` / `INVALID_STATE` / `TIMED_OUT` /
`RESTAURANT_CLOSED` / `ORDER_PROBLEMS`, 400 validation.

Design: the Telegram services take a `StaffActor` (`actorTelegramId` or `actorRestaurantId`, `restaurant/actor.ts`).
The app is audited as `restaurant-api:<restaurantId>` in `OrderEvent`/`acceptedBy`/`rejectedBy`. App actions leave
`staffLastNotifiedStatus` unset so the linked Telegram staff still get the new state.

## Not exposed on purpose
- Payment verification (`VERIFY_PAYMENT`): Telegram staff only; `takeStaffAction` refuses the app actor.
- Price-change proposals (customer consent): accept returns `ORDER_PROBLEMS` with `canProposePrice`; use Telegram.
- Delivery completion (Stage 7A) and automatic bank confirmation: not implemented.

## Checks
`npm run typecheck`, `npm run test:orders:db`, `test:operations(:db)`, `test:auth:db`, `test:catalog:db`,
`test:acceptance`, `test:refunds`, `test:finance`, plus the `src/tests/*.db.test.ts` set — all against
`ds_delivery_test` only (`INTERNAL_API_KEY` supplied via the shell, not `.env`).
