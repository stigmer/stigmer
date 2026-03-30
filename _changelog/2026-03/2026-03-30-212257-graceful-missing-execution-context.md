# Graceful Handling of Missing ExecutionContext in Agent Runner

**Date**: March 30, 2026

## Summary

Fixed a crash in the agent-runner where executions with no secrets or environment variables would fail with a `ValueError` because no `ExecutionContext` resource existed. The runner now gracefully proceeds with an empty environment when no context is found.

## Problem Statement

Agent executions were failing when the agent had no secrets or environment variables configured.

### Pain Points

- Agents without any `env_spec`, `environment_refs`, or `runtime_env` would crash during the setup phase with: `No ExecutionContext found for execution <id>. The workflow must create an ExecutionContext with merged environment variables before starting the activity.`
- The error was misleading — it implied a workflow bug, when in reality the agent simply had nothing to configure
- Users running simple agents (e.g. a biography lookup) could not execute them at all

## Solution

Made `resolve_environment` in the agent-runner return an empty `EnvironmentResult` instead of raising a `ValueError` when no `ExecutionContext` is found. This aligns the runner with the stigmer-service's intentional behavior of skipping `ExecutionContext` creation when the merged environment is empty.

## Implementation Details

The root cause was a mismatch between two components:

- **stigmer-service** (`CreateExecutionContextStep.java`): Correctly skips `ExecutionContext` creation when `filteredEnv` is empty after merging all environment sources
- **agent-runner** (`environment.py`): Treated a missing `ExecutionContext` as a fatal error, raising `ValueError`

The fix in `backend/services/agent-runner/worker/activities/graphton/environment.py`:
- Replaced the `raise ValueError(...)` with an info-level log and early return of `EnvironmentResult(merged_env_vars={}, secret_keys=set())`
- Updated the docstring to document that a missing `ExecutionContext` is a valid scenario

## Benefits

- Agents without secrets/env vars can now execute successfully
- Clearer logging — info message instead of an error stack trace
- No unnecessary `ExecutionContext` resources created on the service side

## Impact

All agent executions that have no environment configuration (no `env_spec`, no `environment_refs`, no `runtime_env`) will now proceed normally instead of failing at setup.

---

**Status**: Production Ready
