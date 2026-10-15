-- DS Delivery initial database. Run on a NEW EMPTY ds_delivery database.
CREATE TYPE "OrderStatus" AS ENUM (
  'PAYMENT_PENDING', 'PAYMENT_EXPIRED', 'PAYMENT_MATCHED_UNVERIFIED', 'PAYMENT_CONFIRMED',
  'ACCEPTED', 'PREPARING', 'READY', 'TAXI_REQUESTED',
  'DRIVER_ASSIGNED', 'DELIVERY_ASSUMED', 'COMPLETED',
  'CANCELLATION_REQUESTED', 'CANCELLED', 'FAILED'
);
CREATE TABLE "Restaurant" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "isPaused" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL
);
CREATE UNIQUE INDEX "Restaurant_slug_key" ON "Restaurant"("slug");
CREATE TABLE "Category" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "restaurantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX "Category_restaurantId_position_idx" ON "Category"("restaurantId", "position");
CREATE TABLE "Product" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "restaurantId" TEXT NOT NULL,
  "categoryId" TEXT,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "priceSom" INTEGER NOT NULL,
  "isAvailable" BOOLEAN NOT NULL DEFAULT true,
  "imageUrl" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX "Product_restaurantId_isAvailable_idx" ON "Product"("restaurantId", "isAvailable");
CREATE TABLE "Customer" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "telegramUserId" TEXT NOT NULL,
  "displayName" TEXT,
  "phone" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "Customer_telegramUserId_key" ON "Customer"("telegramUserId");
CREATE TABLE "Order" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "number" SERIAL NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "status" "OrderStatus" NOT NULL DEFAULT 'PAYMENT_PENDING',
  "addressText" TEXT NOT NULL,
  "deliveryLat" DOUBLE PRECISION,
  "deliveryLng" DOUBLE PRECISION,
  "totalSom" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL
);
CREATE UNIQUE INDEX "Order_number_key" ON "Order"("number");
CREATE INDEX "Order_restaurantId_createdAt_idx" ON "Order"("restaurantId", "createdAt");
CREATE INDEX "Order_customerId_createdAt_idx" ON "Order"("customerId", "createdAt");
CREATE TABLE "OrderItem" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "orderId" TEXT NOT NULL,
  "productId" TEXT,
  "name" TEXT NOT NULL,
  "unitSom" INTEGER NOT NULL,
  "quantity" INTEGER NOT NULL,
  "subtotalSom" INTEGER NOT NULL
);
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");
CREATE TABLE "Card" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "restaurantId" TEXT,
  "last4" TEXT NOT NULL,
  "label" TEXT NOT NULL DEFAULT 'UZCARD',
  "isTest" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "lastAssignedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Single global last4 key is deliberate while Gmail uses only one mailbox.
-- Multiple restaurant inboxes/cards with identical last4 require a later migration.
CREATE UNIQUE INDEX "Card_last4_key" ON "Card"("last4");
CREATE INDEX "Card_restaurantId_isTest_active_idx" ON "Card"("restaurantId", "isTest", "active");
CREATE TABLE "Payment" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "number" SERIAL NOT NULL,
  "orderId" TEXT,
  "restaurantId" TEXT,
  "amountTiyin" BIGINT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "isTest" BOOLEAN NOT NULL DEFAULT false,
  "isStress" BOOLEAN NOT NULL DEFAULT false,
  "cardId" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "assignedAt" TIMESTAMPTZ(3),
  "expiresAt" TIMESTAMPTZ(3),
  "matchedAt" TIMESTAMPTZ(3),
  "matchedTransactionId" TEXT
);
CREATE UNIQUE INDEX "Payment_number_key" ON "Payment"("number");
CREATE UNIQUE INDEX "Payment_orderId_key" ON "Payment"("orderId");
CREATE UNIQUE INDEX "Payment_matchedTransactionId_key" ON "Payment"("matchedTransactionId");
CREATE INDEX "Payment_status_number_idx" ON "Payment"("status", "number");
CREATE INDEX "Payment_restaurantId_status_amountTiyin_idx" ON "Payment"("restaurantId", "status", "amountTiyin");
CREATE INDEX "Payment_cardId_amountTiyin_assignedAt_idx" ON "Payment"("cardId", "amountTiyin", "assignedAt");
CREATE INDEX "Payment_isTest_amountTiyin_status_idx" ON "Payment"("isTest", "amountTiyin", "status");
CREATE INDEX "Payment_isStress_idx" ON "Payment"("isStress");
CREATE TABLE "CardCooldown" (
  "cardId" TEXT NOT NULL,
  "amountTiyin" BIGINT NOT NULL,
  "until" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "CardCooldown_pkey" PRIMARY KEY ("cardId", "amountTiyin")
);
CREATE TABLE "IncomingTransaction" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sourceId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "cardLast4" TEXT NOT NULL,
  "amountTiyin" BIGINT NOT NULL,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL,
  "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "emailReceivedAt" TIMESTAMPTZ(3),
  "minutePrecision" BOOLEAN NOT NULL DEFAULT true,
  "trustedSender" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'REVIEW_REQUIRED',
  "reason" TEXT,
  "matchedPaymentId" TEXT
);
CREATE UNIQUE INDEX "IncomingTransaction_sourceId_key" ON "IncomingTransaction"("sourceId");
CREATE INDEX "IncomingTransaction_cardLast4_amountTiyin_occurredAt_idx" ON "IncomingTransaction"("cardLast4", "amountTiyin", "occurredAt");
CREATE INDEX "IncomingTransaction_status_receivedAt_idx" ON "IncomingTransaction"("status", "receivedAt");
CREATE TABLE "GmailIngestion" (
  "gmailId" TEXT NOT NULL PRIMARY KEY,
  "status" TEXT NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Additional concurrency protection from Payment CLI V3.
CREATE UNIQUE INDEX "payment_one_active_card_amount"
  ON "Payment"("cardId", "amountTiyin")
  WHERE "status" = 'AWAITING' AND "cardId" IS NOT NULL;
ALTER TABLE "Category" ADD CONSTRAINT "Category_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Card" ADD CONSTRAINT "Card_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CardCooldown" ADD CONSTRAINT "CardCooldown_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;
