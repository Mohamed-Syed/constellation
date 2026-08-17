-- AlterTable
ALTER TABLE "core"."scheduled_tasks" ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "teamId" TEXT;

-- AlterTable
ALTER TABLE "core"."workflows" ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "teamId" TEXT;
