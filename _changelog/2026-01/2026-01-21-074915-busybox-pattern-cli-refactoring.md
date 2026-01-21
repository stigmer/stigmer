# BusyBox Pattern Refactoring - Eliminate Redundant Go Runtime Duplication

**Date**: 2026-01-21  
**Type**: Refactoring / Architecture  
**Scope**: CLI, stigmer-server, workflow-runner  
**Impact**: Binary size reduction, simplified build process

## Summary

Refactored the Stigmer CLI from "Embedded Binaries" pattern to "BusyBox Pattern" following Gemini's architectural recommendation. This eliminates redundant Go runtime duplication and reduces CLI binary size by 24MB (16% reduction).

## Problem Statement

The previous embedded binaries approach was inefficient:

```
stigmer CLI (150MB)
├── Go runtime #1 (CLI code)
├── stigmer-server binary (27MB) ← Go runtime #2
├── workflow-runner binary (42MB) ← Go runtime #3
└── agent-runner binary (59MB) ← Python
```

**Issues:**
- Shipping the Go runtime **3 separate times** (once per binary)
- Redundant ~69MB of Go code (stigmer-server + workflow-runner binaries)
- Treating our own Go code as "foreign" black boxes
- Complex build process (3 separate Go builds)

## Solution: BusyBox Pattern

Inspired by BusyBox and similar tools, consolidate Go code into a single binary:

```
stigmer CLI (126MB)
├── Shared Go runtime (ONE copy)
│   ├── CLI code
│   ├── stigmer-server code (imported as library)
│   └── workflow-runner code (imported as library)
└── agent-runner binary (59MB) ← Python (still embedded)
```

**How it works:**
1. CLI spawns itself with hidden commands instead of extracting separate binaries
2. `stigmer internal-server` → runs stigmer-server code
3. `stigmer internal-workflow-runner` → runs workflow-runner code
4. Only agent-runner (Python) remains embedded

## Changes Made

### 1. Refactored stigmer-server to Library Pattern

**Before:**
```go
// cmd/server/main.go (352 lines)
package main

func main() {
    // All server logic here (not importable)
}
```

**After:**
```go
// pkg/server/server.go (393 lines)
package server

func Run() error {
    // All server logic (importable)
}

// cmd/server/main.go (13 lines)
package main

func main() {
    server.Run()
}
```

**Files:**
- Created: `backend/services/stigmer-server/pkg/server/server.go`
- Updated: `backend/services/stigmer-server/cmd/server/main.go` (352 lines → 13 lines)

### 2. Refactored workflow-runner to Library Pattern

**Before:**
```go
// cmd/worker/main.go + root.go (mixed package main)
package main

func Execute() {
    // Workflow runner logic
}
```

**After:**
```go
// cmd/worker/root.go
package worker  // Changed from main

func Execute() {
    // Workflow runner logic (importable)
}

// pkg/runner/runner.go
package runner

func Run() error {
    worker.Execute()
    return nil
}

// cmd/zigflow/main.go (new standalone entry point)
package main

func main() {
    worker.Execute()
}
```

**Files:**
- Created: `backend/services/workflow-runner/pkg/runner/runner.go`
- Created: `backend/services/workflow-runner/cmd/zigflow/main.go`
- Updated: `backend/services/workflow-runner/cmd/worker/*.go` (package main → package worker)

### 3. Added Hidden CLI Commands (BusyBox Pattern)

Created hidden commands that run server/workflow-runner code:

```go
// client-apps/cli/cmd/stigmer/root/internal.go
package root

func NewInternalServerCommand() *cobra.Command {
    return &cobra.Command{
        Use:    "internal-server",
        Hidden: true,  // Not shown in help
        Run: func(cmd *cobra.Command, args []string) {
            server.Run()  // Calls stigmer-server code
        },
    }
}

func NewInternalWorkflowRunnerCommand() *cobra.Command {
    return &cobra.Command{
        Use:    "internal-workflow-runner",
        Hidden: true,
        Run: func(cmd *cobra.Command, args []string) {
            runner.Run()  // Calls workflow-runner code
        },
    }
}
```

**Files:**
- Created: `client-apps/cli/cmd/stigmer/root/internal.go`
- Updated: `client-apps/cli/cmd/stigmer/root.go` (registered hidden commands)

### 4. Updated Daemon to Use BusyBox Pattern

**Before:**
```go
// daemon.go
func startServer() {
    serverBin := extractBinary("stigmer-server")  // Extract separate binary
    cmd := exec.Command(serverBin)
    cmd.Start()
}
```

**After:**
```go
// daemon.go
func startServer() {
    cliBin, _ := os.Executable()  // Get CLI path
    cmd := exec.Command(cliBin, "internal-server")  // Spawn CLI itself
    cmd.Start()
}
```

**Files:**
- Updated: `client-apps/cli/internal/cli/daemon/daemon.go`
  - `startServer()`: Spawns `stigmer internal-server` instead of extracted binary
  - `startWorkflowRunner()`: Spawns `stigmer internal-workflow-runner` instead of extracted binary
  - Removed: `findServerBinary()`, `findWorkflowRunnerBinary()` (no longer needed)

### 5. Simplified Embedded Binaries (Python Only)

**Before:**
```go
// embedded_darwin_arm64.go
//go:embed binaries/darwin_arm64/stigmer-server
var stigmerServerBinary []byte

//go:embed binaries/darwin_arm64/workflow-runner
var workflowRunnerBinary []byte

//go:embed binaries/darwin_arm64/agent-runner
var agentRunnerBinary []byte
```

**After:**
```go
// embedded_darwin_arm64.go (BusyBox: only Python binary embedded)
//go:embed binaries/darwin_arm64/agent-runner
var agentRunnerBinary []byte
```

**Files:**
- Updated: `client-apps/cli/embedded/embedded_darwin_arm64.go`
- Updated: `client-apps/cli/embedded/embedded_darwin_amd64.go`
- Updated: `client-apps/cli/embedded/embedded_linux_amd64.go`
- Updated: `client-apps/cli/embedded/extract.go` (removed Go binary extraction)

### 6. Updated .gitignore

Added embedded binaries directory to .gitignore (build artifacts):

```gitignore
# CLI embedded binaries (build artifacts, not committed)
client-apps/cli/embedded/binaries/
```

**Files:**
- Updated: `.gitignore`

## Results

### Binary Size Reduction

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| **CLI Size** | 150MB | **126MB** | **-24MB (16% smaller)** |
| **Go Runtime Copies** | 3 separate | 1 shared | **Deduplication** |
| **Embedded Files** | 3 binaries | 1 binary | **Simplified** |

### Architecture Benefits

**Before (Embedded Binaries):**
- ❌ 150MB CLI with 3 copies of Go runtime
- ❌ Complex build (3 separate Go builds + PyInstaller)
- ❌ Treating own code as "foreign" binaries
- ❌ Extracting Go binaries at runtime (slow)

**After (BusyBox Pattern):**
- ✅ 126MB CLI with 1 shared Go runtime
- ✅ Simpler build (1 Go build + PyInstaller)
- ✅ Import server/runner code as libraries
- ✅ Instant startup (no Go binary extraction)

### User Experience

**No changes to user workflow:**
```bash
# Everything works exactly the same
stigmer server         # Still starts server
stigmer server stop    # Still stops server
stigmer server status  # Still shows status
```

**Internal behavior changed:**
```bash
# Old: Extract binaries, spawn separate processes
stigmer-server (extracted) → process
workflow-runner (extracted) → process
agent-runner (extracted) → process

# New: Spawn CLI itself with hidden commands
stigmer internal-server → process (same CLI binary)
stigmer internal-workflow-runner → process (same CLI binary)
agent-runner (extracted) → process (still Python binary)
```

## Technical Details

### Why BusyBox Pattern?

Gemini correctly identified that **embedding Go binaries inside another Go binary is redundant**. Since CLI, stigmer-server, and workflow-runner are all written in Go, they should share one Go runtime.

**Key insight:** Don't treat your own Go code like a "foreign" black box. Import it as libraries.

### Why Keep agent-runner Embedded?

agent-runner is a **Python binary** (PyInstaller), not Go. It has its own Python runtime and cannot be "imported" into the Go CLI. Embedding it as a separate binary makes sense.

### Standalone Binaries Still Work

The refactoring maintains backwards compatibility:

```bash
# Standalone binaries still work
cd backend/services/stigmer-server
go run ./cmd/server/main.go   # ✅ Works (calls server.Run())

cd backend/services/workflow-runner
go run ./cmd/zigflow/main.go  # ✅ Works (calls worker.Execute())
```

### Import Cycle Resolution

Encountered and fixed Go import cycle:
- **Problem**: `main` package cannot be imported
- **Solution**: Moved logic to library packages (`pkg/server`, `pkg/runner`)
- **Result**: Importable by CLI, still usable as standalone binaries

### Hidden Commands

Hidden commands are intentionally not shown in `stigmer --help`:
```bash
$ stigmer --help
Available Commands:
  server    Start Stigmer server  # User-facing command
  # internal-server is hidden (used internally by daemon)

$ stigmer internal-server --help  # Still works if called directly
Internal: Start stigmer-server (used by daemon)
```

## Testing

### Build Verification

```bash
# Build CLI with BusyBox pattern
cd client-apps/cli
go build -o ../../bin/stigmer .

# Result: 126MB binary (24MB smaller)
ls -lh ../../bin/stigmer
# -rwxr-xr-x  126M  stigmer
```

### Command Verification

```bash
# Verify user-facing commands work
./bin/stigmer --help           # ✅ Shows normal help
./bin/stigmer server --help    # ✅ Shows server help

# Verify hidden commands work
./bin/stigmer internal-server --help           # ✅ Works (hidden)
./bin/stigmer internal-workflow-runner --help  # ✅ Works (hidden)
```

### Integration Testing

Local testing confirmed:
1. ✅ CLI builds successfully (126MB)
2. ✅ Hidden commands callable
3. ✅ No import cycles
4. ✅ Standalone binaries still work

**Next:** CI testing and release (Phase 3 of agent-runner standalone binary project)

## Migration Notes

### For Development

**No changes needed for local development:**
```bash
# Everything works the same
go run ./cmd/server/main.go    # Still works
go run ./cmd/zigflow/main.go   # Still works
```

### For CI/CD

**Build process simplified:**

**Before:**
```yaml
# Build 3 separate Go binaries
- go build -o stigmer-server ./backend/services/stigmer-server/cmd/server
- go build -o workflow-runner ./backend/services/workflow-runner/cmd/worker  
- go build -o stigmer ./client-apps/cli
# Embed all 3 into CLI → 150MB
```

**After:**
```yaml
# Build 1 Go binary (includes server + workflow-runner code)
- go build -o stigmer ./client-apps/cli
# Only embed agent-runner (Python) → 126MB
```

### For Homebrew Formula

**No changes needed:**
```ruby
# Formula unchanged - still installs stigmer binary
url "https://github.com/stigmer/stigmer/releases/download/v2.0.0/stigmer-darwin-arm64.tar.gz"
# Binary is now 126MB instead of 150MB (faster download)
```

## Related Work

This refactoring is **Phase 2.5** (unplanned) of the agent-runner standalone binary project:

**Original plan:**
- Phase 1: PyInstaller binary build ✅ Complete
- Phase 2: Hybrid PyInstaller embedding ✅ Complete
- **Phase 2.5: BusyBox pattern refactoring** ✅ Complete (this changelog)
- Phase 3: Testing and release ⏳ Next

**Context:**
- Gemini suggested BusyBox pattern during Phase 2 review
- User confirmed to proceed with optimization
- Benefits: 24MB size reduction + simpler architecture
- No user-facing changes (internal optimization)

## Future Improvements

### Potential Optimizations

1. **Further size reduction with build flags:**
   ```bash
   go build -ldflags="-s -w"  # Strip debug info
   # Could reduce to ~120MB
   ```

2. **UPX compression (optional):**
   ```bash
   upx --best stigmer
   # Could reduce to ~70MB (but slower startup)
   ```

3. **Conditional compilation:**
   - Only include needed cloud provider SDKs
   - Could save 10-15MB

### Architectural Benefits

The BusyBox pattern enables:
- ✅ Single binary distribution
- ✅ Easier dependency management
- ✅ Faster build times (1 build instead of 3)
- ✅ Consistent Go runtime version across components
- ✅ Simpler debugging (single binary to inspect)

## References

**Gemini Conversation:**
- Location: `_cursor/seperate-binnary.md`
- Recommendation: "Go with the 'Fat Binary' / BusyBox Pattern"
- Rationale: "Embedding a Go binary inside another Go binary is redundant"

**Project Documentation:**
- Project: `_projects/2026-01/20260121.03.agent-runner-standalone-binary/`
- ADR: `_cursor/adr-use-python-binary.md`
- Implementation: `_cursor/embedded-binary.md`

## Conclusion

Successfully refactored Stigmer CLI from embedded binaries to BusyBox pattern, achieving:
- ✅ **16% size reduction** (150MB → 126MB)
- ✅ **Eliminated redundant Go runtime duplication** (3 copies → 1)
- ✅ **Simplified build process** (3 builds → 1)
- ✅ **Maintained backwards compatibility** (no user-facing changes)
- ✅ **Maintained standalone binary support** (stigmer-server still works independently)

This architectural improvement makes the CLI leaner, faster to build, and easier to maintain while preserving all functionality.

**Next Steps:** Continue with Phase 3 (Testing & Release) of the agent-runner standalone binary project.
