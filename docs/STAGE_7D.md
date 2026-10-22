# Stage 7D — no price-change workflow; refund proof is one receipt photo

Owner decisions (2026-10-22/23): (1) "a price change at order time does not exist at all — it slipped into the plan by mistake"; (2) "the refund part must ask only for the receipt photo".

## 1. Price-change / customer-consent workflow: removed

There is no business case for the restaurant re-pricing an order or the customer consenting to a new price. Since Stage 6F prices are validated and frozen **before** payment and `proposePriceRevision` already refused unless a test flag was set; this stage deletes what was left.

Removed:
- `src/modules/restaurant/price-consent.ts` (+ its unit test): `proposePriceRevision`, `respondToRevision`, `expireConsents`, `buildRevision`, `PRICE_CONSENT_SECONDS`, `LEGACY_PRICE_PROPOSALS`.
- `src/bot/price-consent.ts` (customer "yes/no" buttons); the restaurant bot's "propose price" button; the consent notifier block and the consent sweep in `restaurant-notify.ts`.
- Restaurant API: the `POST /orders/:id/propose-price` stub (was 410, now 404); the `priceChange` / `priceProposal` fields and the `PRICE_CHANGED` attention code of the order view; `canProposePrice` in the "order problems" answer. Android restaurant app: the proposal banner and its DTO/model fields.

Kept on purpose:
- **Checkout protection** `409 NARX_OZGARGAN` (`expectedTotalSom`, issue `PRICE_CHANGED` in the quote): it only refuses an order whose displayed price is stale; the customer sees the current price and decides again. Removing it would charge a price the customer never saw.
- Legacy accept-first flow (`RESTAURANT_MANUAL_ACCEPTANCE`, default off): a stale price is a *menu problem* — the order can only be rejected. Covered by a new test.
- `cancelWaitingOrder` (moved to `src/modules/restaurant/waiting-cancel.ts`, `src/bot/order-cancel.ts`) so a customer can still cancel a waiting order; it still closes an old row in the inert status `WAITING_CUSTOMER_CONSENT`.
- **Database objects are untouched**: table `OrderPriceRevision`, enum value `WAITING_CUSTOMER_CONSENT`, migration `20261020000100_price_consent_cancel`. Dropping them would need a destructive migration for no benefit; nothing writes to them any more.

## 2. Refund proof = one receipt photo (no typed bank reference)

Flow: customer cancels a paid order (or the restaurant cancels) → refund `REQUESTED/APPROVED` → restaurant presses **"Pul qaytarildi"** and attaches **one photo of the bank receipt** → refund `SENT` → customer/admin attests (`CONFIRMED`/`DISPUTED`) exactly as before. `SENT` is still only the restaurant's claim; the restaurant can never confirm itself.

| Area | Change |
|---|---|
| Migration `20261030000100_refund_receipt` | 4 nullable columns on `RefundRequest` (`receiptKey/Mime/Bytes/Sha256`); the old CHECK "sent needs a typed reference" is replaced by one that accepts a typed reference **or** a receipt (so every legacy row stays valid); a receipt-integrity CHECK (all-or-none, key shape, `image/jpeg|png|webp`, 1 KiB–5 MiB, 64-hex SHA-256); partial unique index on `receiptSha256` (one image cannot prove two refunds). The only DROP is the replaced CHECK. Applied to the local test DB for the tests. |
| `src/modules/refunds/receipts.ts` | Magic-byte sniffing (JPEG/PNG/WebP; the client's `Content-Type`/filename are never trusted), 1 KiB–5 MiB, atomic write (temp + rename, mode 600) to `RECEIPT_DIR` (default `<cwd>/data/receipts`, `/app/data/receipts` in the image), random UUID names, path-injection-proof reads. No image library, no new dependency. |
| `markRefundSent` | Takes a stored `receipt` instead of `bankReference`; same CAS/authorisation/audit; `CHEK_RASMI_TAKROR` for a reused image (also from the unique index); after a dispute a **different** photo is required; the audit event records SHA-256, size and type — not the image. |
| Restaurant API | `POST /api/v1/restaurant/orders/:id/refund/receipt?expectedStatus=` with the **raw image as the body** (`image/jpeg|png|webp`, ≤ 5 MiB). Authentication runs **before** the body is read; a refused request removes the stored file; tenant-scoped (foreign order = 404). Replaces `refund/sent` (JSON, now 404). Order view: `refund.hasReceipt`. |
| Customer API | `GET /api/v1/miniapp/orders/:id/refund/receipt` → `{mime, dataBase64, sentAt}`, owner only (guest or Telegram), only once the refund is `SENT/CONFIRMED/DISPUTED`; foreign/unknown/not-sent = 404; rate-limited. Order view: `refund: {status, hasReceipt}`. |
| Mini App / Android customer app | "Qaytarish chekini ko'rish" button shows the photo (data URL; the CSP already allows `data:` images). |
| Restaurant Android app | The typed-reference dialog is replaced by a photo picker; the image is decoded with a sample size, EXIF-rotated, scaled to ≤ 1800 px and re-encoded as JPEG ≤ ~3 MB before upload. Also: a saved server address is honoured only if it was saved by a build with the **same default address** (an old LAN/tunnel address can no longer override a staging/release build). Debug default overridable with `-PdsDebugApiBaseUrl=`. |
| Legacy Telegram refund panel (off by default) | The typed reference prompt is gone; the "sent" button tells the restaurant to upload the photo in the app. Customer/admin messages no longer print a reference. |
| Deploy | `Dockerfile` creates `/app/data/receipts` owned by `node` and sets `RECEIPT_DIR`; both compose files mount a named volume `receipts` there (root filesystem stays read-only). `backup-db.sh` archives the volume next to every dump (`receipts-<ts>-<label>.tar` + SHA-256, 14 kept) and `pull-backups.ps1` copies and verifies those archives too. **Receipts are NOT in `pg_dump`**: a restore needs both halves. `restore-check.sh` still checks the database only. |

## 3. Tests

Run locally on `ds_delivery_test` (Windows, Node 24, PostgreSQL 18) after applying the new migration: `tsc` clean (backend and both front ends); unit: `npm test` 15, `test:deploy` 16, `test:restaurant` 6, `test:taxi` 11, `test:acceptance` 3, **`test:refunds` 10 (incl. 3 new receipt tests)**; DB: **`test:refunds:db` 14, `test:orders:db` 11, `test:checkout6f:db` 12, `test:miniapp:db` 14 (new receipt-visibility test)**, `test:acceptance2:db` 8, `test:acceptance:db` 10, `test:finance:db` 10, `test:auth:db` 13, `test:telegram:db` 9, `test:catalog:db` 15, `test:qa:db` 18, `test:taxi:db` 13, `test:payment:safety` 10, `test:support:db` 8, `test:operations:db` 6, `test:taxi:recovery:db` 7; Mini App `vitest` 46. New coverage: magic bytes, size limits, path injection, atomic store/discard, unauthenticated upload (401 before reading), non-image / too-small / JSON / > 5 MB bodies (400/413), foreign restaurant (404) leaving no file behind, second upload after `SENT` (409, file removed), same image for two refunds (blocked), DB CHECKs (all-or-none receipt fields, bad type/size, legacy typed reference still valid), customer receipt visibility (owner only, not before `SENT`, exact bytes, no storage key leaked).

**Not run:** the restaurant app on a device (the photo picker, EXIF handling and JPEG upload compile — `assembleDebug` passes — but were never executed), the Mini App button in a browser/Telegram, Docker/volume ownership on the VPS (checked after the deploy, see the staging notes), the full Windows suites not listed above (`test:qa:ui`, `test:qa:process`, the remaining stage suites).

## 4. Known limits / follow-ups

- A photo is evidence of a claim, not bank verification (the platform has no bank access): the customer/admin attestation stays the real control.
- Receipts contain personal/bank data: they are kept on the volume (not in Git, not in an image), served only to the order's customer, and included in the private backups. No retention/deletion policy yet (decide before production).
- No server-side image re-encoding (no library): the file is stored as uploaded after magic-byte/size checks and is only ever returned as base64 JSON with its sniffed type.
- `validateBankReference` (`refunds/workflow.ts`) is now unused by the app and kept only for its tests/legacy rows.

## 5. Staging deployment and verification (2026-10-22, evening)

Package **`35386fd447a4`** (219 files; previous `be82dc80480f` is the rollback target). `release.sh deploy`: pre-migration dump → `20 migrations found`, **`20261030000100_refund_receipt` applied** (no pending afterwards) → backend healthy. Volume `ds-staging_receipts` is mounted at `/app/data/receipts`, owned by `node` (uid 1000) and writable, while the root filesystem stays read-only.

End-to-end over public HTTPS with `scripts/smoke-staging-receipt.mjs` against a **throwaway restaurant** (`zz-smoke-receipt`, created only for this check, password known only to the operator, now `isActive=false` and its sessions deleted; one test order/refund remain in history): guest order → MOCK payment → restaurant cancels the paid order (refund `APPROVED`) → anonymous upload 401 → non-image 400 → > 5 MB 413 → JPEG accepted, refund `SENT`, `hasReceipt: true`, `bankReference: null` → second upload 409 → customer sees `hasReceipt` and receives the **exact bytes** → another customer gets 404. **14/14 PASS.** `backup-db.sh` now also wrote `receipts-<ts>-<label>.tar` (+ SHA-256) and the Windows pull job copied and verified it.

Builds (debug, staging URL): `DS-backups\apk\ds-customer-staging-debug-20261022-1954-receipt.apk` (SHA-256 `094E2713…3781`) and `DS-backups\apk\ds-restaurant-staging-debug-20261022-1954-receipt.apk` (SHA-256 `4FCC1B8A…62AA`). The restaurant APK was compiled from the repo (`apps/restaurant-android`) with `-PdsDebugApiBaseUrl=https://staging.sultonxoja.uz/`. **No APK was run on a device**; the photo picker / EXIF / upload path on a real phone is the first thing to test.
