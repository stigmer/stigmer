# Cursor Usage Ingestion — Phase 1 (Admin API Polling + Global Event Ledger)

**Date**: May 29, 2026

## Summary

Built the cloud-only foundation for Cursor billing reconciliation: a gated Admin API client, an append-only global usage-event ledger with a poll watermark, and an hourly Temporal-scheduled ingestion workflow that pages events into Mongo idempotently. This is ingest-only — no settlement, no proto changes — but captures every field needed for Phase 2 matching.

## Problem Statement

Stigmer bills customers for Cursor harness executions using runner-estimated costs (via `model-registry.json` token pricing). These estimates can drift from Cursor's actual charges — the prior session found a 6.3x cost display overcharge from a formula bug. The only authoritative source of truth is Cursor's Admin API `chargedCents` field, but no mechanism existed to poll, store, or reconcile against it.

### Pain Points

- Runner-reported costs are estimates, not authoritative — subject to pricing drift, formula bugs, and model-registry staleness
- `USAGE_METERING_SOURCE_PROVIDER_ADMIN_RECONCILED` enum exists in the proto but was never wired
- No local copy of Cursor's billing data — reconciliation requires it
- Monthly invoice reconciliation was impossible without event-level data

## Solution

Phase 1 delivers the honest foundation: a trustworthy, team-wide event ledger that captures Cursor's authoritative cost data on an hourly schedule. The subsystem is fully gated — it does nothing when the Admin API key is absent — and designed for the hard truth that all cloud runner traffic uses one shared Cursor team (no per-org join key).

## Implementation Details

### Cursor Admin API Client (`billing/cursor/`)
- `CursorAdminApiClient` — `java.net.http.HttpClient` with Basic auth (API key as username, empty password), page-based pagination via `hasNextPage`, 30-day window guard, 3.1s inter-page throttle (20 req/min limit), error classification (retriable: 429/5xx/parse; terminal: 4xx)
- `CursorAdminApiClientProvider` — `@ConditionalOnProperty(prefix="stigmer.cursor.admin", name="api-key")` conditional bean, matching the `StripeClientProvider` pattern
- `CursorAdminApiConfig` — `@ConfigurationProperties("stigmer.cursor.admin")` for api-key, base-url, page-size
- Jackson `@JsonProperty` record DTOs: `CursorUsageEventDto`, `TokenUsageDto`, `FilteredUsageEventsResponse`
- `CursorUsageEvent` — domain value with SHA-256 content-hash `idempotencyKey()` over canonical fields (timestamp + user/serviceAccount + model + kind + maxMode + tokens + chargedCents + cursorTokenFee + requestsCosts)

### Storage (`billing/repo/` + `migrations/`)
- `cursor_usage_event` collection — plain BSON (no proto), unique `idempotency_key` index + indexes on `observed_at`, `(model, observed_at)`, `(user_email, observed_at)`, `(service_account_id, observed_at)`
- `cursor_usage_poll_state` collection — single bookkeeping doc per poll scope with watermark + run statistics
- `CursorUsageEventRepo` — `insertIfAbsent` with `DuplicateKeyException` catch (StripeWebhookEventRepo pattern)
- `CursorUsagePollStateRepo` — upsert watermark + error recording
- Mongock migration `U20260529` (order 035, author "billing")

### Temporal Workflow (`billing/temporal/cursorusage/`)
- Modeled on the `reservation_expiry/` scheduled-workflow package (cleaner than `reconciliation/` which has legacy-cron cruft)
- `CursorUsageIngestionWorkflow` — single `run()` method, schedule ID `cursor-usage-ingestion`
- `CursorUsageIngestionWorkflowImpl` — 4min StartToClose + 60s heartbeat timeout (justified deviation from the 30s reconciliation default due to paginated external API + rate-limit throttling)
- `CursorUsageIngestionActivitiesImpl` — watermark-based window computation with trailing overlap (absorbs hourly data restatement), pagination with per-page heartbeating, SHA-256 dedup, Micrometer counters
- `CursorUsageIngestionWorkerConfig` — dedicated `cursor_usage_ingestion` task queue
- `CursorUsageIngestionStarter` — `ApplicationRunner` at `LOWEST_PRECEDENCE`, double-gated on `enabled` + client bean presence, idempotent `createSchedule`

### Configuration
- `stigmer.cursor.admin.api-key: ${STIGMER_CURSOR_ADMIN_API_KEY:}` (+ base-url, page-size)
- `stigmer.cursor.ingestion.*` — enabled, interval-minutes (60), overlap-minutes (120), buffer-minutes (90), initial-backfill-hours (24), max-pages-per-run (50)
- `temporal.cursor-usage-ingestion.task-queue: cursor_usage_ingestion`

### Observability
- Micrometer counters: `stigmer.cursor.ingestion.events{outcome=inserted|duplicate}`, `stigmer.cursor.ingestion.pages`, `stigmer.cursor.ingestion.runs{outcome=success|failure}`
- Structured Slf4j logging with window bounds, event counts, and scope context

### Key Architectural Finding
All cloud runner->Cursor traffic uses a single platform API key (`STIGMER_PROXY_CURSOR_API_KEY`). The `X-Stigmer-Execution-Id` header is stripped before forwarding to Cursor. This means the ledger is team-wide (not per-org), and per-execution matching (Phase 2) is inherently fuzzy — reliable per-execution settlement is gated on per-org Cursor service accounts (Phase 4, Enterprise-only).

### Tests (5 classes, all passing)
- `CursorAdminApiClientTest` — 10 tests: Basic auth, parsing, pagination, error mapping, 30-day guard, missing userEmail, serviceAccount events
- `CursorUsageEventRepoTest` — insert/dedup + SHA-256 idempotency key determinism
- `CursorUsagePollStateRepoTest` — read/advance/error
- `CursorUsageIngestionActivitiesImplTest` — initial backfill, overlap, dedup counting, null client, error recording
- `CursorUsageIngestionWorkflowTest` — 3 tests via `TestWorkflowEnvironment`

## Benefits

- Authoritative Cursor cost data (`chargedCents`) now accessible locally for reconciliation
- Feature is fully gated — zero impact when Admin API key is absent
- SHA-256 content-hash dedup handles overlapping poll windows safely
- Trailing overlap window + buffer absorbs Cursor's hourly data restatement
- Every Cursor event field captured (including `raw_event_json`) to future-proof Phase 2 matching
- Dedicated task queue isolates ingestion from agent execution path
- Heartbeating gives Temporal UI visibility into long-running pagination

## Impact

- **Billing team**: Can now query `cursor_usage_event` collection for authoritative Cursor costs
- **Reconciliation (future)**: Foundation for Phase 2 matching + settlement and Phase 3 aggregate-vs-invoice checks
- **Operations**: `cursor_usage_poll_state` provides at-a-glance ingestion health; Micrometer counters feed dashboards
- **All environments**: Zero impact when key is absent (dev, staging boot cleanly)

## Related Work

- Fix Billing Display and Remove Broken Context Gauge (May 29) — prior session fixing the 6.3x cost overcharge that motivated this reconciliation work
- Cursor Experience Parity project — parent initiative
- Stripe Billing Reconciliation (existing) — the `billing/temporal/reconciliation/` package that established the Temporal Schedule pattern
- Reservation Expiry Cleanup (existing) — the `billing/temporal/reservation_expiry/` package used as the clean template

---

**Status**: Production Ready (gated on `STIGMER_CURSOR_ADMIN_API_KEY` provisioning)
**Timeline**: Single session
