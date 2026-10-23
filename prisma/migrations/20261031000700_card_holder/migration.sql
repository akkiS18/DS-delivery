-- Stage 9: the name on a payee card (optional; legacy cards have none). Additive.
ALTER TABLE "Card" ADD COLUMN "holderName" TEXT;
