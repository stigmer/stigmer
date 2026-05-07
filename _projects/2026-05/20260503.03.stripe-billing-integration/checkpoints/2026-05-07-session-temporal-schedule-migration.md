# Session Notes: 2026-05-07 — Temporal Schedule Migration

## Accomplishments

- Migrated billing reconciliation from app-side cron workflow to server-side Temporal Schedule
- Added `ScheduleClient` bean to shared `temporal-starter` library (infrastructure for all services)
- Fixed scheduling bug: was running every 5 hours (cron `0 */5 * * *`), now correctly every 5 minutes
- Added one-time migration code to terminate the legacy cron workflow on first boot
- Committed: `02165b32` on `main`
- Changelog: `_changelog/2026-05/2026-05-07-145854-migrate-billing-reconciliation-to-temporal-schedule.md`

## Decisions Made

- Use `ScheduleIntervalSpec` (duration-based) instead of cron expressions — unambiguous
- Schedule ID: `billing-reconciliation` (dash-separated, clean for Temporal UI)
- Legacy workflow ID: `billing/reconciliation` — terminated on first boot, then ignored on subsequent boots
- `ScheduleClient` bean wired with the same `DataConverter` as `WorkflowClient` (protobuf-aware Jackson)

## Key Code Changes

- `TemporalWorkflowClientConfig.java`: Added `ScheduleClient` bean
- `BillingReconciliationStarter.java`: Full rewrite — now uses `ScheduleClient.createSchedule()` + legacy termination
- `BillingReconciliationConfig.java`: Removed `cronSchedule`, added `intervalMinutes`
- `application.yaml`: Replaced `cron-schedule` with `interval-minutes`

## Learnings

- Temporal cron workflows (`setCronSchedule`) are an older pattern — Temporal Schedules (server-side) are the modern approach
- `ScheduleAlreadyRunningException` is the idempotency mechanism for `createSchedule()` (analogous to `WorkflowExecutionAlreadyStarted`)
- Cron expression `0 */5 * * *` means "at minute 0, every 5th hour" — NOT every 5 minutes

## Open Questions

- None — migration is complete and ready for production deployment

## Next Session Plan

- Deploy to production (schedule will auto-create on first boot, legacy cron will be terminated)
- Verify in Temporal UI that the `billing-reconciliation` schedule appears in the Schedules tab
- Verify reconciliation runs every 5 minutes as expected
