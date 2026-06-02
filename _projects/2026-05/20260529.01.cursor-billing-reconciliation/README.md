# 20260529.01.cursor-billing-reconciliation

## Overview
Reconcile runner-estimated Cursor harness costs against Cursor's Admin API, settle billing records with authoritative chargedCents, and design a state-of-the-art trust model for runner-reported usage.

**Created**: 2026-05-29  
**Estimated Time**: Multi-session (4 phases)  
**Status**: 🚧 In Progress

## Goal
Bridge the gap between runner-estimated Cursor costs and Cursor's authoritative billing by polling the Admin API, matching events to executions, settling LlmCallUsageRecord, and establishing a defensible trust/legitimacy model for runner-reported usage.

## Technology Stack
Java/Temporal/MongoDB (stigmer-cloud), Proto/Buf (shared apis), TypeScript/React (sdk display)

## Affected Components
stigmer-service billing domain (Temporal workflow, activities, repos, Mongo collections), shared usage.proto, UsageAggregationService, useSessionUsage hook + UsageWidget

## Success Criteria
- Cursor Admin API events ingested into local ledger on hourly schedule
- LlmCallUsageRecord settled with authoritative chargedCents where matched
- useSessionUsage shows Settled (no Estimated badge) once reconciled
- Trust ladder + legitimacy design documented with feasible slices implemented
- Monthly settled total reconciles within 5% of Cursor invoice

## Quick Links
- [Tasks](tasks.md) - Task breakdown and progress
- [Notes](notes.md) - Quick notes and learnings
- [Resume](next-task.md) - **Drag this into chat to resume!**

## Project Type
⚡ **Quick Project** - Designed to complete in 1-2 sessions with minimal overhead.

## Status Summary

Check [tasks.md](tasks.md) for detailed progress tracking.

Update this section as you make progress:
- Current phase: Phase 1 (Admin API polling + local ledger) — not started
- Blockers: Need `STIGMER_CURSOR_ADMIN_API_KEY` (Cursor admin key, `admin:*` scope, Team/Enterprise plan) provisioned as a Planton secret before live polling
- Next up: Build `CursorAdminApiClient` + ledger collections (see tasks.md Phase 1 subtasks)

> Scope note: this spans 4 phases / multiple sessions — larger than a typical quick project. If it grows further (per-phase design docs, review workflow), consider upgrading to the full Next Project Framework.

## Notes Summary

Key learnings and decisions are captured in [notes.md](notes.md).

---

*This project follows the Next Quick Project Framework for fast, focused development.*

