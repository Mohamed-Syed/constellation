-- AlterTable
ALTER TABLE "core"."agent_tasks" ADD COLUMN     "costUSD" DOUBLE PRECISION,
ADD COLUMN     "inputTokens" INTEGER,
ADD COLUMN     "outputTokens" INTEGER,
ADD COLUMN     "totalTokens" INTEGER;
