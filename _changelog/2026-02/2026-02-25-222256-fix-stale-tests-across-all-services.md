# Fix Stale Tests Across All Services

**Date**: February 25, 2026

## Summary

Aligned test suites across the entire monorepo with their corresponding production code. Production changes to the workflow converter, SDK enum serialization, CLI approval display, seedpack versioning, and Python agent-runner modules had left 35+ tests broken. All tests now pass under `make check`.

## Problem Statement

`make check` was failing with exit code 2 due to multiple test failures scattered across Go backend services, the Go SDK, the CLI, and the Python agent-runner service.

### Pain Points

- Proto-to-YAML converter tests expected flat `wait: 5` but production now emits nested `wait: { seconds: 5 }`
- SDK workflow builder used `string(int32)` to serialize enum values, producing Unicode codepoints (`\u0001`) instead of proto enum names (`for_each`)
- SDK `WaitTaskConfig` was serialized as flat `{"seconds": N}` instead of the proto-required `{"duration": {"seconds": N}}`
- CLI tests referenced old approval display layout, stale verb count (8 vs 9), and removed inline-skill filtering behavior
- Python agent-runner tests patched module-level attributes that moved to lazy imports or different source modules
- Seedpack MCP server version bumped to v0.0.18 but test still expected v0.0.17
- Agent-creator skill content was updated but tests expected old discovery counts

## Solution

Systematically identified every failing test, read the production code to understand what changed, and updated each test to match the current behavior. No production code was modified except for two genuine bugs in the SDK (enum serialization and wait config structure).

## Implementation Details

### Go Backend (converter)
- `proto_to_yaml_test.go`: Changed assertion from `"wait: 5"` to `"seconds: 5"`
- `seedpack_test.go`: Updated expected MCP server version to `v0.0.18`

### Go SDK (workflow)
- `proto.go`: Fixed `waitTaskConfigToMap` to produce `{"duration": {"seconds": N}}`
- `tasks_control.go`: Changed `string(task.Kind)` to `task.Kind.String()` in 3 locations
- `tasks_control_test.go`: Updated all `string(TaskKindX)` comparisons to `TaskKindX.String()`

### CLI Tests
- `run_display_approval_test.go`: Adjusted for mutually-exclusive Message/Arguments display
- `verb_support_test.go`: Updated expected count from 8 to 9 for new `VerbDownload`
- `skill_validation_test.go`: Updated for deferred inline-skill filtering
- `config_test.go`: Changed from `NoError` to `Error` assertion for invalid YAML

### Python Agent-Runner (27 tests)
- `test_checkpointer_factory.py`: Switched from module-level patches to `sys.modules` injection for lazy imports
- `test_subagent_transformer.py` / `test_integration_subagent_pipeline.py`: Updated patch targets to source modules
- `test_status_builder.py`: Added `pending_approvals = []` to fixture, updated platform tool expectations
- `test_integration_skill_pipeline.py`: Aligned with name-based directory resolution and progressive-disclosure prompt format

### Seedpack
- Updated agent-creator skill content and references (new sub-agents.md, validation-checklist.md; removed stale schema.md, validation.md)

## Benefits

- `make check` passes cleanly with exit code 0
- CI pipeline unblocked for the `feat/add-agent-creator` branch
- No production behavior changes (only two SDK bug fixes that were already causing runtime panics)

## Impact

- **All services**: Backend converter, SDK workflow builder, CLI, Python agent-runner, seedpack bootstrap
- **Files changed**: 23 files, +880/-1163 lines
- **Tests fixed**: ~35 across Go and Python test suites

## Related Work

- Follows `feat(cli,seedpack): add stigmer draft agent command and rename system agents` which introduced several of the production changes that made these tests stale

---

**Status**: Production Ready
**Timeline**: Single session
