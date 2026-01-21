# Embedded Package

The `embedded` package handles compile-time embedding and runtime extraction of Stigmer binaries.

## Purpose

This package enables single-binary distribution of the Stigmer CLI by:
1. **Embedding** all required binaries at compile time (stigmer-server, workflow-runner, agent-runner)
2. **Extracting** them to `~/.stigmer/bin/` on first run or version upgrade
3. **Validating** version compatibility and re-extracting when needed

## Architecture

**Hybrid "Fat Binary" / "Matryoshka Doll" Pattern**

```
┌─────────────────────────────────────────┐
│   Stigmer CLI (~100 MB)                 │
│                                         │
│  ┌───────────────────────────────────┐ │
│  │  Embedded Binaries (Go embed)     │ │
│  │  - stigmer-server (~25 MB)        │ │
│  │  - workflow-runner (~20 MB)       │ │
│  │  - agent-runner (~60 MB) ✨       │ │
│  │    PyInstaller binary with        │ │
│  │    Python bundled inside!         │ │
│  └───────────────────────────────────┘ │
│                                         │
│  EnsureBinariesExtracted()             │
│         │                               │
│         ├─ Check ~/.stigmer/bin/.version
│         ├─ Extract if needed            │
│         └─ Set executable permissions   │
└─────────────────────────────────────────┘
         │
         ├─ Extract to ~/.stigmer/bin/
         │
         v
┌─────────────────────────────────────────┐
│   ~/.stigmer/bin/                       │
│   ├── .version                          │
│   ├── stigmer-server (Go binary)       │
│   ├── workflow-runner (Go binary)      │
│   └── agent-runner (PyInstaller) ✨    │
│       Standalone executable             │
│       NO Python installation required!  │
└─────────────────────────────────────────┘
```

## Files

- **`embedded.go`**: Platform detection, embed directives, binary getters
- **`embedded_*.go`**: Platform-specific embed directives (darwin_arm64, darwin_amd64, linux_amd64)
- **`extract.go`**: Extraction logic for binaries (simplified - no tarball handling)
- **`version.go`**: Version checking and comparison
- **`binaries/`**: Directory containing binaries to embed (populated at build time)

## Usage

### In Daemon Startup

```go
import "github.com/stigmer/stigmer/client-apps/cli/embedded"

func Start() error {
    dataDir := getDataDir() // ~/.stigmer
    
    // Ensure binaries are extracted
    if err := embedded.EnsureBinariesExtracted(dataDir); err != nil {
        return errors.Wrap(err, "failed to extract embedded binaries")
    }
    
    // Now binaries are guaranteed to exist in ~/.stigmer/bin/
    serverBinary := filepath.Join(dataDir, "bin", "stigmer-server")
    // ...
}
```

### Platform Detection

```go
platform := embedded.CurrentPlatform()
fmt.Printf("Running on: %s\n", platform.String()) // e.g., "darwin_arm64"

if !platform.IsSupported() {
    return fmt.Errorf("unsupported platform: %s", platform.String())
}
```

### Getting Embedded Binaries

```go
// Get stigmer-server for current platform
serverData, err := embedded.GetStigmerServerBinary()
if err != nil {
    return err
}

// Get workflow-runner for current platform
runnerData, err := embedded.GetWorkflowRunnerBinary()
if err != nil {
    return err
}

// Get agent-runner binary for current platform
agentData, err := embedded.GetAgentRunnerBinary()
if err != nil {
    return err
}
```

## Extraction Behavior

### First Run

```
User runs: stigmer server

1. Check ~/.stigmer/bin/.version → doesn't exist
2. Extract all binaries to ~/.stigmer/bin/
3. Write .version file with current CLI version
4. Start daemon with extracted binaries

Extraction time: ~3-5 seconds
```

### Subsequent Runs

```
User runs: stigmer server

1. Check ~/.stigmer/bin/.version → matches current version
2. Skip extraction (all binaries already present)
3. Start daemon immediately

Startup time: < 1 second
```

### Version Upgrade

```
User upgrades: brew upgrade stigmer (1.0.0 → 1.1.0)
User runs: stigmer server

1. Check ~/.stigmer/bin/.version → "1.0.0" (mismatch!)
2. Remove old binaries
3. Extract new binaries
4. Update .version to "1.1.0"
5. Start daemon with new binaries

Extraction time: ~3-5 seconds
```

## Build Integration

### Build Integration (GitHub Actions)

**Implemented in**: `.github/workflows/release-embedded.yml`

For each platform (darwin-arm64, darwin-amd64, linux-amd64):

```yaml
# Build agent-runner with PyInstaller
- name: Build agent-runner binary
  run: |
    cd backend/services/agent-runner
    poetry run pyinstaller agent-runner.spec
    cp dist/agent-runner ../../../client-apps/cli/embedded/binaries/darwin_arm64/

# Build stigmer-server
- name: Build stigmer-server binary
  run: |
    GOOS=darwin GOARCH=arm64 go build -ldflags="-s -w" \
      -o client-apps/cli/embedded/binaries/darwin_arm64/stigmer-server \
      ./backend/services/stigmer-server/cmd/server

# Build workflow-runner
- name: Build workflow-runner binary
  run: |
    GOOS=darwin GOARCH=arm64 go build -ldflags="-s -w" \
      -o client-apps/cli/embedded/binaries/darwin_arm64/workflow-runner \
      ./backend/services/workflow-runner/cmd/worker

# Build CLI with embedded binaries
- name: Build CLI
  run: |
    cd client-apps/cli
    go build -o ../../bin/stigmer .
```

**Key Change**: Agent-runner is built with PyInstaller (single executable) instead of packaged as tarball (Python files).

## Error Handling

### Unsupported Platform

```
Error: Unsupported platform: linux/386

Stigmer CLI supports:
  - macOS arm64 (Apple Silicon)
  - macOS amd64 (Intel)
  - Linux amd64

Your platform: linux/386

Please open an issue if you need support for this platform:
  https://github.com/stigmer/stigmer/issues
```

### Extraction Failure

```
Error: Failed to extract embedded binaries

Details: permission denied

This may indicate:
- Insufficient disk space
- Permissions issue with ~/.stigmer directory
- Corrupted CLI installation

To fix:
  1. Check disk space: df -h ~
  2. Check permissions: ls -la ~/.stigmer
  3. Reinstall: brew reinstall stigmer
```

### Missing Binary (Post-Extraction)

```
Error: stigmer-server binary not found

Expected location: ~/.stigmer/bin/stigmer-server

This usually means the Stigmer CLI installation is corrupted.

To fix:
  brew reinstall stigmer

For development, set environment variable:
  export STIGMER_SERVER_BIN=/path/to/stigmer-server
```

## Development Mode

During development, set environment variables to skip embedded binaries:

```bash
# Use locally built binaries instead of embedded ones
export STIGMER_SERVER_BIN=~/bin/stigmer-server
export STIGMER_WORKFLOW_RUNNER_BIN=~/bin/workflow-runner
export STIGMER_AGENT_RUNNER_SCRIPT=~/stigmer/backend/services/agent-runner/run.sh

# Daemon will check env vars first, fall back to extracted binaries
stigmer server
```

## Version Management

### Version Marker File

Location: `~/.stigmer/bin/.version`

Contents: `1.2.3` (current CLI version)

### Version Check Logic

1. Read `~/.stigmer/bin/.version`
2. Compare with `embedded.GetBuildVersion()`
3. If mismatch → re-extract all binaries
4. If match → skip extraction

### Version Embedding (Build Time)

```bash
# Set version via ldflags
go build -ldflags "-X github.com/stigmer/stigmer/client-apps/cli/embedded.buildVersion=1.2.3"
```

## Testing

### Unit Tests (Future)

```go
func TestPlatformDetection(t *testing.T) {
    platform := CurrentPlatform()
    assert.True(t, platform.IsSupported())
}

func TestExtractionFlow(t *testing.T) {
    tmpDir := t.TempDir()
    err := EnsureBinariesExtracted(tmpDir)
    assert.NoError(t, err)
    
    // Verify binaries exist
    assert.FileExists(t, filepath.Join(tmpDir, "bin", "stigmer-server"))
    assert.FileExists(t, filepath.Join(tmpDir, "bin", "workflow-runner"))
    assert.FileExists(t, filepath.Join(tmpDir, "bin", "agent-runner", "run.sh"))
}
```

### Integration Tests

```bash
# Build CLI with embedded binaries
make release-local

# Delete extracted binaries to simulate fresh install
rm -rf ~/.stigmer/bin

# Run CLI and verify extraction
stigmer server

# Verify all binaries extracted
ls -lh ~/.stigmer/bin/
cat ~/.stigmer/bin/.version
```

## Binary Size Analysis

**Hybrid Approach (PyInstaller Binary)**:

| Component | Size | Description |
|-----------|------|-------------|
| stigmer-server | ~25 MB | Go binary (gRPC API server) |
| workflow-runner | ~20 MB | Go binary (Temporal worker) |
| agent-runner | ~60 MB | **PyInstaller binary (Python bundled!)** ✨ |
| **Total Embedded** | **~105 MB** | All components |
| CLI Overhead | ~5 MB | CLI logic + embed overhead |
| **Final CLI Binary** | **~100 MB** | Single distributable |

**Comparison to OLD Approach**:

| Approach | Agent-Runner | Python Required | CLI Size |
|----------|--------------|-----------------|----------|
| OLD (tarball) | tar.gz (~80MB) | Yes ❌ | ~150MB |
| NEW (PyInstaller) | Binary (~60MB) | No ✅ | ~100MB |

**Improvement**: 50MB smaller CLI + zero Python dependency!

## Comparison to Industry Tools

| Tool | Binary Size | Distribution Method |
|------|-------------|---------------------|
| Docker Desktop | ~500 MB | Separate packages |
| Pulumi CLI | ~100 MB | Plugin downloads |
| Terraform | ~50 MB | Provider downloads |
| kubectl | ~50 MB | Separate components |
| **Stigmer (Hybrid)** | **~100 MB** | **Single binary, zero deps ✨** |

## Design Decisions

### Why Embed + Extract?

**Alternatives considered:**
- ❌ On-demand downloads (Pulumi) - requires internet
- ❌ Separate packages (Docker) - complex for local mode
- ❌ Compile-time library (kubectl) - only works for Go
- ❌ Launcher wrapper (Bazelisk) - requires internet

**Why this approach:**
- ✅ Works completely offline
- ✅ Single binary distribution (Homebrew friendly)
- ✅ No version mismatches
- ✅ Fast first run (< 5s extraction)
- ✅ Standard Go approach (1.16+ embed)
- ✅ **Zero Python dependency** (PyInstaller bundles Python) ✨

### Why Platform-Specific Builds?

**Alternatives:**
- Universal binary with all platforms (~300+ MB)

**Why platform-specific:**
- ✅ 150 MB vs 300+ MB (significant savings)
- ✅ Homebrew automatically selects correct bottle
- ✅ Industry standard (kubectl, terraform, pulumi)
- ✅ GitHub releases support per-platform binaries

### Why No Checksums in v1?

**Rationale:**
- Binaries embedded in CLI (Go verifies CLI integrity)
- If CLI corrupted, extraction would fail anyway
- Adds complexity (~100 lines of code)
- Can add in v2 if corruption issues arise

### Why .version File?

**Rationale:**
- Detect CLI upgrades automatically
- Re-extract on version mismatch
- Simple text file (human readable)
- No need for complex version parsing

## Future Enhancements (v2)

- [ ] SHA256 checksum verification
- [ ] Progress indicator during extraction
- [ ] Parallel extraction (3 binaries simultaneously)
- [ ] Compression with UPX (reduce by ~60%)
- [ ] Incremental extraction (only changed binaries)
- [ ] Rollback on extraction failure

## Related Documentation

- **Project Overview**: `_projects/2026-01/20260121.01.cli-embedded-binary-packaging/README.md`
- **Design Notes**: `_projects/2026-01/20260121.01.cli-embedded-binary-packaging/notes.md`
- **Task Breakdown**: `_projects/2026-01/20260121.01.cli-embedded-binary-packaging/tasks.md`

---

**Status**: ✅ Task 2 Complete - Core embedding infrastructure implemented  
**Next**: Task 3 - Update daemon management to use extracted binaries
