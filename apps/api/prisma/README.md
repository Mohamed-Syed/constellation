# Prisma migrations (core schema)

The core API ships a **committed Prisma migration history** under
`apps/api/prisma/migrations/`. Production and CI apply schema changes with
`prisma migrate deploy` — **not** `db push` (which is dangerous — it can drop
columns/tables and is only for throwaway dev databases).

## The initial migration

`20260803200000_init/` is the migration that represents the CURRENT schema
state (`prisma/schema.prisma` — 11 tables, all indexes, and 4 foreign keys in
the `core` Postgres schema). It was generated **non-destructively** with:

```bash
DATABASE_URL='postgresql://<user>:<pw>@<host>:5432/<db>' \
  apps/api/node_modules/.bin/prisma migrate diff \
    --from-empty --to-schema apps/api/prisma/schema.prisma --script
```

The generated SQL was written to `migrations/<ts>_init/migration.sql`. A
`prisma migrate diff --from-schema <schema> --to-config-datasource` against a
`db push`-created database returns **"This is an empty migration."** — i.e. the
committed migration exactly reproduces what `db push` used to produce, so
adopting migrations causes **zero data loss**.

### Existing local/`db push` databases

Databases created before migrations existed (via `db push`) have no
`_prisma_migrations` tracking table. To adopt the migration history without
re-running (and failing on) already-created tables, mark the initial migration
as applied once:

```bash
DATABASE_URL='...' apps/api/node_modules/.bin/prisma migrate resolve --applied 20260803200000_init
```

`prisma migrate status` then reports "Database schema is up to date!" with no
destructive work. (The API's committed history is required to match; verify
with `prisma migrate diff --from-schema prisma/schema.prisma --to-config-datasource`.)

## Deploy / evolve

From `apps/api/`:

| Task | Command |
|------|---------|
| Inspect drift | `./node_modules/.bin/prisma migrate status` |
| Apply pending migrations (CI/prod) | `./node_modules/.bin/prisma migrate deploy` |
| Author a new migration | `./node_modules/.bin/prisma migrate dev --create-only --name <name>` |
| Regenerate the Prisma client | `./node_modules/.bin/prisma generate` |

Or use the repo helper (resolves DATABASE_URL from env or compose defaults):

```bash
bash scripts/prisma-migrate.sh            # migrate deploy
bash scripts/prisma-migrate.sh --status   # migrate status
```

> **Never run `prisma db push` against a shared/important database.** Now that
> a committed history exists, `db push` is only acceptable on a throwaway
> local database you are willing to lose.

## Notes

- The core schema is `core` (multi-schema **core** only — per-plugin schemas
  are owned and migrated independently by each plugin; see
  `src/core/database/README.md` for that story).
- `prisma.config.ts` (Prisma 7) holds the CLI migration path; the connection
  URL comes from `DATABASE_URL` at CLI time (runtime connection lives in
  `src/core/database/prisma.service.ts` and fails soft with no DB).
