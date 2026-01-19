# Improve `stigmer local` Command UI and Logging

**Date**: 2026-01-19  
**Status**: ✅ Complete

## Problem

When running `stigmer local`, raw JSON logs from `zerolog` were displayed to the user, creating an unsophisticated and confusing experience:

```
stigmer local
ℹ Starting local mode...
{"level":"debug","data_dir":"/Users/suresh/.stigmer/data","time":"2026-01-19T16:45:07+05:30","message":"Starting daemon"}
{"level":"debug","llm_provider":"ollama","llm_model":"qwen2.5-coder:7b","llm_base_url":"http://localhost:11434","time":"2026-01-19T16:45:07+05:30","message":"Resolved LLM configuration"}
✓ Using Ollama (no API key required)
{"level":"debug","temporal_address":"localhost:7233","temporal_managed":true","time":"2026-01-19T16:45:07+05:30","message":"Resolved Temporal configuration"}
...
```

These debug logs should only appear when `--debug` flag is used, and the UI should be more sophisticated like the Planton Cloud CLI.

## Solution

### 1. Added Global Debug Flag

Added a `--debug` flag to the root command that controls log output:

```go
var rootCmd = &cobra.Command{
    // ...
    PersistentPreRun: func(cmd *cobra.Command, args []string) {
        if debugMode {
            // Debug mode: pretty console output with debug level
            log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr})
            zerolog.SetGlobalLevel(zerolog.DebugLevel)
        } else {
            // Normal mode: disable zerolog output
            zerolog.SetGlobalLevel(zerolog.Disabled)
        }
    },
}
```

### 2. Configured Zerolog Properly

- **Normal mode** (default): `zerolog.Disabled` - no JSON logs shown
- **Debug mode** (`--debug` or `-d`): Pretty console output with detailed debug logs

### 3. Added Progress Display to Daemon Startup

Enhanced the daemon startup with sophisticated UI using bubbletea/lipgloss:

```go
// Create progress display with phases
progress := cliprint.NewProgressDisplay()
progress.Start()
progress.SetPhase(cliprint.PhaseStarting, "Preparing environment")

// Start daemon with progress tracking
daemon.StartWithOptions(dataDir, daemon.StartOptions{Progress: progress})
```

The daemon startup now shows progress through multiple phases:
- **Initializing**: Setting up data directory, loading configuration
- **Installing**: Setting up Temporal CLI
- **Deploying**: Starting Temporal server and Stigmer server
- **Starting**: Launching agent runner

### 4. User-Friendly Status Messages

Replaced raw logs with clean, colored status messages:

```
ℹ Starting local mode...
   ⠙ Initializing: Setting up data directory
   ✓ Initializing: done
   ⠙ Installing dependencies
   ✓ Installing dependencies: done
✓ Using Ollama (no API key required)
   ⠙ Starting Temporal server
   ✓ Deploying: done
✓ Ready! Stigmer is running
  PID:  12345
  Port: 50051
  Data: /Users/suresh/.stigmer/data

Temporal UI: http://localhost:8233
```

## Changes Made

**Files Modified:**

1. `/client-apps/cli/cmd/stigmer/root.go`
   - Added `debugMode` flag
   - Added `PersistentPreRun` to configure zerolog based on debug flag
   
2. `/client-apps/cli/internal/cli/daemon/daemon.go`
   - Added `StartOptions` struct with optional `Progress` field
   - Created `StartWithOptions()` function
   - Added progress tracking throughout daemon startup
   - User-friendly messages when progress display is available

3. `/client-apps/cli/internal/cli/cliprint/progress.go`
   - Added `PhaseStarting` constant for daemon startup phase

4. `/client-apps/cli/cmd/stigmer/root/local.go`
   - Updated `handleLocalStart()` to use progress display
   - Changed to use new `PrintSuccess()` and `PrintInfo()` functions

## Usage

### Normal Mode (Clean UI)

```bash
stigmer local
```

Output shows clean progress indicators and success messages without JSON logs.

### Debug Mode (Detailed Logs)

```bash
stigmer local --debug
# or
stigmer local -d
```

Output shows detailed debug logs in human-readable format (not JSON) plus progress indicators.

## Benefits

1. **Better UX**: Clean, sophisticated UI that matches Planton Cloud CLI standards
2. **Debugging Support**: Detailed logs available when needed with `--debug`
3. **Progress Visibility**: Users can see what's happening during startup
4. **Professional Look**: Colored output with spinners and checkmarks

## Testing

Build and test the CLI:

```bash
cd client-apps/cli
go build -o stigmer .
./stigmer local --help
./stigmer local        # Normal mode - clean UI
./stigmer local -d     # Debug mode - detailed logs
```

## Related

- Uses existing `cliprint` package with bubbletea/lipgloss for UI
- Follows patterns established in Planton Cloud CLI
- Maintains backward compatibility (default behavior improved, debug mode available)
