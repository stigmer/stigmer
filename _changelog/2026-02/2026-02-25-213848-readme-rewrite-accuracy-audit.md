# README Rewrite: Accuracy Audit and Simplification

**Date**: February 25, 2026

## Summary

Rewrote the repository README from scratch after a line-by-line audit against the actual codebase. The original 762-line README contained fabricated SDK examples, non-existent CLI commands, wrong prerequisite versions, stale paths, dead links, and triple-repeated sections. Replaced it with a 360-line README where every command, path, and code example has been verified.

## Problem Statement

The README had accumulated significant drift from reality, likely written aspirationally early in the project and never reconciled as the codebase evolved.

### Pain Points

- **Fabricated Python SDK section**: `sdk/python/` does not exist — the entire section was fiction
- **Wrong Go SDK API**: README showed `workflow.New("data-pipeline")` with `wf.Task()` — the real API uses `stigmer.Run()` with Pulumi-aligned struct args
- **Non-existent CLI commands**: `stigmer agent execute`, `stigmer workflow execute`, `stigmer init`, `stigmer login`, `stigmer local restart` — none of these exist
- **Wrong Go version**: Listed "Go 1.21" but `go.work` requires 1.25.6
- **Wrong binary description**: Described "two binaries" but the CLI is a single BusyBox binary
- **Wrong source paths**: `cmd/stigmer/` cited as CLI location; actual path is `client-apps/cli/cmd/stigmer/`
- **Dead link**: `docs/api/` does not exist
- **Wrong workflow YAML syntax**: Showed simplified format that doesn't match the real `kind`/`task_config`/`export`/`flow` schema
- **Leaked proprietary details**: Cloud stack internals (Java Spring Boot, MongoDB, Auth0 + FGA) in a public OSS README
- **Wrong private repo URL**: Referenced `leftbin/stigmer-cloud` (stale org name)
- **Triple-repeated local/cloud explanation**: Same pitch in three separate sections
- **Two architecture diagrams saying the same thing**
- **Missing core concepts**: Skills (a first-class platform concept) absent from documentation

## Solution

Complete rewrite of `README.md` with every claim verified against source code. No content was carried over without validation.

## Implementation Details

### Removed

- Python SDK section (zero files in `sdk/python/`)
- Fabricated Go SDK example (replaced with real `stigmer.Run()` + struct-args pattern from `sdk/go/examples/01_basic_agent.go`)
- All non-existent CLI commands (replaced with actual command surface from `client-apps/cli/cmd/stigmer/root.go`)
- Duplicate architecture diagram
- Storage Strategy 8-bullet sales pitch (condensed to one line in Architecture)
- gRPC protobuf section (implementation detail, belongs in `docs/architecture/`)
- Cloud internal tech stack details
- "Commercial Support" section
- Promotional emoji-heavy copy

### Added

- **Skills** section in Core Concepts with directory structure and `stigmer push` / `stigmer draft skill` commands
- **CLI Reference** table with all 14 verified commands (`run`, `apply`, `get`, `list`, `delete`, `search`, `draft`, `push`, `download`, `validate`, `server`, `mcp-server`, `backend`, `config`)
- **Correct workflow YAML** taken directly from `examples/workflows/hello-world.yaml`
- **Real Go SDK example** using actual `stigmer.Run()` + `agent.New(ctx, name, &agent.AgentArgs{})` pattern
- **Accurate architecture diagram** with correct component paths and BusyBox description

### Fixed

- Go version: 1.21 -> 1.25+
- CLI path: `cmd/stigmer/` -> `client-apps/cli/`
- Binary description: "two binaries" -> single self-contained BusyBox binary
- `stigmer server start` -> `stigmer server` (no `start` subcommand; default action is start)
- All documentation links verified against filesystem

## Benefits

- **Accuracy**: Every command, path, and code example verified against the codebase
- **Reduced size**: 762 lines -> 360 lines (53% reduction) with zero information loss
- **No dead links**: All documentation references point to files that exist
- **Discoverable CLI**: Users can now see the full command surface in one table
- **Complete concepts**: Skills now documented as a first-class concept

## Impact

- All new users and contributors reading the README
- Anyone evaluating the project for adoption
- AI coding assistants using the README for context

## Related Work

- Previous plan: `.cursor/plans/readme_rewrite_ddcc5c2c.plan.md`

---

**Status**: Production Ready
