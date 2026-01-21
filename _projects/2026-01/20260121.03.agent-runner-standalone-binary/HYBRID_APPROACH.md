# Hybrid Approach - Best of Both Worlds

**Date**: 2026-01-21  
**Status**: ✅ APPROVED (based on Gemini conversation)  
**Pattern**: "Fat Binary" / "Matryoshka Doll"

## Overview

Combine the best aspects of:
1. **OLD approach** (embedded binaries): Robustness, offline capability, fast first run
2. **NEW approach** (PyInstaller): No Python dependency, true binary distribution

**Result**: Embed PyInstaller binary into CLI → Extract at runtime → Zero Python dependency

## Architecture Comparison

### Current (Old Embedded)

```
brew install stigmer (150MB)
  ↓
CLI contains:
  - Go binary code
  - stigmer-server (Go binary, embedded)
  - workflow-runner (Go binary, embedded)
  - agent-runner.tar.gz (Python code, embedded) ❌ Still needs Python!
  ↓
First run: stigmer server
  ↓
Extract to ~/.stigmer/bin/:
  - agent-runner/ (Python files)
  - Requires: Python 3.11+ on user machine ❌
```

### Hybrid (Fat Binary)

```
brew install stigmer (~100MB)
  ↓
CLI contains:
  - Go binary code
  - stigmer-server (Go binary, embedded)
  - workflow-runner (Go binary, embedded)
  - agent-runner (PyInstaller binary, embedded) ✅ Python bundled inside!
  ↓
First run: stigmer server
  ↓
Extract to ~/.stigmer/bin/:
  - agent-runner (standalone executable)
  - Requires: NOTHING ✅ Zero dependencies!
```

## Key Benefits

### Compared to OLD Approach

| Aspect | Old (Tarball) | Hybrid (Binary) |
|--------|---------------|-----------------|
| CLI Size | ~150MB | ~100MB ✅ |
| Python Required | Yes ❌ | No ✅ |
| First Run | Extract tarball | Extract binary |
| User Experience | "Install Python 3.11+" | "Just works" ✅ |

### Compared to NEW (Download-at-Runtime) Approach

| Aspect | Download-at-Runtime | Hybrid (Embedded) |
|--------|---------------------|-------------------|
| CLI Download | ~10MB ✅ | ~100MB |
| First Run | Download 80MB ❌ | Instant ✅ |
| Offline Mode | No ❌ | Yes ✅ |
| Network Errors | Possible ❌ | Impossible ✅ |
| Robustness | Medium | High ✅ |

## Implementation: The "Matryoshka Doll" Build

### Phase 1: Build Agent-Runner Binaries (PyInstaller)

**Workflow**: `build-agent-runner-binaries.yml` (already created ✅)

```yaml
Trigger: Part of CLI release workflow

For each platform (darwin-arm64, darwin-amd64, linux-amd64):
  1. Build agent-runner with PyInstaller
  2. Result: Single executable (~60MB)
  3. Upload as artifact
```

**Output**:
- `agent-runner-darwin-arm64` (60MB)
- `agent-runner-darwin-amd64` (60MB)
- `agent-runner-linux-amd64` (60MB)

### Phase 2: Embed into CLI

**Workflow**: `release-embedded.yml` (UPDATE to download agent-runner binaries)

```yaml
build-darwin-arm64:
  steps:
    # Step 1: Build agent-runner binary (or download from artifacts)
    - name: Build agent-runner binary
      run: |
        cd backend/services/agent-runner
        poetry run pyinstaller agent-runner.spec
        cp dist/agent-runner ../../client-apps/cli/embedded/binaries/darwin_arm64/
    
    # Step 2: Build stigmer-server and workflow-runner (same as before)
    - name: Build embedded binaries
      run: |
        # stigmer-server
        GOOS=darwin GOARCH=arm64 go build -o client-apps/cli/embedded/binaries/darwin_arm64/stigmer-server ./backend/services/stigmer-server/cmd/server
        
        # workflow-runner
        GOOS=darwin GOARCH=arm64 go build -o client-apps/cli/embedded/binaries/darwin_arm64/workflow-runner ./backend/services/workflow-runner/cmd/worker
    
    # Step 3: Build CLI with embedded binaries (Go embed)
    - name: Build CLI
      run: |
        cd client-apps/cli
        go build -o ../../bin/stigmer .
```

### Phase 3: Go Embedding Logic (Update)

**File**: `client-apps/cli/embedded/embedded_darwin_arm64.go`

```go
//go:build darwin && arm64

package embedded

import _ "embed"

// Embed the PyInstaller binary (not tarball!)
//go:embed binaries/darwin_arm64/agent-runner
var agentRunnerBinary []byte

//go:embed binaries/darwin_arm64/stigmer-server
var stigmerServerBinary []byte

//go:embed binaries/darwin_arm64/workflow-runner
var workflowRunnerBinary []byte

func GetAgentRunnerBinary() ([]byte, error) {
    return agentRunnerBinary, nil
}

func GetStigmerServerBinary() ([]byte, error) {
    return stigmerServerBinary, nil
}

func GetWorkflowRunnerBinary() ([]byte, error) {
    return workflowRunnerBinary, nil
}
```

**Key Change**: 
- OLD: `//go:embed binaries/darwin_arm64/agent-runner.tar.gz`
- NEW: `//go:embed binaries/darwin_arm64/agent-runner` (binary!)

### Phase 4: Extraction Logic (Update)

**File**: `client-apps/cli/embedded/extract.go`

```go
func EnsureBinariesExtracted(dataDir string) error {
    binDir := filepath.Join(dataDir, "bin")
    
    // Extract agent-runner binary (not tarball!)
    agentRunnerPath := filepath.Join(binDir, "agent-runner")
    agentRunnerData, err := GetAgentRunnerBinary()
    if err != nil {
        return errors.Wrap(err, "failed to get agent-runner binary")
    }
    
    // Write binary with executable permissions
    if err := os.WriteFile(agentRunnerPath, agentRunnerData, 0755); err != nil {
        return errors.Wrap(err, "failed to write agent-runner binary")
    }
    
    // Extract stigmer-server, workflow-runner (same as before)
    // ...
    
    return nil
}
```

**Key Change**:
- OLD: Extract tarball → unpack Python files
- NEW: Write binary directly → set executable → done!

## Migration Steps

### Step 1: Update `release-embedded.yml` (MODIFY)

**Changes**:
1. Build agent-runner with PyInstaller (not tar.gz)
2. Copy binary to `embedded/binaries/{platform}/agent-runner`
3. Remove tarball creation logic

**Before**:
```yaml
- name: Build and embed binaries
  run: make embed-binaries  # Creates tar.gz
```

**After**:
```yaml
- name: Build agent-runner binary
  run: |
    cd backend/services/agent-runner
    poetry run pyinstaller agent-runner.spec
    mkdir -p ../../client-apps/cli/embedded/binaries/darwin_arm64
    cp dist/agent-runner ../../client-apps/cli/embedded/binaries/darwin_arm64/
```

### Step 2: Update Go Embed Files (MODIFY)

**Files to update**:
- `client-apps/cli/embedded/embedded_darwin_arm64.go`
- `client-apps/cli/embedded/embedded_darwin_amd64.go`
- `client-apps/cli/embedded/embedded_linux_amd64.go`

**Change**:
```go
// OLD
//go:embed binaries/darwin_arm64/agent-runner.tar.gz
var agentRunnerTarball []byte

func GetAgentRunnerTarball() ([]byte, error) {
    return agentRunnerTarball, nil
}

// NEW
//go:embed binaries/darwin_arm64/agent-runner
var agentRunnerBinary []byte

func GetAgentRunnerBinary() ([]byte, error) {
    return agentRunnerBinary, nil
}
```

### Step 3: Update Extraction Logic (MODIFY)

**File**: `client-apps/cli/embedded/extract.go`

**Remove**: Tarball extraction logic (tar.gz unpacking)

**Add**: Direct binary write

```go
// OLD
func extractAgentRunner(binDir string) error {
    tarballData, _ := GetAgentRunnerTarball()
    // ... unpack tar.gz ...
    // ... extract Python files ...
}

// NEW
func extractAgentRunner(binDir string) error {
    binaryData, _ := GetAgentRunnerBinary()
    path := filepath.Join(binDir, "agent-runner")
    return os.WriteFile(path, binaryData, 0755)
}
```

### Step 4: Test Locally (VERIFY)

```bash
# Build agent-runner binary
cd backend/services/agent-runner
make build-binary
cp dist/agent-runner ../../client-apps/cli/embedded/binaries/darwin_arm64/

# Build CLI with embedded binary
cd ../../client-apps/cli
go build -o ../../bin/stigmer .

# Install
cp ../../bin/stigmer ~/bin/

# Test
stigmer server
# Should extract binary to ~/.stigmer/bin/agent-runner
# Should start without requiring Python!
```

### Step 5: Delete Obsolete Workflow (DELETE)

```bash
rm .github/workflows/release.yml
git add .github/workflows/release.yml
git commit -m "chore(ci): remove obsolete GoReleaser workflow"
```

### Step 6: Keep `release-embedded.yml` (NO RENAME)

- Keep filename as is: `release-embedded.yml`
- Update internal logic to use PyInstaller binaries
- Keep same trigger (`v*` tags)
- Keep Homebrew update logic

## File Size Analysis

### Current (OLD)

```
CLI Binary: ~150MB
  - Go code: ~10MB
  - stigmer-server: ~25MB
  - workflow-runner: ~20MB
  - agent-runner.tar.gz: ~80MB (Python code + deps)
  - Overhead: ~15MB
```

**User requires**: Python 3.11+ installed ❌

### Hybrid (NEW)

```
CLI Binary: ~100MB
  - Go code: ~10MB
  - stigmer-server: ~25MB
  - workflow-runner: ~20MB
  - agent-runner (PyInstaller): ~60MB (Python bundled inside!)
  - Overhead: ~5MB (less than tar.gz)
```

**User requires**: NOTHING ✅

**Improvement**:
- 50MB smaller (150MB → 100MB)
- Zero Python dependency
- Same robustness (embedded + offline)

## Comparison to Industry Tools

| Tool | Size | Python? | Offline? |
|------|------|---------|----------|
| Docker Desktop | 500MB | N/A | Yes |
| VS Code | 200MB | N/A | Yes |
| Pulumi CLI | 100MB | Downloads plugins | No (first run) |
| **Stigmer (Hybrid)** | **100MB** | **No ✅** | **Yes ✅** |

Our 100MB is **competitive** and **reasonable** for a full workflow automation platform.

## User Experience

### Install

```bash
brew install stigmer
# Downloads: ~100MB (one-time)
```

### First Run

```bash
stigmer server
# Extracting binaries to ~/.stigmer/bin... ✓ (3 seconds)
# Starting stigmer-server... ✓
# Starting workflow-runner... ✓
# Starting agent-runner... ✓ (NO Python errors!)
# All services running
```

### Subsequent Runs

```bash
stigmer server
# All services running (instant)
```

## Success Criteria

- ✅ CLI embeds PyInstaller binary (not tarball)
- ✅ No Python installation required on user machine
- ✅ Works completely offline
- ✅ First run extraction < 5 seconds
- ✅ CLI binary size < 120MB
- ✅ Homebrew formula unchanged (still single binary install)

## Timeline

**Phase 2 (Current)**: Build PyInstaller binaries ✅ (already done)

**Phase 3**: Update embedding logic
- Modify `release-embedded.yml`
- Update Go embed files
- Update extraction logic
- Test locally

**Phase 4**: CI/CD Integration
- Test workflow on branch
- Tag release
- Verify Homebrew update

**Phase 5**: Production Release
- Release v2.0.0 with hybrid approach
- Update documentation
- Celebrate zero Python dependency! 🎉

## Open Questions

1. **Should we keep `build-agent-runner-binaries.yml`?**
   - Option A: Yes, as a separate workflow (callable from release-embedded.yml)
   - Option B: No, inline the PyInstaller build into release-embedded.yml
   - **Recommendation**: Option B (simpler, one workflow)

2. **Version coordination?**
   - CLI version = Agent-runner version (embedded together)
   - No separate agent-runner releases needed

3. **Binary size optimization?**
   - UPX compression on PyInstaller binary?
   - Could reduce from 60MB to ~30MB
   - Test if it affects startup time

---

*Based on Gemini conversation and "Fat Binary" pattern*  
*Approved approach: Embed PyInstaller binary (not tarball)*  
*Timeline: 2-3 days for implementation*
