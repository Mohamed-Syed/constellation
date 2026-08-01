import { defineConfig } from "prisma/config";

/**
 * Prisma 7 CLI configuration (replaces the `datasource.url` that used to
 * live directly in schema.prisma). This file is read ONLY by the Prisma
 * CLI (`generate`, `migrate`, `studio`, …) — it has nothing to do with how
 * `PrismaService` connects at runtime (see database/prisma.service.ts,
 * which resolves its own connection from `DATABASE_URL` and fails soft
 * when there's no database — the platform MUST boot without one).
 *
 * Deliberately reads `process.env.DATABASE_URL` directly (not the CLI's
 * `env()` helper, which throws on a missing var) with a placeholder
 * fallback: `prisma generate` must succeed with zero environment set up
 * (no `.env`, no DB) because that's the exact scenario a fresh clone hits
 * before anyone has provisioned Postgres. `migrate`/`studio` still need a
 * real `DATABASE_URL` in the environment or a `.env` file — that's
 * expected, those commands talk to an actual database.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL ?? "postgresql://localhost:5432/constellation_placeholder",
  },
  migrations: {
    path: "prisma/migrations",
  },
});
