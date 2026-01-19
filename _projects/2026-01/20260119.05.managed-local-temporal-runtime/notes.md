# Implementation Notes

## ADR Reference

### ADR 018: Managed Local Temporal Runtime

Key points from the ADR:

**Problem**:
- Current: `stigmer local start` requires Docker + Temporal container
- Friction: Heavy setup, Docker dependency
- Violates "Tier 1" local developer experience

**Alternative Considered (Rejected)**:
- Switching to embeddable engines like `go-workflows` or `littlehorse`
- Rejection reason: SDK incompatibility - would need different code for local vs cloud

**Solution**:
- Download Temporal CLI binary to `~/.stigmer/bin/`
- Start with `temporal server start-dev`
- Manage as subprocess in daemon
- Use SQLite for local database (no external DB needed)

**Configuration Precedence** (from ADR 020):
1. CLI Flag: `--temporal-host=my-temporal:7233` (highest)
2. Environment: `TEMPORAL_SERVICE_ADDRESS=my-temporal:7233` (medium)
3. Managed Local: Auto-start binary at `localhost:7233` (default)

## Implementation Strategy

### 1. Binary Management Pattern

The daemon will treat Temporal like it treats the Python agent runner - as a managed subprocess.

**Download Logic**:
```go
func EnsureTemporalBinary(homeDir string) (string, error) {
    binPath := filepath.Join(homeDir, "bin", "temporal")
    
    // Check if exists
    if fileExists(binPath) {
        return binPath, nil
    }
    
    // Download
    version := "v0.13.0" // Or latest
    os := runtime.GOOS    // darwin, linux, windows
    arch := runtime.GOARCH // amd64, arm64
    
    url := fmt.Sprintf(
        "https://github.com/temporalio/cli/releases/download/%s/temporal_%s_%s.tar.gz",
        version, os, arch,
    )
    
    // Download, extract, chmod +x
    return binPath, nil
}
```

**Startup Logic**:
```go
func (s *Supervisor) StartTemporal(ctx context.Context) error {
    binPath := filepath.Join(s.homeDir, "bin", "temporal")
    dbPath := filepath.Join(s.homeDir, "data", "temporal.db")
    
    cmd := exec.CommandContext(ctx, binPath,
        "server", "start-dev",
        "--port", "7233",
        "--ui-port", "8233",
        "--db-filename", dbPath,
        "--log-format", "json",
    )
    
    // Redirect logs
    logFile, _ := os.Create(filepath.Join(s.logDir, "temporal.log"))
    cmd.Stdout = logFile
    cmd.Stderr = logFile
    
    if err := cmd.Start(); err != nil {
        return err
    }
    
    s.temporalCmd = cmd
    log.Printf("✓ Temporal Server started (PID: %d)", cmd.Process.Pid)
    return nil
}
```

### 2. Configuration Resolver

**Go Code Pattern**:
```go
type TemporalConfig struct {
    Host              string
    Port              int
    UIPort            int
    ShouldManageLocal bool
}

func ResolveTemporalConfig(cmd *cobra.Command) TemporalConfig {
    // 1. Check flag
    flagHost, _ := cmd.Flags().GetString("temporal-host")
    if flagHost != "" {
        return TemporalConfig{
            Host: parseHost(flagHost),
            Port: parsePort(flagHost),
            ShouldManageLocal: false,
        }
    }
    
    // 2. Check env
    envHost := os.Getenv("TEMPORAL_SERVICE_ADDRESS")
    if envHost != "" {
        return TemporalConfig{
            Host: parseHost(envHost),
            Port: parsePort(envHost),
            ShouldManageLocal: false,
        }
    }
    
    // 3. Default: managed local
    return TemporalConfig{
        Host: "localhost",
        Port: 7233,
        UIPort: 8233,
        ShouldManageLocal: true,
    }
}
```

### 3. Startup Sequence

**Updated `stigmer local start` Flow**:

```
1. Parse CLI flags
2. Resolve Temporal config (flag > env > default)
3. If ShouldManageLocal:
   a. EnsureTemporalBinary() - download if needed
   b. supervisor.StartTemporal() - start subprocess
4. Else:
   a. Log "Using external Temporal: {host}"
5. Create Temporal client (connects to resolved host)
6. Start rest of daemon components
```

## Design Decisions

### Decision: Use Temporal CLI (not Server Binary)

**Why**:
- `temporal` CLI includes `server start-dev` command
- All-in-one: server + UI + SQLite in one binary
- Simpler than managing separate server binary

### Decision: SQLite for Local Storage

**Why**:
- No external database dependency
- File-based, portable
- Perfect for local development
- Matches Temporal's own dev mode defaults

### Decision: Don't Auto-Install (Prompt User vs Silent)

**Approach**: Silent auto-download (with clear logging)

**Why**:
- True "zero config" experience
- Binary is small (~50MB), acceptable download
- Users can override with flag if they have Temporal elsewhere
- Show progress so it doesn't feel "stuck"

**Alternative Considered**: Prompt user first
- Rejected: Adds friction, users might say "no" and be confused

## File Structure Plan

```
backend/stigmer-daemon/
├── internal/
│   ├── binaries/              # NEW package
│   │   ├── downloader.go      # Generic HTTP download utility
│   │   └── temporal.go        # Temporal-specific download logic
│   ├── supervisor/
│   │   ├── supervisor.go      # Main supervisor (update)
│   │   └── temporal.go        # NEW: Temporal subprocess management
│   └── config/
│       └── temporal.go        # NEW: Config resolver
└── cmd/local/
    └── start.go               # Update: Add --temporal-host flag
```

## Temporal Release URLs

GitHub releases: `https://github.com/temporalio/cli/releases`

**URL Pattern**:
```
https://github.com/temporalio/cli/releases/download/v{VERSION}/temporal_{OS}_{ARCH}.tar.gz
```

**Platform Mappings**:
- macOS Intel: `temporal_darwin_amd64.tar.gz`
- macOS Apple Silicon: `temporal_darwin_arm64.tar.gz`
- Linux Intel: `temporal_linux_amd64.tar.gz`
- Linux ARM: `temporal_linux_arm64.tar.gz`

**Latest Version**: Check `https://api.github.com/repos/temporalio/cli/releases/latest`

## Error Scenarios to Handle

1. **Download fails** (network, GitHub down)
   - Retry with backoff (3 attempts)
   - Clear error message with manual install instructions

2. **Port conflict** (7233 or 8233 already in use)
   - Detect with `net.Listen` test
   - Show error: "Port 7233 in use. Stop other Temporal instance or use --temporal-host"

3. **Disk space** (not enough for binary + SQLite)
   - Check available space before download
   - Need ~500MB for binary + database growth

4. **Permissions** (can't create ~/.stigmer/bin/)
   - Create directories early in startup
   - Show clear error if mkdir fails

5. **Binary corrupted** (partial download, wrong version)
   - Verify size after download
   - Optional: checksum verification
   - Retry if verification fails

6. **Temporal crashes** (binary exits unexpectedly)
   - Monitor process with `cmd.Wait()` in goroutine
   - Log exit code and stderr
   - Fail daemon startup if Temporal exits in first 5 seconds

## Testing Strategy

### Manual Test Cases

1. **First Run (No Binary)**
   ```bash
   # Clean state
   rm -rf ~/.stigmer
   stigmer local start
   
   # Expected:
   # - Downloads binary
   # - Starts Temporal
   # - UI at http://localhost:8233
   # - SQLite DB at ~/.stigmer/data/temporal.db
   ```

2. **Second Run (Cached Binary)**
   ```bash
   stigmer local stop
   stigmer local start
   
   # Expected:
   # - Skips download
   # - Starts quickly
   # - Reuses existing DB
   ```

3. **External Temporal (Flag)**
   ```bash
   stigmer local start --temporal-host=my-temporal:7233
   
   # Expected:
   # - No download
   # - No local Temporal process
   # - Connects to external
   ```

4. **External Temporal (Env)**
   ```bash
   TEMPORAL_SERVICE_ADDRESS=cloud:7233 stigmer local start
   
   # Expected:
   # - No download
   # - No local Temporal process
   # - Connects to external
   ```

5. **Graceful Shutdown**
   ```bash
   stigmer local start
   # Wait for startup
   stigmer local stop
   
   # Expected:
   # - Temporal process exits cleanly
   # - No orphaned processes
   # - Data persists in DB
   ```

### Verification Commands

```bash
# Check if binary downloaded
ls -lh ~/.stigmer/bin/temporal

# Check if Temporal running
ps aux | grep temporal

# Check UI
open http://localhost:8233

# Check logs
tail -f ~/.stigmer/logs/temporal.log

# Check database
ls -lh ~/.stigmer/data/temporal.db
```

## Learnings

_(Will be populated during implementation)_

## Gotchas

_(Will be populated during implementation)_

## Questions/Blockers

- [ ] Does supervisor pattern already exist in daemon code?
- [ ] Is there existing binary download code we can reuse?
- [ ] Should we support Windows in MVP or focus on macOS/Linux first?
- [ ] What version of Temporal CLI to use? (Latest stable vs pinned version)
- [ ] Should we verify checksums or trust GitHub download?

## Related Work

- **Agent Runner Config** (Project `20260119.04`): LLM provider configuration
- Can be done in parallel - no dependencies between projects
- Both contribute to "zero dependency" local experience

## Timeline

**Session 1** (Expected):
- T1: Analyze current code
- T2: Design binary download
- T3: Implement downloader
- T4: Implement binary manager
- T5: Implement config resolver
- T6: Implement subprocess manager

**Session 2** (Expected):
- T7: Add CLI flags
- T8: Integrate with daemon
- T9: Add logging
- T10: Test all scenarios
- T11: Error handling
- T12: Documentation

---

## Scratchpad

_(Use this space for quick notes during implementation)_
