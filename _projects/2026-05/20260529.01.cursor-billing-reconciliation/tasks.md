# Tasks: 20260529.01.cursor-billing-reconciliation

**Created**: 2026-05-29

## How to Use This File

Update task status as you progress:
- **⏸️ TODO** - Not started yet
- **🚧 IN PROGRESS** - Currently working on this
- **✅ DONE** - Completed

Add timestamps and notes to track your progress.

---

## Task 1: Phase 1 - Admin API polling + global event ledger

**Status**: ✅ DONE
**Created**: 2026-05-29 12:13
**Completed**: 2026-05-29 13:00

### Subtasks
- [x] Create `CursorAdminApiClient` (java.net.http.HttpClient, Basic auth, pagination, 30d window guard, 20 req/min throttle, error classification)
- [x] Add `stigmer.cursor.admin.api-key` config + `CursorAdminApiClientProvider` conditional bean (gated off when unset)
- [x] Add Mongo collections `cursor_usage_event` + `cursor_usage_poll_state` via Mongock migration (order 035)
- [x] Implement `PollCursorUsageEvents` activity (read watermark, trailing overlap window, page events, SHA-256 dedup, advance watermark, Micrometer counters, heartbeating)
- [x] Add `cursor_usage_ingestion` task queue + `CursorUsageIngestionWorkerConfig` + `CursorUsageIngestionWorkflow` + `CursorUsageIngestionStarter` (hourly Temporal Schedule)
- [x] Tests: 5 test classes (CursorAdminApiClientTest, CursorUsageEventRepoTest, CursorUsagePollStateRepoTest, CursorUsageIngestionActivitiesImplTest, CursorUsageIngestionWorkflowTest) — all passing
- [ ] Verify LIVE: events land in Mongo, watermark advances (deferred until `STIGMER_CURSOR_ADMIN_API_KEY` is provisioned as Planton secret)

### Notes
- Naming changed from plan: `cursor_usage_event`/`cursor_usage_poll_state` (not `cursor_reconciliation_*`) to avoid overloading "reconciliation"
- Modeled on `reservation_expiry/` (cleaner template than `reconciliation/` which has legacy cron migration)
- KEY FINDING: all cloud runner Cursor traffic uses ONE platform API key — ledger is global/team-wide, not per-org
- Activity uses 4min StartToClose + 60s heartbeat (not 30s default) due to paginated external API + rate-limit throttle
- 18 new files, 3 edited files, 5 test classes, 0 regressions

## Task 2: Phase 2 - Proxy-only Cursor billing + settlement scaffolding

**Status**: 🚧 IN PROGRESS
**Created**: 2026-05-29 12:13

### Subtasks
- [x] Proto: Add UsageSettlementStatus enum, PROVIDER_SETTLED trust level, settlement_status + SettlementLink on LlmCallUsageRecord
- [x] Proto: Add is_estimated to GetSessionUsageReportOutput and ExecutionUsageSummary
- [x] Proto: Run make codegen + make protos (both repos)
- [x] Handler: Change cursor records to PROXY_PROVIDER_REPORTED + BILLING_AUTHORITY + settlement_status=NOT_APPLICABLE
- [x] Server: Derive is_estimated from settlement_status in UsageAggregationService + report handler
- [x] SDK: useSessionUsage consumes server is_estimated flag (replaces token-count heuristic)
- [x] Test: Update RecordLlmCallUsageHandlerTest assertions (PASSING)
- [ ] **BLOCKED**: Build ConnectUsageExtractor to meter Connect RPC (api2.cursor.sh) traffic at proxy
- [ ] **BLOCKED**: Remove recordCursorUsage (depends on Connect metering)
- [ ] Run full integration test suite to verify no regressions
- [ ] Add TS unit tests for useSessionUsage
- [ ] Run make check subset in both repos

### Notes
- CRITICAL DISCOVERY: Cursor SDK uses Connect RPC (api2.cursor.sh) for agent loop, NOT SSE (api.cursor.com)
- Proxy SSE metering (CursorUsageExtractor) only triggers for text/event-stream responses
- Connect responses are binary protobuf in length-prefixed envelopes — need new extractor
- recordCursorUsage removal was attempted and reverted because it broke billing (zero records)
- Proto/display/handler changes are safe and non-breaking — can be committed independently
- Integration test TestAgentExecution_CursorUsage_FullPipeline passes with recordCursorUsage present

## Task 3: Phase 3 - Monitoring + hardening (collision/unmatched/delta/poll-lag metrics, alerts, monthly aggregate-vs-invoice check, operational runbook)

**Status**: ⏸️ TODO
**Created**: 2026-05-29 12:13

### Subtasks
- [ ] [Add specific steps as you work]

### Notes
- [Add notes about this task here]

## Task 4: Phase 4 - Legitimate/tamper-resistant runner usage design (formalize trust ladder with PROVIDER_SETTLED + ATTESTED_RUNNER, provisional-hold billing, drift/anomaly dashboard, dedicated Cursor service-account-per-org attribution, document vendor signed-receipt ask + attested-cloud roadmap)

**Status**: 🚧 IN PROGRESS (sketch done, implementation deferred)
**Created**: 2026-05-29 12:13

### Subtasks
- [x] Sketch trust-ladder decision record (`design.trust-ladder.md`) — DONE 2026-05-29
- [ ] Implement `UsageSettlementStatus` enum in proto (deferred to Phase 2)
- [ ] Implement hold-only billing change for Cursor harness (deferred to Phase 2)
- [ ] Implement `MatchAndSettle` activity (deferred to Phase 2)
- [ ] Drift/anomaly dashboard (deferred to Phase 3)
- [ ] Per-org Cursor service accounts (deferred to Phase 4 proper)
- [ ] Vendor signed-receipt ask + attested-cloud roadmap (deferred to Phase 4 proper)

### Notes
- Trust-ladder sketch completed 2026-05-29. See `design.trust-ladder.md` in project directory.
- Key decisions locked: hold-only billing (no debit from runner estimate), dedicated `UsageSettlementStatus` enum, `PROVIDER_SETTLED` trust level, workspace/day aggregate fallback.
- Discovered billing-correctness issue: current code irreversibly debits from runner estimates with `SERVER_OBSERVED` trust, contradicting proto semantics. Design fixes this.
- Implementation of proto changes, billing path changes, and settlement activity is Phase 2 scope (Task 2), implementing against this design doc.


## Project Completion Checklist

When all tasks are done:
- [ ] All tasks marked ✅ DONE
- [ ] Final testing completed
- [ ] Documentation updated (if applicable)
- [ ] Code reviewed/validated
- [ ] Ready for use/deployment

---

**Quick Tip**: Keep this file updated as your single source of truth for project progress!

