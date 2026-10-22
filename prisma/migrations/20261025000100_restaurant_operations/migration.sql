-- Stage 6C - restaurant operations settings. Additive: two nullable/defaulted columns on "Restaurant";
-- no row is rewritten beyond the column defaults and Restaurant."isPaused" is reused as is.
ALTER TABLE "Restaurant" ADD COLUMN "defaultPrepMinutes" INTEGER NOT NULL DEFAULT 25,
  ADD COLUMN "workingHours" JSONB;
ALTER TABLE "Restaurant" ADD CONSTRAINT "Restaurant_defaultPrepMinutes_range" CHECK ("defaultPrepMinutes" BETWEEN 5 AND 120);
