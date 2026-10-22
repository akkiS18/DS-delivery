# Stage 5A — Restaurant authentication API (for the Android APK)

Backend only. The Android app, support, taxi, payment (4A/4B) and Telegram logic are untouched. Nothing here was compiled, run or migrated; **not production-ready** (see limitations).

## Features
- `POST /api/v1/restaurant/auth/login`, `POST …/auth/logout`, `GET …/auth/me` (Fastify plugin registered under `/api/v1/restaurant`).
- One shared login per restaurant: **login = restaurant `slug` + password**. Passwords are stored only as **Argon2id** hashes (Node's built-in `crypto.argon2`, 19 MiB / 2 passes / 1 lane, random 16-byte salt, PHC string). No dependency was added. **Requires Node.js ≥ 24.7** (`package.json` still says `>=20.12`; hashing fails with `ARGON2_UNAVAILABLE` on older Node).
- No default passwords, no public registration, no seeding. Credentials exist only after an operator runs the provisioning CLI.
- Server-side sessions: random 256-bit bearer token, **only its SHA-256 is stored**, absolute expiry (`RESTAURANT_SESSION_HOURS`, default 12), revocable, capped per restaurant (`RESTAURANT_MAX_SESSIONS`, default 10; oldest revoked, race-safe via an advisory lock).
- Every protected request re-checks: token well-formed → session exists, not revoked, not expired → issued under the **current `passwordVersion`** → restaurant `isActive`. Changing a password bumps the version and revokes all sessions.
- Tenant isolation: the restaurant comes only from the session (`requireRestaurantSession`). Body/query/header restaurant ids are never read. First scoped resource: `GET /api/v1/restaurant/orders/:id` (read-only; `restaurantId` is part of the SQL filter; another restaurant's order is a plain 404).
- Login protection: zod validation (strict body), DB-backed throttling per slug (default 5 failures / 15 min) and per IP (30), counted under an advisory lock **before** the password is checked (parallel guessing cannot exceed the limit). Unknown slug, missing credential and wrong password return the same 401 and cost the same (dummy Argon2 verification). Passwords/tokens are never logged; responses carry `Cache-Control: no-store`. Attempt rows hold only hashes of slug/IP.
- The internal API key (`x-internal-api-key`) is unrelated to this API and is never sent to or accepted from the APK (it gets 401 here).

## API contract (JSON, UTF-8)
Base: `https://<host>/api/v1/restaurant` (plain `http://` only for local development; Android emulator → host is `10.0.2.2`).
Protected calls send `Authorization: Bearer <accessToken>` (exactly this form; one header).

### POST /auth/login
Request: `{ "slug": "my-restaurant", "password": "…" }` — `slug` `^[a-z0-9-]{2,40}$`, `password` 1–200 chars, **no other fields**.
200:
```json
{ "accessToken": "43-char-url-safe-token", "tokenType": "Bearer", "expiresAt": "2026-10-21T20:00:00.000Z",
  "restaurant": { "id": "ckx…", "slug": "my-restaurant", "name": "My Restaurant", "isPaused": false } }
```
Errors (all `{ "error": "<CODE>" }`):
| Status | error | Meaning |
|---|---|---|
| 400 | `Validation failed` (+`details`) | malformed/missing/extra fields |
| 401 | `INVALID_CREDENTIALS` | wrong slug, wrong password or no credential (indistinguishable) |
| 403 | `RESTAURANT_INACTIVE` | correct credentials but the restaurant is deactivated |
| 429 | `TOO_MANY_ATTEMPTS` (+`retryAfterSeconds`, `Retry-After` header) | throttled; even a correct password is refused until the window passes |

### GET /auth/me
200: `{ "restaurant": { "id", "slug", "name", "isPaused" }, "session": { "expiresAt": "ISO-8601" } }`
Use it at app start to validate a stored token.

### POST /auth/logout
No body. **204** (empty) and the session is revoked server-side. Repeating it with the same token → 401.

### GET /orders/:id
200: `{ id, number, status, totalSom, createdAt, estimatedPrepMinutes, items:[{name,unitSom,quantity,subtotalSom}], payment:{status}|null }`; 404 `NOT_FOUND` for unknown **or other restaurants'** orders.

### Common errors on protected routes
401 `UNAUTHENTICATED` (missing/malformed/unknown/revoked/expired token, or password changed) → clear the stored token and show login. 403 `RESTAURANT_INACTIVE` → show "account disabled", do not retry. 404 `NOT_FOUND`. There are **no refresh tokens**: after `expiresAt` the user logs in again.

### Notes for the Android agent
Keep the token in Keystore-backed storage (e.g. EncryptedSharedPreferences), never in logs, and send it only in the header. Do not embed any server key. Treat 401 on any call as "logged out". Honour `Retry-After` on 429. Order mutations (accept/reject/verify payment/preparing/ready) are **not** exposed yet; they still happen in the Telegram staff bot and need their own endpoints with the same session guard (and the Stage 4A/4B CAS rules) in a later stage.

## Environment variables (all optional)
| Variable | Default | Range |
|---|---|---|
| `RESTAURANT_SESSION_HOURS` | 12 | 1–720 |
| `RESTAURANT_MAX_SESSIONS` | 10 | 1–100 |
| `RESTAURANT_LOGIN_MAX_FAILURES` | 5 | 1–100 (per slug per window) |
| `RESTAURANT_LOGIN_IP_MAX_FAILURES` | 30 | 1–1000 |
| `RESTAURANT_LOGIN_WINDOW_MINUTES` | 15 | 1–1440 |
Invalid values throw on the first login. Existing `DATABASE_URL`, `INTERNAL_API_KEY` are still required. Passwords never go in `.env`.

## Credential provisioning (explicit, local)
```sh
npm run restaurant:password -- <restaurant-slug>             # first password; hidden prompt, asked twice
npm run restaurant:password -- <restaurant-slug> --replace   # change it: bumps passwordVersion, revokes ALL sessions
```
Policy: 12–200 characters, ≥ 5 distinct characters, must not contain the slug. An existing password is **never** replaced without `--replace`; nothing runs automatically or at startup. The password is never a CLI argument and is never printed (`RESTAURANT_PASSWORD` env var is accepted for scripted use). Share it with the restaurant through a secure channel.

## Migration (`prisma/migrations/20261021000100_restaurant_auth`, **not executed**)
Three new tables only: `RestaurantCredential` (unique per restaurant, CHECK hash starts with `$argon2id$`), `RestaurantSession`, `RestaurantLoginAttempt`; all cascade with the restaurant. No data is inserted. Also in `schema.prisma`: back-relations on `Restaurant` (no column change). Apply after the earlier pending migrations (Stage 3, 4A, 4B).

## Test commands (none run by me)
```sh
npm run db:generate
npm run db:migrate
npm run typecheck
npm run test:auth       # pure: Argon2id hash/verify, malformed hashes, policy, bearer parsing, throttle rule, config
npm run test:auth:db    # DB + HTTP (Fastify inject): login ok/bad, identical failures, validation, 401s, expiry, logout,
                        # inactive restaurant, password change, cross-restaurant isolation, concurrent logins/logouts, rate limiting
```
The DB test creates three uniquely named restaurants and removes only its own rows.

## Security limitations / open items
- **Shared password**: no per-user identity, no individual revocation, no audit of *who* acted. Anyone holding it is the restaurant. Rotate with `--replace`.
- Throttling is per slug and per IP: an attacker can lock a restaurant out of login (denial of service) by spamming wrong passwords; IP limits help only if `request.ip` is the real client — behind a reverse proxy configure Fastify `trustProxy` first (not done here), otherwise all clients share one IP.
- No TLS in this app: it must sit behind HTTPS. A stolen bearer token works until logout/expiry/password change; there is no device binding, refresh rotation or token revocation list beyond the session table.
- No 2FA, password-reset flow, or password-change endpoint (operator CLI only). `lastSeenAt` is updated at most once a minute.
- Authentication is not yet wired to any state-changing restaurant operation; Telegram staff authorization remains the only path for accept/reject/verify.
- Argon2id runs on Node's thread pool with ≤ 4 concurrent hashes; a flood of distinct slugs from many IPs can still consume CPU/memory.
- Requires Node ≥ 24.7; `engines` was intentionally not changed here.
- Rows in `RestaurantLoginAttempt` older than 24 h are pruned opportunistically at login; expired sessions are kept (not pruned).
- Not compiled or executed; expect typecheck nits after `db:generate`.
