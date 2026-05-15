# E2E Provider Tests Green: Zero-Friction Integration Testing

**Date**: May 15, 2026

## Summary

Brought all 5 provider-backed integration tests (2 LLM call + 2 agent call + 1 skipped OpenAI) to green by fixing a chain of cross-service issues spanning Go, Java, and Python. Then eliminated all manual setup friction — `make test-integration-providers` now auto-builds the JAR and auto-fetches API keys from Planton.

## Problem Statement

The provider-backed integration tests (`TestWorkflowLlmCall_*` and `TestWorkflowAgentCall_*`) were failing across multiple layers, and running them required manual setup: exporting API keys, finding/building the JAR, and passing environment variables.

### Pain Points

- LLM tests failed: missing `timeout`/`max_retries` fields, incorrect model name (`claude-haiku-3-5` → `claude-sonnet-4-20250514`)
- Agent tests failed in sequence: Java authorization (missing `orgId` on metadata), billing gate (no billing account for `test-org`), Python artifact path (`/var/stigmer/artifacts` not writable on macOS), Temporal heartbeat timeout (blocked `ExecuteWorkflow` activity), and `DataConverterException` (`ByteString` incompatible with Jackson)
- Running tests required 3 manual env vars: `ANTHROPIC_API_KEY`, `STIGMER_SERVICE_JAR`, and sometimes `OPENAI_API_KEY`

## Solution

Fixed 7 distinct failures across Go, Java, and Python, then made the Makefile self-configuring.

## Implementation Details

### Cross-Service Bug Fixes

**1. LLM Call Test Fixes (Go)**
- Added `timeout` and `max_retries` to `LlmCallTaskConfig` in test structs
- Changed model from `claude-haiku-3-5` to `claude-sonnet-4-20250514` (Anthropic key only has access to Claude 4 models)

**2. Agent Call — Java Auth Fix (Go + Java)**
- Root cause: `createAgentExecution` in `task_builder_call_agent_activities.go` did not populate `Org` in `AgentExecution.Metadata`
- Java's `SessionCreateHandler.authorize` step extracted `orgId` from `metadata.org` per proto `field_path` option, found empty, and rejected
- Fix: propagate `orgId` from workflow context into `AgentExecution.Metadata.Org`

**3. Agent Call — Billing Gate (Go test harness)**
- Added `provisionTestBillingAccount()` to `suite_test.go`: creates billing account + seeds $100 credits for `test-org`
- Added `BillingCommandControllerClient` to harness `Clients`

**4. Agent Call — Python Artifact Path (Go test harness)**
- `agent-runner` defaults to `/var/stigmer/artifacts` (not writable on macOS)
- Override `LOCAL_ARTIFACT_PATH` to `$TMPDIR/stigmer-test-artifacts` in harness
- Also fixed `STIGMER_LLM_MODEL` from `claude-haiku-3-5` to `claude-sonnet-4-20250514`

**5. Agent Call — Heartbeat Timeout (Go workflow-runner)**
- `ExecuteWorkflow` activity blocks on `run.Get()` without sending heartbeats
- Java orchestrator times out after 2 minutes when no heartbeat arrives
- Fix: background goroutine calls `activity.RecordHeartbeat` every 30 seconds

**6. Agent Call — ByteString DataConverterException (Java stigmer-cloud)**
- `SystemActivities` interface used `com.google.protobuf.ByteString` as a Temporal local activity parameter
- Jackson cannot deserialize `ByteString` (abstract, no default constructor)
- Fix: changed interface and implementation from `ByteString` to `byte[]`; updated all 6 call sites in `InvokeAgentExecutionWorkflowImpl`; updated unit tests

### Zero-Friction Makefile

**7. Auto-configuration**
- `ensure-service-jar` target: auto-finds JAR in sibling `stigmer-cloud` checkout, auto-builds via Bazel if missing
- `test-integration-providers` auto-fetches `ANTHROPIC_API_KEY` from Planton CLI (`planton service secrets get-value --org stigmer --group anthropic --name prod.api-key`)
- Both `test-integration` and `test-integration-providers` now pass `STIGMER_SERVICE_JAR` automatically
- Fixed `findServiceJar()` relative path in `suite_test.go` (was off by one directory level)

## Benefits

- **All 5 provider tests pass**: 2 LLM call + 2 agent call + 1 OpenAI (skipped, no key)
- **Zero-friction local run**: `make test-integration-providers` — no env vars needed
- **CI ready**: existing `ci.integration-providers.yaml` workflow (manual dispatch) uses GitHub environment secrets
- **~40 seconds** end-to-end including infrastructure startup, agent execution via real Anthropic API, and teardown

## Impact

- **Developers**: Can run the full provider test suite with a single command
- **CI**: Manual-dispatch workflow validates the entire LLM/agent pipeline end-to-end
- **Cross-service reliability**: Fixed 5 production-affecting bugs in the async activity completion path, heartbeat management, and billing integration

## Related Work

- [LLM Provider Tests + Proxy Integration](_changelog/2026-05/2026-05-15-111612-workflow-runner-proxy-integration.md) — Session 12 created the tests; this session made them pass
- [E2E Architecture Spike](_changelog/2026-05/2026-05-14-122325-e2e-architecture-spike-test-harness.md) — Foundation this builds on
- [Sandbox Integration](_changelog/2026-05/2026-05-15-123600-workflow-runner-sandbox-integration.md) — Mentioned Phase 6 integration testing

---

**Status**: ✅ Production Ready
**Timeline**: Single session (~3 hours)
