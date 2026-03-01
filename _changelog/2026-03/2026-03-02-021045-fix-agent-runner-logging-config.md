# Replace Agent Runner Logging with Declarative YAML Config

**Date**: March 2, 2026

## Summary

Replaced the fragile `basicConfig` + imperative `setLevel()` logging setup in agent-runner with `logging.config.dictConfig()` backed by a `logging.yaml` file. This is the Python equivalent of Spring Boot's `application.yml` logging section — declarative, atomic, and externalized. Also removed high-frequency debug logs that produced hundreds of lines of noise per execution even when DEBUG was intentionally enabled.

## Problem Statement

The agent-runner service was emitting DEBUG-level log noise (`[STREAM_DIAG]`, `[TOOL_RECONCILE]`, `[TOOL_EARLY]`, `[APPROVAL] NOT_REQUIRED`) during execution, drowning out useful operational logs.

### Pain Points

- **`basicConfig` is fragile**: If any library initializes logging before `setup_logging()` runs, `basicConfig` becomes a silent no-op — the root level and handler are already set, so nothing changes
- **Whack-a-mole suppression**: Every noisy logger required a new `setLevel()` line in Python code, unlike Java services where `application.yml` handles this declaratively
- **No separation of code and config**: Changing a log level required a code change, rebuild, and redeploy
- **High-frequency noise even at DEBUG**: `[STREAM_DIAG]` fired for every streaming chunk (hundreds per execution), `[APPROVAL] NOT_REQUIRED` fired for every read/glob/grep tool call — pure noise with zero diagnostic value

## Solution

Two-pronged fix:

1. **Declarative logging config**: Replaced the imperative `logging_config.py` with `logging.config.dictConfig()` loading from `logging.yaml`. `dictConfig` replaces the entire logging tree atomically — no race conditions with import ordering, no silent no-ops.

2. **Noise reduction**: Removed the highest-frequency debug logs that provide no diagnostic value even when DEBUG is intentionally enabled. Promoted `[APPROVAL] REQUIRED` results to INFO since those are operationally meaningful.

## Implementation Details

### New: `worker/logging.yaml`

Declarative config file with three logger categories:
- **Internal modules** (`worker.activities.graphton`): INFO
- **Third-party infrastructure** (asyncio, httpcore, grpc, etc.): WARNING
- **Third-party operational** (anthropic, temporalio, graphton): INFO

Key settings:
- `disable_existing_loggers: false` — loggers created during imports before `setup_logging()` are preserved and correctly inherit parent levels
- `LOG_LEVEL` env var overrides root level at startup

### Rewritten: `worker/logging_config.py`

46 lines of imperative `setLevel()` calls → 15 lines loading YAML via `dictConfig`.

### Noise removal in `status_builder.py`

- `[STREAM_DIAG]` for expected block types (`input_json_delta`, `tool_use`, `thinking`): removed entirely. Kept INFO log for unexpected types.
- `[TOOL_EARLY]`: removed (one per tool call, confirms early detection worked — no actionable info)
- `[TOOL_RECONCILE]`: removed (one per tool call, confirms temp ID → run ID mapping — pure plumbing)

### Noise removal in `approval_policy.py`

- `[APPROVAL] NOT_REQUIRED` from `platform_default` and `none` sources: removed (fires for every read/glob/grep/ls call)
- `[APPROVAL] BYPASS` (auto_approve_all): removed
- `[APPROVAL] DISABLED` (agent override): removed
- `[APPROVAL] REQUIRED`: promoted from DEBUG to INFO (operationally meaningful)

## Benefits

- **Parity with Java services**: Log levels are now configured in a YAML file, not in code
- **Atomic config**: `dictConfig` eliminates race conditions with library imports
- **Operator-friendly**: Changing log levels is a YAML edit, not a code change
- **Cleaner DEBUG output**: When DEBUG is intentionally enabled, high-value diagnostic logs aren't drowned by per-chunk and per-tool noise

## Impact

- Agent-runner service logging — affects all deployments (local, cloud)
- No behavioral changes to execution logic — only log output is affected
- `LOG_LEVEL` env var continues to work as before

## Related Work

- Prior fix: `919a89ed fix(backend): suppress debug log noise from worker activity loggers` (added the `worker.activities.graphton` setLevel line — this was the band-aid we're now replacing)

---

**Status**: ✅ Production Ready
