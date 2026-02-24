# Fix Debug Log Propagation via Supervisor Config

**Date**: February 24, 2026

## Summary

Replaced hardcoded `LOG_LEVEL=DEBUG` in the supervisor with a configurable value propagated from stigmer-server's config. All child components (agent-runner, workflow-runner) now default to INFO, with debug logging available on-demand via a single environment variable.

## Problem Statement

The Agent Runner was flooding logs with DEBUG-level output during normal operation, making it difficult to spot meaningful INFO-level messages in the log stream.

### Pain Points

- Agent Runner output overwhelmed by `[STREAM_DIAG]` debug messages from `status_builder`
- Debug logs appeared on every `input_json_delta` streaming event (dozens per second during LLM tool calls)
- No way to turn off debug logging without code changes -- the supervisor hardcoded `LOG_LEVEL=DEBUG` for both child components
- The existing `logging_config.py` infrastructure was correctly designed but bypassed by the hardcoded values

## Solution

Threaded the log level through the supervisor config so it reads from the parent process's `LOG_LEVEL` environment variable (via `config.Config.LogLevel`, which defaults to `"info"`). The supervisor now propagates this value to both the workflow-runner subprocess and the agent-runner Docker container.

## Implementation Details

- Added `LogLevel string` field to `supervisor.Config` struct
- Propagated `cfg.LogLevel` (uppercased) from `loadSupervisorConfig()` in `server.go`
- Replaced `"LOG_LEVEL=DEBUG"` with `fmt.Sprintf("LOG_LEVEL=%s", s.config.LogLevel)` in both `startWorkflowRunner()` and `startAgentRunner()`
- Changed local kustomize overlay default from `DEBUG` to `INFO`

## Benefits

- Clean, quiet default log output -- only INFO and above
- Single control point: set `LOG_LEVEL=DEBUG` on stigmer-server to cascade to all children
- Per-component override still possible via direct env var on individual components
- Zero changes needed in Python or Go logging infrastructure -- it was already correct

## Impact

- **Agent Runner**: No more debug log noise in normal operation
- **Workflow Runner**: Same fix applied for consistency
- **Operators**: Can enable debug logging when needed for troubleshooting, then turn it off

## Related Work

- `logging_config.py` (agent-runner) -- already correctly reads `LOG_LEVEL` and pins third-party libraries
- `root.go` (workflow-runner) -- already reads `LOG_LEVEL` via viper

---

**Status**: Production Ready
**Files Changed**: 3 (supervisor.go, server.go, service.yaml)
