# Cursor Harness Proto Foundation

**Date**: April 30, 2026

## Summary

Added the `Harness` concept to the Stigmer proto layer, enabling sessions to choose between different execution engines. This is the foundational proto change for the Cursor harness integration -- a new premium execution tier that wraps the Cursor SDK alongside the existing LangGraph engine. Also added `MESSAGE_THINKING` to `MessageType` for models with extended thinking capabilities.

## Problem Statement

Stigmer currently supports a single execution engine (LangGraph via Python). To offer a premium tier powered by the Cursor SDK, the platform needs a way to express which execution engine a session uses, so the Go workflow can dispatch to the correct Temporal activity type.

### Pain Points

- No mechanism to select an execution engine per session
- No `MessageType` value for model thinking/reasoning content (relevant for Claude extended thinking, Cursor thinking events)
- Adding a second execution engine requires a clean abstraction at the proto layer before any runtime work can begin

## Solution

Introduced the `Harness` enum and `SessionSpec.harness` field as additive, non-breaking proto changes. The harness concept separates *where* work runs (runner) from *how* it runs (harness), following the existing pattern where `runner_id` controls infrastructure routing.

## Implementation Details

### Three proto changes across two packages

1. **`Harness` enum** in `session/v1/enum.proto` -- Three values: `HARNESS_UNSPECIFIED` (defaults to LangGraph), `HARNESS_LANGGRAPH`, `HARNESS_CURSOR`. Placed alongside `GitWriteBackMode` following the existing enum organization pattern.

2. **`SessionSpec.harness`** field (number 10) in `session/v1/spec.proto` -- New import of `enum.proto`, field added at the end of `SessionSpec`. Field 10 is the next sequential number (corrected from the original plan's field 11 to avoid an unexplained gap).

3. **`MESSAGE_THINKING = 5`** in `agentexecution/v1/enum.proto` -- Added to `MessageType` enum. This is harness-agnostic: LangGraph with Claude extended thinking can also emit thinking events.

### Codegen propagation

`make codegen` regenerated 46 files across all language stubs (Go, Java, Python, TypeScript), SDKs (Go, Java, Python, TypeScript), MCP server codegen, documentation, and schema files. `make protos` in stigmer-cloud regenerated the cloud stubs.

### Design decisions

- **Field number 10** (not 11): SessionSpec uses fields 1-9 with no gaps and no `reserved` declarations. Using 10 avoids creating an unexplained gap.
- **Enum in `enum.proto`** (not inline): Follows the package convention where shared enums live in a dedicated `enum.proto` file.
- **No validation constraints**: All `Harness` values are valid at the proto layer. `UNSPECIFIED` defaulting to LangGraph is handled in server logic (T04).
- **No Runner proto changes**: The Runner is infrastructure and remains harness-agnostic.

## Benefits

- Clean proto foundation for multi-harness architecture
- Fully backward compatible -- existing sessions default to `HARNESS_UNSPECIFIED` (LangGraph)
- All language stubs (Go, Java, Python, TypeScript, Dart) generated and compilable
- `MESSAGE_THINKING` independently useful for Claude extended thinking in the LangGraph harness

## Impact

- **Proto contract**: Additive changes only, no breaking changes
- **All SDKs**: Updated with new types (auto-generated)
- **Documentation**: SDK docs updated with new session field and execution enum value
- **Cloud stubs**: Regenerated in stigmer-cloud
- **No runtime behavior change**: The harness field is present but not yet read by any workflow or activity

## Related Work

- Part of project `20260430.01.cursor-harness` (T01 of 9 tasks)
- Next: T02 (HITL Research Spike) and T03 (Cursor Runner TypeScript Service)
- Downstream consumers: T04 (Go Workflow Dispatch) will read `session.spec.harness` to route activities

---

**Status**: Production Ready
**Timeline**: Single session
