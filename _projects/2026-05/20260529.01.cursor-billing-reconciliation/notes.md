# Notes: 20260529.01.cursor-billing-reconciliation

**Created**: 2026-05-29

## Purpose

Use this file to capture important information as you work:

- 🎯 **Decisions**: Why you chose approach A over B
- 🐛 **Gotchas**: Issues discovered and how you solved them
- 💡 **Learnings**: Insights that might help later
- 📝 **Commands**: Useful commands or snippets
- 🔗 **References**: Links to docs, Stack Overflow, etc.

Keep entries **timestamped** and **concise**. This isn't a novel - just enough context to remember later.

---

## 2026-05-29 - Project started, design grounded in real code

### Source-of-truth documents
- Design doc: `_cursor/cursor-billing-reconciliation-workflow.md`
- Tamper-resistance research: `_projects/2026-05/20260513.01.cursor-experience-parity/research.runner-usage-tamper-resistance/04.report.gpt.md`
- Prior billing fix changelog: `_changelog/2026-05/2026-05-29-114311-fix-billing-display-remove-context-gauge.md`

### Corrections to the design doc (must follow these, not the doc verbatim)
1. **Temporal Schedules, not ContinueAsNew.** No Java ContinueAsNew exists in the repo. Model on the Stripe reconciliation flow in stigmer-cloud:
   - `backend/services/stigmer-service/.../domain/billing/temporal/reconciliation/BillingReconciliationWorkflow.java`
   - `.../BillingReconciliationWorkerConfig.java`
   - `BillingReconciliationStarter` (ApplicationRunner registers a server-side Schedule).
2. **`LlmCallUsageRecord` is a proto** (shared OSS repo: `apis/ai/stigmer/agentic/agentexecution/v1/usage.proto`), serialized to Mongo. New settlement fields need a proto change + stub regen. The enum value `USAGE_METERING_SOURCE_PROVIDER_ADMIN_RECONCILED` ALREADY EXISTS and is unused — it's our target metering source.
3. **Matching granularity mismatch.** `BillingActivitiesImpl.recordCursorUsage` collapses a whole execution into ONE aggregate record (`sequence=1`); Admin API returns HOURLY-aggregated events. Exact per-turn 4-tuple matching will not reliably hit. Use confidence-scored matching + workspace/day aggregate settlement fallback (research report sections 6.3, 6.4), not exact-tuple-only.
4. **Config via env like Stripe**, not Planton runtime fetch: `stigmer.cursor.admin.api-key: ${STIGMER_CURSOR_ADMIN_API_KEY:}` in `application.yaml`, conditional bean so the feature is gated off when unset. Planton supplies the env value at deploy time.

### Key existing files (anchors)
- Cursor billing write path: `stigmer-cloud .../domain/billing/temporal/BillingActivitiesImpl.java` (`recordCursorUsage`)
- Records repo + migration: `LlmCallUsageRecordRepo.java`, `migrations/U20260504_LlmCallUsageRecordCollection.java`
- Aggregation: `.../domain/agentic/agentexecution/UsageAggregationService.java`
- Session report handler: `AgentExecutionGetSessionUsageReportHandler.java`
- Runner accumulator/pricing: `stigmer backend/services/runner/src/activities/execute-cursor/{usage-accumulator,model-pricing}.ts`
- Display: `stigmer sdk/react/src/session/useSessionUsage.ts` (`isEstimated`), `sdk/react/src/execution/UsageWidget.tsx`, `sdk/ink/src/components/UsageWidget.tsx`

### Sequencing note
Phase 4's trust-ladder decision (adding `PROVIDER_SETTLED`) should be SKETCHED before Phase 2 settlement semantics are finalized, since Phase 2 writes that state.

### Cursor Admin API
`POST https://api.cursor.com/teams/filtered-usage-events`, Basic auth `{ADMIN_API_KEY}:`, epoch-ms window (max 30d), pageSize 100, rate limit 20 req/min, data aggregated hourly → poll at most hourly. Authoritative field: `chargedCents` (model cost + Cursor Token Fee).

---

## Example Entry Format

```
## YYYY-MM-DD HH:MM - Brief Title

Quick description of what happened or what you learned.

Code snippet or command if relevant:
<code here>

Why it matters: <brief explanation>
```

---

*Add your timestamped notes below as you work*

---

## 2026-05-29 13:35 - Phase 4 trust-ladder sketch completed

### Deliverable
`design.trust-ladder.md` — 765-line decision record that Phase 2 implements against.

### Billing-correctness surprise discovered
Current `RecordLlmCallUsageHandler` stamps Cursor records as `SERVER_OBSERVED` and immediately/irreversibly debits credits. This contradicts the proto's own semantics: `SERVER_OBSERVED` is documented as "not billing" and `StreamingUsageSummary` is explicitly `DISPLAY_ONLY`. Customers are billed from unverified runner estimates.

### Decisions locked
1. **Hold-only billing:** Stop debiting the runner estimate. Reservation hold at estimate time; capture from `chargedCents` at settlement only. No irreversible debit from runner signal.
2. **New `UsageSettlementStatus` enum:** 8 states (NOT_APPLICABLE, ESTIMATED, RECONCILING, SETTLED, ADJUSTED, COLLISION_ABSORBED, DISPUTED, WRITTEN_OFF) with a formal state machine.
3. **New `PROVIDER_SETTLED` trust level:** Tier 2, between BILLING_AUTHORITY and SERVER_OBSERVED. Reserved `ATTESTED_RUNNER` for future.
4. **Precedence rules:** `settlement_status` is single source of truth for "settled." Existing `RECONCILED` values in `usage_status` and `cost.calculation_status` are secondary/backward-compat.
5. **Dimensional model:** 6-dimension composition table (metering_source x trust_level x settlement_status x debit_status x calculation_status) with valid combinations defined for every harness/phase.
6. **Settlement debit is new path:** Idempotency key `settlement_{usage_record_id}`, direct available-credits debit (not reservation), new `settlement_debit` ledger entry type.
7. **UX:** `isEstimated` driven by `settlement_status`, not token-count heuristic. Server derives flag; SDK hook consumes it.

### What this changes for Phase 2
- `recordCursorUsage` must set `is_billable = false`, `trust_level = DISPLAY_ONLY`, `settlement_status = ESTIMATED`.
- `DebitBillingStep` short-circuits for non-billable records (existing behavior, just triggered correctly now).
- New `MatchAndSettle` activity writes settlement state and executes debit.
- Proto needs `UsageSettlementStatus` enum + `settlement_status` field + `SettlementLink` message.
- `UsageAggregationService` aggregation works as-is (unsettled records have `customer_billable_amount_micros = 0`), but needs `isEstimated` derivation from settlement status.

---

## 2026-05-29 13:00 - Phase 1 implemented (stigmer-cloud)

### Key architectural finding — single Cursor team
All cloud runner->Cursor traffic uses ONE platform API key (`STIGMER_PROXY_CURSOR_API_KEY`). The `X-Stigmer-Execution-Id` header is stripped before forwarding upstream. Cursor has zero knowledge of Stigmer org/session/execution. Events carry `userEmail` (team-key owner) + optional `serviceAccountId` — neither maps to a Stigmer org.

**Implication**: Phase 1 ledger is global (single `"platform"` scope/watermark). Per-execution matching (Phase 2) is inherently fuzzy. The defensible near-term reconciliation is team/aggregate-level (sum `chargedCents` vs invoice). Per-execution settlement is gated on per-org Cursor service accounts (Phase 4, Enterprise-only).

### Naming corrections applied
- Collection names: `cursor_usage_event` + `cursor_usage_poll_state` (not `cursor_reconciliation_*`)
- Package: `billing/cursor` (client) + `billing/temporal/cursorusage` (Temporal pieces)
- Queue: `cursor_usage_ingestion`, schedule: `cursor-usage-ingestion`

### Conventions followed (from deep codebase analysis)
- `java.net.http.HttpClient` + static Jackson `ObjectMapper` (like `OAuthTokenService`)
- `MessageDigest.getInstance("SHA-256")` + `HexFormat.of().formatHex()` (like `SkillArtifactR2Store`)
- Plain BSON repo (like `StripeWebhookEventRepo`), no proto for internal store
- `@ConditionalOnProperty` bean gating (like `StripeClientProvider`)
- Modeled on `reservation_expiry/` package (cleaner than `reconciliation/`)
- Micrometer counters: `stigmer.cursor.ingestion.events{outcome}`, `.pages`, `.runs{outcome}`
- Manual `java_junit5_test` BUILD targets (no Gazelle)

### Files created in stigmer-cloud (18 new, 3 edited)
See Phase 1 plan file for full list. All under `backend/services/stigmer-service/`.

### Deferred to later phases
- Live verification (needs `STIGMER_CURSOR_ADMIN_API_KEY` Planton secret)
- Proto changes (`chargedCents`, `PROVIDER_ADMIN_RECONCILED`)
- Matching/settlement, `isEstimated` wiring
- Monitoring/alerts
- Trust ladder + per-org service accounts

---

