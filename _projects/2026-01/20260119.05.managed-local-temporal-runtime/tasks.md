# Tasks

## Task 1: Analyze Current Temporal Connection
**Status**: ⏸️ TODO

**Objective**: Understand how the daemon currently connects to Temporal and where the host/port is configured.

**Steps**:
1. Find where Temporal client is created in daemon code
2. Identify current host/port configuration
3. Check if there's any existing binary management code
4. Document current startup sequence
5. Identify where to hook in the "managed binary" logic

**Acceptance**:
- Clear understanding of current Temporal connection flow
- List of files that need changes
- Identified integration points for binary management

---

## Task 2: Design Binary Download Strategy
**Status**: ⏸️ TODO

**Objective**: Define how to safely download and install the Temporal CLI binary.

**Steps**:
1. Determine Temporal CLI version to use (latest stable)
2. Map Go runtime.GOOS/GOARCH to Temporal release names:
   - `darwin/amd64` → `temporal_darwin_amd64`
   - `darwin/arm64` → `temporal_darwin_arm64`
   - `linux/amd64` → `temporal_linux_amd64`
   - `linux/arm64` → `temporal_linux_arm64`
3. Define GitHub release URL pattern
4. Decide on checksum verification (optional for MVP)
5. Plan error handling (download failure, disk space, permissions)

**Acceptance**:
- URL construction logic documented
- Platform mapping defined
- Error scenarios identified

---

## Task 3: Implement Binary Downloader
**Status**: ⏸️ TODO

**Objective**: Create reusable HTTP download utility for binaries.

**Steps**:
1. Create `internal/binaries/downloader.go`
2. Implement `DownloadFile(url, destPath string) error`
3. Add progress tracking (optional - can use simple spinner)
4. Handle HTTP errors, timeouts, retries
5. Verify file was written successfully

**Example Structure**:
```go
package binaries

func DownloadFile(url, destPath string) error {
    // 1. Create HTTP request
    // 2. Download with timeout
    // 3. Write to temp file
    // 4. Move to final destination
    // 5. Return error if any step fails
}
```

**Acceptance**:
- Generic downloader implemented
- Handles common errors
- Works with test URL

---

## Task 4: Implement Temporal Binary Manager
**Status**: ⏸️ TODO

**Objective**: Implement logic to check for, download, and install the Temporal CLI.

**Steps**:
1. Create `internal/binaries/temporal.go`
2. Implement `EnsureTemporalBinary(homeDir string) (string, error)`:
   - Check if `~/.stigmer/bin/temporal` exists
   - If not, detect OS/arch
   - Download from GitHub releases
   - Extract tar.gz (if needed)
   - Make executable (`chmod +x`)
   - Return path to binary
3. Add logging for download progress
4. Handle edge cases (partial downloads, corrupted files)

**Example Structure**:
```go
func EnsureTemporalBinary(homeDir string) (string, error) {
    binPath := filepath.Join(homeDir, "bin", "temporal")
    
    // Check if exists
    if _, err := os.Stat(binPath); err == nil {
        return binPath, nil // Already installed
    }
    
    // Download and install
    log.Println("Temporal CLI not found. Downloading...")
    // ... download logic ...
    
    return binPath, nil
}
```

**Acceptance**:
- Binary auto-downloads on first run
- Subsequent runs skip download
- Binary is executable
- Clear logging of download progress

---

## Task 5: Implement Configuration Resolver
**Status**: ⏸️ TODO

**Objective**: Implement cascading configuration logic for Temporal host.

**Steps**:
1. Create `internal/config/temporal.go`
2. Define `TemporalConfig` struct
3. Implement `ResolveTemporalConfig(cmd *cobra.Command) TemporalConfig`
4. Check precedence:
   - CLI flag `--temporal-host`
   - Environment `TEMPORAL_SERVICE_ADDRESS`
   - Default `localhost:7233` + `ShouldManageLocal=true`
5. Parse host:port correctly
6. Return config with `ShouldManageLocal` flag

**Example Structure**:
```go
type TemporalConfig struct {
    Host              string
    Port              int
    UIPort            int
    ShouldManageLocal bool
}

func ResolveTemporalConfig(cmd *cobra.Command) TemporalConfig {
    // Check flag
    flagHost, _ := cmd.Flags().GetString("temporal-host")
    if flagHost != "" {
        return TemporalConfig{
            Host: parseHost(flagHost),
            Port: parsePort(flagHost),
            ShouldManageLocal: false,
        }
    }
    
    // Check env
    envHost := os.Getenv("TEMPORAL_SERVICE_ADDRESS")
    if envHost != "" {
        return TemporalConfig{
            Host: parseHost(envHost),
            Port: parsePort(envHost),
            ShouldManageLocal: false,
        }
    }
    
    // Default: managed local
    return TemporalConfig{
        Host: "localhost",
        Port: 7233,
        UIPort: 8233,
        ShouldManageLocal: true,
    }
}
```

**Acceptance**:
- Precedence logic works correctly
- `ShouldManageLocal` flag set appropriately
- Host:port parsing handles edge cases

---

## Task 6: Implement Temporal Subprocess Manager
**Status**: ⏸️ TODO

**Objective**: Add Temporal process management to the supervisor.

**Steps**:
1. Create `internal/supervisor/temporal.go`
2. Add fields to `Supervisor` struct:
   ```go
   temporalCmd    *exec.Cmd
   temporalCancel context.CancelFunc
   ```
3. Implement `StartTemporal(ctx context.Context) error`:
   - Call `EnsureTemporalBinary()` to get binary path
   - Construct command: `temporal server start-dev`
   - Add flags: `--port 7233 --ui-port 8233 --db-filename ~/.stigmer/data/temporal.db`
   - Redirect stdout/stderr to `~/.stigmer/logs/temporal.log`
   - Start process with `cmd.Start()`
   - Store cmd reference
4. Implement `StopTemporal() error`:
   - Send graceful shutdown signal
   - Wait for exit with timeout
   - Force kill if timeout exceeded

**Example Structure**:
```go
func (s *Supervisor) StartTemporal(ctx context.Context) error {
    binPath, err := binaries.EnsureTemporalBinary(s.homeDir)
    if err != nil {
        return fmt.Errorf("failed to ensure temporal binary: %w", err)
    }
    
    dbPath := filepath.Join(s.homeDir, "data", "temporal.db")
    logPath := filepath.Join(s.logDir, "temporal.log")
    
    cmd := exec.CommandContext(ctx, binPath,
        "server", "start-dev",
        "--port", "7233",
        "--ui-port", "8233",
        "--db-filename", dbPath,
    )
    
    logFile, _ := os.Create(logPath)
    cmd.Stdout = logFile
    cmd.Stderr = logFile
    
    if err := cmd.Start(); err != nil {
        return fmt.Errorf("failed to start temporal: %w", err)
    }
    
    s.temporalCmd = cmd
    log.Printf("✓ Temporal Server started (PID: %d)", cmd.Process.Pid)
    return nil
}
```

**Acceptance**:
- Temporal starts as subprocess
- SQLite database created
- Logs written to file
- PID tracked correctly

---

## Task 7: Update CLI Command with Flags
**Status**: ⏸️ TODO

**Objective**: Add `--temporal-host` flag to `stigmer local start` command.

**Steps**:
1. Locate `cmd/local/start.go`
2. Add persistent flag:
   ```go
   startCmd.PersistentFlags().String("temporal-host", "", 
       "Temporal server address (default: managed local)")
   ```
3. Update command help text
4. Wire flag to configuration resolver

**Acceptance**:
- Flag registered and parseable
- Help text updated
- Flag accessible in start handler

---

## Task 8: Integrate with Daemon Startup
**Status**: ⏸️ TODO

**Objective**: Wire the configuration resolver and Temporal manager into the daemon startup sequence.

**Steps**:
1. Update `cmd/local/start.go` RunStart function
2. Call `ResolveTemporalConfig(cmd)` early
3. Conditional logic:
   ```go
   if config.ShouldManageLocal {
       log.Println("[•] No custom Temporal host. Starting managed local server...")
       supervisor.StartTemporal(ctx)
   } else {
       log.Printf("[•] Using external Temporal: %s:%d\n", config.Host, config.Port)
   }
   ```
4. Pass config to Temporal client creation
5. Ensure graceful shutdown calls `supervisor.StopTemporal()`

**Acceptance**:
- Daemon starts Temporal when no external config
- Daemon skips Temporal when flag/env provided
- Temporal client connects to correct host
- Cleanup on shutdown

---

## Task 9: Add Startup Logging
**Status**: ⏸️ TODO

**Objective**: Make daemon startup output clearly show Temporal configuration.

**Steps**:
1. Log when downloading binary:
   ```
   [!] Temporal CLI not found.
   [⬇] Downloading Temporal CLI v0.13.0 (darwin/arm64)... 
   [✓] Binary installed to ~/.stigmer/bin/temporal
   ```
2. Log when starting server:
   ```
   [✓] Temporal Server started (PID: 4521)
   [✓] UI available at http://localhost:8233
   [✓] Database: ~/.stigmer/data/temporal.db
   ```
3. Log when using external:
   ```
   [•] Using external Temporal: cloud.temporal.io:7233
   [•] Skipping local Temporal startup
   ```
4. Show configuration source:
   ```
   [•] Temporal config from: CLI flag --temporal-host
   ```

**Acceptance**:
- Clear, user-friendly logging
- Easy to verify configuration
- Progress feedback during download

---

## Task 10: Test All Configuration Scenarios
**Status**: ⏸️ TODO

**Objective**: Manually test all configuration combinations.

**Test Cases**:
1. **First run (no config, no binary)**:
   - Should: Download binary, start local Temporal
   - Verify: UI at localhost:8233, SQLite DB created

2. **Second run (cached binary, no config)**:
   - Should: Skip download, start local Temporal
   - Verify: Fast startup, same DB reused

3. **With --temporal-host flag**:
   - Run: `stigmer local start --temporal-host=my-temporal:7233`
   - Should: Skip binary download, connect to external
   - Verify: No local Temporal process

4. **With TEMPORAL_SERVICE_ADDRESS env var**:
   - Run: `TEMPORAL_SERVICE_ADDRESS=cloud:7233 stigmer local start`
   - Should: Skip binary download, connect to external
   - Verify: No local Temporal process

5. **Flag overrides env**:
   - Set: `TEMPORAL_SERVICE_ADDRESS=cloud:7233`
   - Run: `stigmer local start --temporal-host=localhost:7233`
   - Should: Use localhost (flag takes precedence)

6. **Graceful shutdown**:
   - Start daemon with local Temporal
   - Stop daemon
   - Verify: Temporal process exits cleanly

**Acceptance**:
- All test cases pass
- No process leaks
- Clear logging in all scenarios

---

## Task 11: Handle Error Cases
**Status**: ⏸️ TODO

**Objective**: Ensure robust error handling for common failure scenarios.

**Error Scenarios**:
1. **Download fails** (network error, GitHub down)
   - Show clear error message
   - Suggest manual installation
   
2. **Insufficient disk space**
   - Check before download
   - Show space requirement

3. **Port already in use** (7233 or 8233)
   - Detect port conflict
   - Show helpful error message

4. **Temporal crashes after start**
   - Monitor process health
   - Log crash details
   - Fail daemon startup

5. **Permission denied** (can't create ~/.stigmer/bin/)
   - Show clear error
   - Suggest fix

**Acceptance**:
- All error cases handled gracefully
- User-friendly error messages
- No silent failures

---

## Task 12: Update Documentation
**Status**: ⏸️ TODO

**Objective**: Document the new zero-dependency experience.

**Steps**:
1. Update CLI help text for `--temporal-host` flag
2. Add documentation about:
   - Automatic Temporal download
   - Where files are stored (`~/.stigmer/bin/`, `~/.stigmer/data/`)
   - How to use external Temporal
   - Environment variable options
3. Add troubleshooting section:
   - What to do if download fails
   - How to verify Temporal is running
   - How to clean up and re-download

**Acceptance**:
- Documentation complete and accurate
- Examples work as written
- Troubleshooting covers common issues

---

## Summary

**Total Tasks**: 12  
**Status**: ⏸️ Not Started

**Critical Path**:
1. Analyze current code (T1)
2. Implement binary download (T3, T4) 
3. Implement config resolver (T5)
4. Implement subprocess manager (T6)
5. Wire into daemon (T7, T8, T9)
6. Test thoroughly (T10, T11)
7. Document (T12)

**Estimated Duration**: 2 sessions (4-5 hours)

**Dependencies**:
- None (independent from LLM config project)
- Can be done in parallel with project `20260119.04`
