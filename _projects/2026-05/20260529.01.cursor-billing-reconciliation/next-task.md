# Next Task: 20260529.01.cursor-billing-reconciliation

## 🎯 Quick Resume Instructions

**Simply drop this file into your conversation to quickly resume work on this project.**

All the context you need is right here with absolute paths to project files.

---

## Project Overview

**Name**: 20260529.01.cursor-billing-reconciliation  
**Description**: Reconcile runner-estimated Cursor harness costs against Cursor's Admin API, settle billing records with authoritative chargedCents, and design a state-of-the-art trust model for runner-reported usage.  
**Goal**: Bridge the gap between runner-estimated Cursor costs and Cursor's authoritative billing by polling the Admin API, matching events to executions, settling LlmCallUsageRecord, and establishing a defensible trust/legitimacy model for runner-reported usage.  
**Tech Stack**: Java/Temporal/MongoDB (stigmer-cloud), Proto/Buf (shared apis), TypeScript/React (sdk display)  
**Components**: stigmer-service billing domain (Temporal workflow, activities, repos, Mongo collections), shared usage.proto, UsageAggregationService, useSessionUsage hook + UsageWidget

**Created**: 2026-05-29  
**Type**: ⚡ Quick Project (1-2 sessions)

---

## Project Location

**Project Root**: 
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260529.01.cursor-billing-reconciliation
```

---

## Essential Files

### 📋 Tasks (Check current progress here)
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260529.01.cursor-billing-reconciliation/tasks.md
```
All tasks are tracked in this single file. Check status and continue where you left off.

### 📖 Project README
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260529.01.cursor-billing-reconciliation/README.md
```
Project overview, goals, and success criteria.

### 📝 Quick Notes
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260529.01.cursor-billing-reconciliation/notes.md
```
Important decisions, learnings, and gotchas captured during development.

---

## Resume Checklist

When starting a new session, quickly review:

1. [ ] Open `tasks.md` and check current task status
2. [ ] Review any recent notes in `notes.md`
3. [ ] Continue with the current task or move to next

That's it! No complex structure - just focused work.

---

## Current Status

**Last Updated**: 2026-05-29 13:41  
**Current Focus**: Phase 4 trust-ladder sketch DONE + committed. Next: Task 2 (Phase 2 - Matching + settlement), implementing against `design.trust-ladder.md`.

## Session Progress (2026-05-29)

### Accomplished
- Completed full Phase 1 implementation: Cursor Admin API client + global event ledger + hourly Temporal-scheduled ingestion workflow
- 18 new files + 3 edited in stigmer-cloud, 5 test classes all passing, build green, zero regressions
- Deep architectural discovery: all cloud runner Cursor traffic uses one platform API key — ledger is global/team-wide, no per-org join key exists
- Phase 4 trust-ladder sketch DONE: `design.trust-ladder.md` locks settlement-state contract, hold-only billing model, `UsageSettlementStatus` enum, 5-tier trust ladder, dimensional model precedence rules, and Phase 2 write/read contracts

### Key Decisions
- Renamed from `cursor_reconciliation_*` to `cursor_usage_*` (avoid overloading "reconciliation")
- Modeled on `reservation_expiry/` template (cleaner than `reconciliation/`)
- Plain BSON store (no proto for internal ledger)
- SHA-256 content-hash for dedup (Cursor has no stable event ID)
- Trailing overlap window + buffer to absorb hourly data restatement
- Activity uses 4min StartToClose + 60s heartbeat (external API paging)
- **Hold-only billing**: Stop debiting runner estimate; capture from `chargedCents` at settlement only
- **Dedicated `UsageSettlementStatus` enum**: 8-state machine as single source of truth for settlement lifecycle
- **`PROVIDER_SETTLED` trust level**: New tier for reconciled Cursor records; `ATTESTED_RUNNER` reserved for future
- **Billing-correctness fix**: Current code violates proto semantics (SERVER_OBSERVED used for billing); design corrects to DISPLAY_ONLY

### Files Modified (stigmer-cloud)
- `billing/cursor/` — 7 new files (client, config, DTOs, domain model)
- `billing/temporal/cursorusage/` — 7 new files (workflow, activity, worker, starter, configs, summary)
- `billing/repo/` — 2 new files (event repo, poll state repo)
- `migrations/` — 1 new file (Mongock order 035)
- Config — 2 edited (application.yaml, application-temporal.yaml)
- BUILD.bazel — 5 new test targets

## Next Steps
1. ~~**SKETCH Phase 4 trust-ladder** — DONE. See `design.trust-ladder.md`.~~
2. **Provision `STIGMER_CURSOR_ADMIN_API_KEY`** as Planton secret for live verification
3. **Start Task 2**: matching + settlement, implementing against `design.trust-ladder.md` (proto changes, hold-only billing, `MatchAndSettle` activity, `UsageSettlementStatus` enum, UX wiring)

## Blockers
- `STIGMER_CURSOR_ADMIN_API_KEY` not yet provisioned — live ingestion verification deferred

---

## Quick Commands

After loading this file into chat, you can say:

- **"Show current status"** - Get overview of all tasks and progress
- **"Continue with current task"** - Resume work on in-progress task
- **"What's next?"** - Move to next task
- **"Update task X to done"** - Mark a task complete
- **"Add a note"** - Capture a quick learning or decision
- **"Complete project"** - Final wrap-up when all tasks done

---

## Framework Benefits

Even with minimal overhead, you still get:
- ✅ Clear goal and structured tasks
- ✅ Progress tracking
- ✅ Context persistence across sessions
- ✅ Learning capture
- ✅ Quick resume (via this file!)

---

*Quick Project Framework: Minimal overhead, maximum focus. When structure helps, not hinders.*

