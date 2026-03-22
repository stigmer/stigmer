# Seedpack Cloud Bootstrap via CLI

**Date**: March 22, 2026

## Summary

Added a new `stigmer seedpack apply` command that enables bootstrapping cloud-based stigmer-service instances with embedded system resources. Previously, seedpack bootstrap only ran during local daemon startup. This change extracts the bootstrap logic into a reusable package and exposes it as a backend-agnostic CLI command that works against both local and cloud backends.

## Problem Statement

The seedpack — containing system agents (agent-creator, skill-creator, mcp-server-creator, assistant), skills, and MCP server definitions — was only applied automatically during local daemon startup. There was no mechanism to apply these system resources to the cloud stigmer-service.

### Pain Points

- Cloud stigmer-service instances had no system agents or skills after deployment
- The seedpack bootstrap logic was tightly coupled to the daemon startup flow in `daemon.go`
- No way to check whether the seedpack had been applied or was up to date
- Operators had no explicit control over when seedpack resources were applied

## Solution

Extracted the seedpack bootstrap logic into a standalone `seedpackbootstrap` package and created a new `stigmer seedpack` command group with `apply` and `status` subcommands. The approach preserves the "one code path for everything" principle — seedpack resources are applied through the same `stigmer apply` flow as user-authored resources.

## Implementation Details

### New Package: `internal/cli/seedpackbootstrap/`

Three files following single-responsibility principle:

- **`bootstrap.go`** — Core `Apply()` function with content-hash idempotency, recursion guard, two-phase apply (organizations first, then project members)
- **`apply.go`** — Subprocess execution for the two apply phases
- **`status.go`** — `CurrentHash()` and `MarkerStatus()` for introspection

### New Command: `stigmer seedpack`

- **`stigmer seedpack apply`** — Extracts embedded seedpack, applies to configured backend. Supports `--force` to skip hash check. Supports `--json` and `--quiet` output formats.
- **`stigmer seedpack status`** — Shows embedded hash, applied hash, and whether the seedpack is up to date.

### Refactored: `daemon.go`

`EnsureSeedpackBootstrapped` reduced from ~110 lines to a 5-line delegation to `seedpackbootstrap.Apply()`. Four seedpack-specific constants removed from daemon package.

### Key Design Decisions

- **No `--org` flag on seedpack command** — The global `--org` flag serves a different purpose (user's org context). Seedpack org defaults to "stigmer" and is overridable via `STIGMER_SEEDPACK_ORG` env var, consistent with existing daemon behavior.
- **Marker directory varies by backend type** — `~/.stigmer/data/` for local (backward compatible), `~/.stigmer/` for cloud.
- **Backend-agnostic** — The command applies to whatever backend the CLI is configured for. No cloud-specific handling needed.

## Benefits

- Cloud stigmer-service instances can now be bootstrapped with system resources using a single CLI command
- Operators have explicit control and visibility into seedpack state
- The seedpack bootstrap logic is reusable and testable in isolation
- Local daemon behavior is unchanged — zero regression risk
- Foundation for CI/CD integration (e.g., Kubernetes Job during deployment)

## Impact

- **CLI users (local mode)**: No change — seedpack still auto-applies on daemon startup
- **CLI users (cloud mode)**: New capability — can now bootstrap cloud backends
- **Operators**: New `stigmer seedpack status` provides visibility into seedpack state
- **Codebase**: Net reduction of ~100 lines in daemon.go; cleaner separation of concerns

## Related Work

- Seedpack embed system (`seedpack/` package) — unchanged, continues to bundle system resources
- Declarative apply flow (`apply_declarative.go`) — reused by the seedpack command via subprocess
- Backend switching (`stigmer config backend set cloud`) — prerequisite for cloud seedpack apply

---

**Status**: ✅ Production Ready
**Timeline**: Single session
