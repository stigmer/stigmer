# Managed Local Temporal Runtime

**Created**: 2026-01-19  
**Status**: 🚧 In Progress  
**Tech Stack**: Go, Temporal CLI, SQLite  
**Components**: Daemon, Supervisor, Binary Manager

## Overview

Implement automatic Temporal binary management to eliminate Docker dependency for local development. Currently, users must manually install Docker and run Temporal containers, creating friction. This project implements a "managed binary" pattern where the Stigmer daemon automatically downloads, starts, and manages a local Temporal server instance.

## Goal

Enable users to run `stigmer local start` with **zero external dependencies**:
- ✅ No Docker required
- ✅ No manual Temporal installation
- ✅ No database setup (uses SQLite)
- ✅ Automatic binary download on first run
- ✅ Managed subprocess lifecycle
- ✅ Support for external Temporal (cloud or self-hosted)

## Background

From **ADR 018: Managed Local Temporal Runtime**, the problem is:
- Current: `stigmer local start` requires Docker + Temporal container
- Friction: Heavy setup, violates "Tier 1" local developer experience
- Alternative considered: Different workflow engine (rejected - breaks SDK compatibility)
- Solution: Manage Temporal CLI binary as a subprocess

## Primary Changes

### 1. Binary Manager
- Check for `temporal` CLI in `~/.stigmer/bin/`
- Download from GitHub releases on first run (detect OS/arch)
- Verify checksum (optional but recommended)

### 2. Supervisor Integration
- Start Temporal as managed subprocess: `temporal server start-dev`
- Configure SQLite backend: `--db-filename ~/.stigmer/data/temporal.db`
- Configure ports: `--port 7233 --ui-port 8233`
- Pipe logs to `~/.stigmer/logs/temporal.log`
- Graceful shutdown when daemon stops

### 3. Cascading Configuration
Implement precedence: **CLI Flag > Environment Variable > Managed Default**

```
--temporal-host=cloud.temporal.io:7233
    ↓ (if not set)
TEMPORAL_SERVICE_ADDRESS=my-temporal:7233
    ↓ (if not set)
Managed Local (localhost:7233 + auto-start binary)
```

### 4. User Experience
**Old (Docker)**:
```bash
# User does manually:
docker run -d temporalio/auto-setup:latest
stigmer local start
```

**New (Managed)**:
```bash
# User runs once:
stigmer local start

# Output:
[•] Stigmer Local Daemon starting...
[!] Temporal not found locally.
[⬇] Downloading Temporal CLI v0.13.0 (darwin/arm64)... 100%
[✓] Temporal binary installed to ~/.stigmer/bin/temporal
[✓] Temporal Server started (PID: 4521)
[✓] UI available at http://localhost:8233
[✓] Stigmer Daemon Ready.
```

## Affected Components

- `backend/stigmer-daemon/internal/supervisor/` - Process management
- `backend/stigmer-daemon/internal/binaries/` - Binary download logic (new)
- `backend/stigmer-daemon/internal/config/` - Configuration resolver
- `cmd/local/start.go` - CLI flags and startup logic

## Success Criteria

- ✅ First run auto-downloads Temporal binary (~50MB)
- ✅ Subsequent runs skip download (cached)
- ✅ Temporal starts automatically with daemon
- ✅ SQLite database created at `~/.stigmer/data/temporal.db`
- ✅ UI accessible at `http://localhost:8233`
- ✅ Logs written to `~/.stigmer/logs/temporal.log`
- ✅ Graceful shutdown when daemon stops
- ✅ Can override with `--temporal-host` flag or env var
- ✅ No Docker dependency
- ✅ Works offline after first download

## Technical Approach

### Architecture Pattern: "Managed Binary Subprocess"

Similar to how daemon manages Python agent runner, it will manage Temporal:

```go
type Supervisor struct {
    temporalCmd    *exec.Cmd
    temporalCancel context.CancelFunc
    homeDir        string
    logDir         string
}

func (s *Supervisor) StartTemporal(ctx context.Context) error {
    // 1. Ensure binary exists (download if needed)
    // 2. Construct command with args
    // 3. Redirect logs to file
    // 4. Start subprocess
    // 5. Track PID
}

func (s *Supervisor) StopTemporal() error {
    // Graceful shutdown
}
```

### Binary Download Strategy

1. **Detect platform**: `runtime.GOOS`, `runtime.GOARCH`
2. **Construct URL**: `https://github.com/temporalio/cli/releases/download/v{VERSION}/temporal_{OS}_{ARCH}.tar.gz`
3. **Download with progress**: Show progress bar (optional)
4. **Extract to**: `~/.stigmer/bin/temporal`
5. **Make executable**: `chmod +x`
6. **Cache**: Skip download if binary exists

### Configuration Resolver

```go
type TemporalConfig struct {
    Host                string
    Port                int
    UIPort              int
    ShouldManageLocal   bool
}

func ResolveTemporalConfig(cmd *cobra.Command) TemporalConfig {
    // 1. Check --temporal-host flag
    // 2. Check TEMPORAL_SERVICE_ADDRESS env
    // 3. Default: localhost:7233 + ShouldManageLocal=true
}
```

## File Structure

```
backend/stigmer-daemon/
├── internal/
│   ├── binaries/              # NEW
│   │   ├── temporal.go        # Download & install logic
│   │   └── downloader.go      # Generic HTTP downloader
│   ├── supervisor/
│   │   ├── supervisor.go      # Main supervisor (update)
│   │   └── temporal.go        # NEW: Temporal process management
│   └── config/
│       └── temporal.go        # NEW: Config resolver
└── cmd/local/
    └── start.go               # Update: Add flags, call resolver
```

## Non-Goals (Out of Scope)

- Managing Ollama (separate project)
- Managing LLM configuration (separate project `20260119.04`)
- Temporal Cloud integration (only connection config)
- Temporal version management/upgrades (use latest stable for now)
- Windows-specific testing (focus on macOS/Linux first)

## Related ADRs

- **ADR 018**: Managed Local Temporal Runtime (this project)
- **ADR 020**: Hybrid Configuration & Smart Defaults (cascading config)

## Task Breakdown

See `tasks.md` for detailed task list.

## Notes

See `notes.md` for implementation notes and learnings.

## Quick Resume

Drag `next-task.md` into chat to resume where you left off!
