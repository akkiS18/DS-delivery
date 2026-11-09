-- Landmarks (owner 2026-11-09): named places the customer map and the taxi text orient by. A new table only: nothing existing changes.
CREATE TABLE "Landmark" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'OTHER',
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Landmark_pkey" PRIMARY KEY ("id"),
    -- The database refuses what the app already refuses: an empty/huge name, a point that is not on Earth.
    CONSTRAINT "Landmark_name_len" CHECK (char_length(btrim("name")) BETWEEN 2 AND 60),
    CONSTRAINT "Landmark_lat_range" CHECK ("lat" BETWEEN -90 AND 90),
    CONSTRAINT "Landmark_lng_range" CHECK ("lng" BETWEEN -180 AND 180)
);

CREATE INDEX "Landmark_isActive_idx" ON "Landmark"("isActive");
