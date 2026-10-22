# Stage 5B — Restaurant catalog management API

Builds on Stage 5A sessions. Support, taxi, Android, and the Stage 4A/4B payment code are untouched. Nothing here was compiled, run or migrated; **not production-ready** until the tests below have been run by you.

## Backups and Node.js 24
- Local backups (not uploaded; `.git`, `node_modules`, builds, `.env*` except `.env.example`, keys/tokens/credentials, DB dumps excluded): `C:\Users\Acer\Documents\DS-backups\DS-before-Stage5B-*.zip` (taken before any change) and `DS-after-Stage5B-*.zip` (end of stage). Both are read-only snapshots of the source; nothing was stashed, reset or cleaned.
- Backend is standardized on **Node.js 24 LTS**: `engines.node` = `>=24.7.0 <25` (needed for built-in `crypto.argon2`), `.nvmrc` = `24`, `@types/node` `^24`, TypeScript `target` `ES2024`, README updated. Argon2id was not replaced. Nothing was installed: run `nvm use` / install Node 24.7+ and `npm install` yourself. Deployment must use the same Node 24 line (Docker `node:24`, etc.).

## Authentication
All endpoints are under `/api/v1/restaurant` and need `Authorization: Bearer <accessToken>` from `POST /auth/login` (Stage 5A). The restaurant is taken **only** from the session; request bodies are strict (a `restaurantId`, `imageUrl`, `id`… in a body is a 400) and query strings/headers never choose a restaurant. A session of an inactive restaurant gets 403; missing/expired/revoked/old-password sessions get 401. Foreign resources are a plain **404** (indistinguishable from missing).

## Products
Product JSON: `{ id, name, description or null, priceSom, isAvailable, categoryId or null, imageUrl or null, archivedAt or null, version, createdAt, updatedAt }`.

| Method & path | Request | Success | Errors |
|---|---|---|---|
| `GET /products[?includeArchived=true]` | – | 200 `{ "products": [Product] }` — **includes unavailable** products; archived only with the flag | 401/403 |
| `POST /products` | `{ name 2–100, description? ≤1000 or null, priceSom int 100–100000000, categoryId?  or null, isAvailable? }` | 201 Product | 400 validation, 409 `DUPLICATE_NAME`, 422 `INVALID_CATEGORY` |
| `PUT /products/:id` | `{ name, description or null, priceSom, categoryId or null, version }` (full replace) | 200 Product (`version`+1) | 400, 404, 409 `VERSION_CONFLICT` / `ARCHIVED` / `DUPLICATE_NAME`, 422 |
| `PATCH /products/:id/availability` | `{ isAvailable: bool, version? }` | 200 Product | 400, 404, 409 `VERSION_CONFLICT` / `ARCHIVED` |
| `DELETE /products/:id` | – | 204 (archives; repeat → 204) | 404 |

Rules
- **Delete = archive.** The row is kept (`archivedAt`, `isAvailable=false`, version+1); order lines keep their own name/price snapshot and `productId`, so history is intact. DB CHECK: an archived product can never be available. Archiving frees the name. There is no un-archive endpoint.
- **Names** are unique per restaurant among live products, ignoring case (partial unique index) → parallel/duplicate create requests give exactly one product.
- **Concurrency:** every mutation locks the product row (`FOR UPDATE`) in a transaction; `PUT` needs the client's `version` (stale editor → 409, no lost update). `PATCH availability` is an idempotent *set*, not a toggle; repeating it changes nothing and writes no audit row; with `version` it is also optimistic.
- **Category must belong to the same restaurant**; foreign/unknown ids are one error (422).
- **Stage 4B interplay (unchanged logic):** acceptance and price consent read `isAvailable` and `priceSom` live. Marking a product unavailable/archiving it blocks acceptance of waiting orders (`PROBLEMS`); changing a price makes a waiting order go through the *price-change consent* flow. Nothing is repriced silently and `OrderItem` snapshots are never touched by this API. The API does not warn the restaurant about affected waiting orders.
- **Audit:** `CatalogEvent` (append-only) per change: `PRODUCT_CREATED/UPDATED/AVAILABILITY/ARCHIVED`, entity id, `actorSessionId` (the shared-login session), JSON `before`/`after`.

## Categories
Category JSON: `{ id, name, position, version, productCount? }` (`productCount` = live products, list only).

| Method & path | Request | Success | Errors |
|---|---|---|---|
| `GET /categories` | – | 200 `{ "categories": [Category] }` ordered by position, name | 401/403 |
| `POST /categories` | `{ name 1–60, position? int 0–10000 }` (default: last+1) | 201 Category | 400, 409 `DUPLICATE_NAME` |
| `PUT /categories/:id` | `{ name, position, version }` | 200 Category | 400, 404, 409 `VERSION_CONFLICT` / `DUPLICATE_NAME` |
| `DELETE /categories/:id[?reassignTo=<ownCategoryId> or none]` | – | 204 | 404, 409 `CATEGORY_NOT_EMPTY`, 422 `INVALID_CATEGORY` (foreign / same category), 400 unknown query field |

A category with live products is never deleted silently: either 409, or the caller states where they go (`reassignTo` another own category, or `none`). Archived products are just uncategorised. Orders never reference categories, so history is unaffected. Names are unique per restaurant ignoring case.

Error body is always `{ "error": "<CODE>" }` (validation: `{ "error": "Validation failed", "details": [...] }`). All responses carry `Cache-Control: no-store`.

## Images — not implemented; future contract
`imageUrl` is **read-only** here (bodies containing it are rejected) and nothing downloads URLs. Planned secure flow (needs object storage and an image library, so out of scope now):
1. `POST /products/:id/image-upload` `{ contentType: "image/jpeg"|"image/png"|"image/webp", sizeBytes ≤ 2 MiB }` → `{ uploadId, uploadPath, expiresAt }` (server-generated id; the client never supplies a path or key).
2. `PUT /uploads/:uploadId` with raw bytes: server checks the session owns the upload, length limit, **magic bytes** (not the header), decodes and **re-encodes** (strips EXIF/metadata, caps dimensions), scans nothing external.
3. `POST /products/:id/image` `{ uploadId, version }` attaches the stored object (random server-side key, served from our own origin/CDN) and bumps `version`; audit event `PRODUCT_IMAGE`.
Never: client-supplied filesystem paths, server-side fetching of client URLs (SSRF), SVG, original filenames in storage keys.

## Database (`prisma/migrations/20261022000100_catalog_management`, **not executed**)
`Product.archivedAt`, `Product.version`, `Category.version`; CHECK `Product_archived_unavailable` (valid for all existing rows); unique indexes `Product_active_name_per_restaurant` (live products, `lower(name)`) and `Category_name_per_restaurant`; table `CatalogEvent` (cascades with the restaurant). Additive; no row is rewritten. **The two unique indexes fail the migration (rolling it back, data untouched) if a restaurant already has case-insensitive duplicate names** — the file contains the queries to check first. Apply after the pending Stage 3–5A migrations. The customer bot and `catalogRoutes` already filter on `isAvailable`, so archived products disappear from them without code changes there. The legacy `POST /internal/restaurants/:id/products` is unchanged and now also hits the unique-name rule (409).

## Tests (none run by me)
```sh
nvm use 24                      # Node >= 24.7
npm install                     # yourself; nothing was installed here
npm run db:generate
npm run db:migrate
npm run typecheck
npm run test:catalog            # pure: schemas (prices, names, strict bodies, versions, id charset)
npm run test:catalog:db         # HTTP+DB: 401s (none/bad/expired/revoked), inactive 403, isolation, invalid price/category,
                                # duplicate & parallel creates, concurrent PUTs, idempotent availability, archive keeps order history,
                                # audit trail, category CRUD/reassign/delete
npm run test:auth:db && npm run test:acceptance2:db && npm run test:payment:safety   # regression
```
DB tests create their own uniquely named restaurants and delete only them.

## Remaining limitations
- Shared login: audit identifies a session, not a person; no roles (any session of a restaurant can archive products).
- Archiving is irreversible through the API; no bulk import/export, no product ordering within a category, no pagination (lists capped at 1000/500).
- No warning/blocking when a price or availability change affects `WAITING_RESTAURANT` orders; the 4B flows handle them safely but the restaurant is not told.
- Optimistic `version` is optional on `PATCH availability` and `DELETE` (last write wins there, by design).
- No rate limiting on catalog writes; no image support; `description` is stored as plain text (clients must escape).
- Not compiled or executed; expect typecheck nits after `db:generate`.
