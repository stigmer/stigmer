# WA-01: Local-Only Testing Was Sufficient

**Date**: 2026-05-14
**Assumption**: That E2E tests running only locally (requiring manual server setup) would be maintained and provide confidence.

## What Happened

The previous E2E suite (15 tests in `test/e2e/`) was designed to run against a manually pre-started `stigmer server` using the developer's `~/.stigmer/stigmer.db`. This had multiple problems:
- Tests rotted because no one ran them regularly
- No CI enforcement meant regressions slipped through
- Shared database state caused flaky results
- Tests only covered deployment, never execution

## Correct Understanding

Tests must be self-contained, isolated, and run in both local and CI environments. The test harness must manage its own infrastructure. This is the universal pattern in comparable platforms (Temporal, Airflow, Prefect, n8n, Dagster).
