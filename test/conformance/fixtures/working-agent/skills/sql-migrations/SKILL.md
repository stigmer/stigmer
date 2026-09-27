---
name: sql-migrations
description: Write safe database schema migrations - reversible steps, online index builds, and backfills in batches.
---
# SQL migrations

1. Every migration has an up and a down step.
2. Add columns as nullable first; backfill in batches; then add constraints.
3. Build indexes concurrently on large tables.
4. Never rename or drop a column that running code still reads.
