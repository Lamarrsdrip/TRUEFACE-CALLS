CREATE TYPE "AdminRole_next" AS ENUM (
  'SUPER_ADMIN',
  'ADMIN',
  'SUPPORT',
  'FINANCE',
  'MODERATOR',
  'VIEWER'
);

ALTER TABLE "AdminUser"
ALTER COLUMN "role" TYPE "AdminRole_next"
USING (
  CASE "role"::text
    WHEN 'OPERATIONS' THEN 'ADMIN'
    WHEN 'BILLING' THEN 'FINANCE'
    WHEN 'ANALYST' THEN 'VIEWER'
    ELSE "role"::text
  END
)::"AdminRole_next";

DROP TYPE "AdminRole";
ALTER TYPE "AdminRole_next" RENAME TO "AdminRole";

ALTER TABLE "User"
ADD COLUMN "roomCreationDisabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Plan"
ADD COLUMN "maxImagesPerProfile" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "maxCallMinutes" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN "maxGroupCalls" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "watermarkRequired" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "creditTopupsAllowed" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "creditResetDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN "featureAccess" JSONB;

ALTER TABLE "FaceProfile"
ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "readinessScore" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "readinessLabel" TEXT NOT NULL DEFAULT 'POOR';

ALTER TABLE "CreditWallet"
ADD COLUMN "includedMilliCredits" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "purchasedMilliCredits" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "reservedIncludedMilli" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "reservedPurchasedMilli" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "includedResetAt" TIMESTAMP(3);

UPDATE "CreditWallet"
SET "includedMilliCredits" = "availableMilliCredits";

ALTER TABLE "AdminUser"
ADD COLUMN "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "lastLoginAt" TIMESTAMP(3),
ADD COLUMN "lastLoginIpHash" TEXT;

ALTER TABLE "Payment"
ADD COLUMN "proofObjectKey" TEXT,
ADD COLUMN "transferReference" TEXT,
ADD COLUMN "expiresAt" TIMESTAMP(3),
ADD COLUMN "reviewedAt" TIMESTAMP(3),
ADD COLUMN "reviewedByAdminId" UUID,
ADD COLUMN "adminNotes" TEXT;

ALTER TABLE "Payment"
ADD CONSTRAINT "Payment_reviewedByAdminId_fkey"
FOREIGN KEY ("reviewedByAdminId") REFERENCES "AdminUser"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "WebhookEvent" (
  "id" UUID NOT NULL,
  "provider" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "externalId" TEXT,
  "status" TEXT NOT NULL,
  "paymentId" UUID,
  "errorRedacted" TEXT,
  "payloadRedacted" JSONB,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FaceProfileImage" (
  "id" UUID NOT NULL,
  "faceProfileId" UUID NOT NULL,
  "objectKey" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "qualityScore" INTEGER NOT NULL,
  "qualitySignals" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FaceProfileImage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FaceProfileImage_objectKey_key"
ON "FaceProfileImage"("objectKey");

CREATE INDEX "FaceProfileImage_faceProfileId_role_idx"
ON "FaceProfileImage"("faceProfileId", "role");

ALTER TABLE "FaceProfileImage"
ADD CONSTRAINT "FaceProfileImage_faceProfileId_fkey"
FOREIGN KEY ("faceProfileId") REFERENCES "FaceProfile"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "WebhookEvent_provider_externalId_key"
ON "WebhookEvent"("provider", "externalId");

CREATE INDEX "WebhookEvent_status_createdAt_idx"
ON "WebhookEvent"("status", "createdAt");

CREATE INDEX "WebhookEvent_provider_createdAt_idx"
ON "WebhookEvent"("provider", "createdAt");
