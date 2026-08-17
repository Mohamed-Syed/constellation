-- CreateTable
CREATE TABLE "core"."mesh_peers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "apiKeyHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'unknown',
    "lastSeen" TIMESTAMP(3),
    "lastError" TEXT,
    "lastProbedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mesh_peers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mesh_peers_name_key" ON "core"."mesh_peers"("name");
