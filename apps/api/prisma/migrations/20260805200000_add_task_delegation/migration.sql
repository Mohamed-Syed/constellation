-- Crews round (Phase 4.0 4.1): task delegation — an orchestrator task can
-- spawn sub-agent tasks. Self-relation on agent_tasks (parentTaskId).
-- AlterTable
ALTER TABLE "core"."agent_tasks" ADD COLUMN     "parentTaskId" TEXT;

-- AddForeignKey
ALTER TABLE "core"."agent_tasks" ADD CONSTRAINT "agent_tasks_parentTaskId_fkey" FOREIGN KEY ("parentTaskId") REFERENCES "core"."agent_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "agent_tasks_parentTaskId_idx" ON "core"."agent_tasks"("parentTaskId");
