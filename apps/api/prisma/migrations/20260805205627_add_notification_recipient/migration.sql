-- AlterTable
ALTER TABLE "core"."notifications" ADD COLUMN     "recipientId" TEXT;

-- CreateIndex
CREATE INDEX "notifications_recipientId_idx" ON "core"."notifications"("recipientId");
