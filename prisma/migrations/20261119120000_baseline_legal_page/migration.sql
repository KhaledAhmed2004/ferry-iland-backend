-- Baseline: LegalPage was created with prisma db push before this migration existed.
-- Marked as applied on existing databases with: prisma migrate resolve --applied 20261119120000_baseline_legal_page

-- CreateTable
CREATE TABLE "LegalPage" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegalPage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LegalPage_slug_key" ON "LegalPage"("slug");

-- CreateIndex
CREATE INDEX "LegalPage_slug_idx" ON "LegalPage"("slug");

-- CreateIndex
CREATE INDEX "LegalPage_isPublished_idx" ON "LegalPage"("isPublished");
