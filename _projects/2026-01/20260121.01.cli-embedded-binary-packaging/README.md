# CLI Embedded Binary Packaging

**Created**: 2026-01-21  
**Status**: 🚧 In Progress  
**Type**: Quick Project (1-2 sessions)

## Overview

Package stigmer-server, workflow-runner, and agent-runner binaries inside the Stigmer CLI to create a self-contained distribution that doesn't depend on local filesystem searches for runner binaries.

## Problem Statement

Currently, the CLI searches for binaries in development locations:
- `~/bin/stigmer-server`
- `~/bin/workflow-runner`
- `backend/services/agent-runner/run.sh`
- Various Bazel/make build output directories

This works for development but **fails for production distribution**:
- ❌ Homebrew users don't have local builds
- ❌ Binary release users can't find components
- ❌ Development fallbacks are a trap (technical debt)
- ❌ Version mismatches when rebuilding only one component

## Goal

Make the Stigmer CLI completely self-contained for distribution (Homebrew, releases) by:
1. **Embedding all 4 binaries** at compile time (stigmer-server, workflow-runner, agent-runner)
2. **Extracting on first run** to `~/.stigmer/bin/`
3. **NO FALLBACKS** to development paths (clean separation)
4. **Clean error messages** if binaries missing (user must reinstall)

## Research Summary

Analyzed industry approaches:
- **Pulumi/Terraform**: On-demand plugin downloads (not suitable - requires internet)
- **Docker**: Separate CLI + daemon packages (too complex for local mode)
- **kubectl + kustomize**: Compile-time library integration (only works for Go libraries)
- **Bazelisk**: Wrapper downloads exact version (requires internet, extra layer)
- **✅ Recommended**: Go `embed` package - Embed + Extract pattern

## Architecture

```
stigmer (CLI binary ~150 MB)
  │
  ├── Embedded at compile time:
  │   ├── stigmer-server (~25 MB)
  │   ├── workflow-runner (~20 MB)
  │   └── agent-runner.tar.gz (~80 MB compressed)
  │
  └── Extract on first run to:
      ~/.stigmer/bin/
      ├── stigmer-server
      ├── workflow-runner
      └── agent-runner/
          ├── run.sh
          └── [Python environment]
```

## Technology Stack

- **Language**: Go 1.16+ (embed package)
- **Build System**: Makefile + Bazel
- **Embedding**: `//go:embed` directives
- **Compression**: tar.gz for Python component
- **Target Platforms**: macOS (arm64, amd64), Linux (amd64)

## Affected Components

1. **CLI Daemon Management**
   - `client-apps/cli/internal/cli/daemon/daemon.go`
   - `client-apps/cli/internal/cli/daemon/download.go` (new)
   
2. **Build Scripts**
   - `Makefile` - Add embedded binary targets
   - `.bazelrc` / `BUILD.bazel` files
   
3. **Embedded Binary Logic**
   - `client-apps/cli/embedded/` (new directory)
   - Platform detection
   - Extraction logic
   - Checksum verification

## Success Criteria

- [ ] User runs `brew install stigmer` (or downloads binary)
- [ ] User runs `stigmer server` 
- [ ] All 4 components start successfully from extracted binaries
- [ ] No fallbacks to development paths
- [ ] No errors about missing binaries
- [ ] Works completely offline after initial install
- [ ] Binary size < 200 MB
- [ ] Extraction completes in < 5 seconds

## Tasks

See `tasks.md` for detailed task breakdown and progress tracking.

## Notes

See `notes.md` for design decisions, learnings, and implementation details.

## Related Work

- Research on industry approaches: Pulumi, Terraform, Docker, kubectl, Bazelisk
- Activity naming convention fix (PascalCase for Temporal activities)
