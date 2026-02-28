# DD-01: Seedpack Stays in `backend/services/stigmer-server/pkg/seedpack/`

**Date**: 2026-02-28
**Status**: Decided

## Decision

Keep the seedpack content in its current location (`backend/services/stigmer-server/pkg/seedpack/`) and add `stigmer.yaml` to make it a proper Stigmer project in place.

## Context

The seedpack contains skills, agents, and MCP server definitions embedded in the server binary via Go's `embed` directive. We want to make it a declarative Stigmer project (with `stigmer.yaml`) so it can be applied with `stigmer apply` and serve as a reference for customers.

## Options Considered

### A. Keep in place, add `stigmer.yaml` (CHOSEN)
- Pro: Zero build changes — `embed.go` works unchanged
- Pro: `stigmer apply` works from the directory
- Pro: Simplest approach
- Con: Path is deep and not immediately visible

### B. Move to top-level `seedpack/` directory
- Pro: More visible and discoverable
- Con: Go `embed` cannot reach parent directories — requires build-time copy step
- Con: Two copies of files, sync can go stale
- Con: Added build complexity (Bazel genrule or Makefile)

### C. Separate public repository
- Pro: Most "open"
- Con: Requires git submodule or vendor step
- Con: Breaks simple builds
- Con: Coordination overhead

## Rationale

Go's `embed` directive physically cannot embed files from parent directories. Any move requires a build-time sync mechanism. The simplest approach that achieves all goals (project format, testable, reference for customers) is adding `stigmer.yaml` in place. A mention in the top-level README provides discoverability.
