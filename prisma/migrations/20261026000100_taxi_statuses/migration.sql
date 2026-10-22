-- Stage 6D (1/2): new dispatch states. Kept in its own migration because a new enum value cannot be used in the
-- transaction that adds it (the partial unique index in the next migration references them).
ALTER TYPE "TaxiDispatchStatus" ADD VALUE IF NOT EXISTS 'ACCEPTED';
ALTER TYPE "TaxiDispatchStatus" ADD VALUE IF NOT EXISTS 'DELIVERED';
