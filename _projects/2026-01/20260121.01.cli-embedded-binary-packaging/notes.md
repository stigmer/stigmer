# Notes & Learnings

## Design Decisions

### Decision 1: No Fallbacks (2026-01-21)

**Decision**: Production binary will use ONLY extracted binaries. No fallbacks to development paths.

**Rationale**:
- Fallbacks are a trap - temporary hacks become permanent
- Creates confusion (which binary is actually running?)
- Version mismatches when dev paths used in production
- Clean separation = maintainable code

**Implementation**:
- Production: Use only `~/.stigmer/bin/` extracted binaries
- Development: Use env vars (`STIGMER_DEV_MODE=true`, `STIGMER_SERVER_BIN=...`)
- Clear error if binaries missing: "Binary not found - reinstall CLI"

---

### Decision 2: Four Components to Embed (2026-01-21)

**Components**:
1. **stigmer** (CLI) - User-facing command tool
2. **stigmer-server** (Go) - gRPC API server, port 7234
3. **workflow-runner** (Go) - Temporal worker for Zigflow
4. **agent-runner** (Python) - Temporal worker for AI agents

**Why not three?**
- Initially missed stigmer-server in count
- CLI is wrapper, stigmer-server is the actual backend
- All 4 must be embedded for self-contained distribution

---

### Decision 3: Embed + Extract Pattern (2026-01-21)

**Approach**: Go `embed` package - compile-time embedding with runtime extraction

**Alternatives considered**:
- ❌ On-demand downloads (Pulumi/Terraform) - requires internet
- ❌ Separate packages (Docker) - too complex for local mode
- ❌ Compile-time library (kubectl) - only works for Go libraries
- ❌ Launcher wrapper (Bazelisk) - requires internet, extra layer

**Why Embed + Extract?**
- ✅ Works completely offline
- ✅ Single binary distribution (Homebrew friendly)
- ✅ No version mismatches
- ✅ Fast first run (< 5s extraction)
- ✅ Standard Go approach (1.16+ embed package)

---

## Industry Research Summary (2026-01-21)

### Pulumi
- **Pattern**: On-demand plugin downloads
- **Pros**: Tiny CLI, download only what you need
- **Cons**: Requires internet on first use
- **Not suitable**: Stigmer needs offline capability

### Terraform
- **Pattern**: Similar to Pulumi (provider downloads on `init`)
- **Features**: Lock file, cryptographic verification, plugin cache
- **Not suitable**: Same reason - internet dependency

### Docker
- **Pattern**: Separate CLI + daemon packages
- **Pros**: True separation, remote management possible
- **Cons**: Complex for simple local use, version compatibility
- **Not suitable**: Stigmer local mode should "just work"

### kubectl + kustomize
- **Pattern**: Compile-time library integration
- **Pros**: True single binary, instant startup
- **Cons**: Kustomize version lags, can't update independently
- **Partially applicable**: Works for Go binaries, not Python

### Bazelisk
- **Pattern**: Tiny launcher downloads exact Bazel version
- **Pros**: Reproducible builds, per-project versions
- **Cons**: Requires internet, extra layer
- **Not suitable**: Stigmer should work offline

### Go `embed` Package ✅
- **Pattern**: Embed at compile time, extract at runtime
- **Standard**: Native Go 1.16+ feature
- **Best fit**: Self-contained, offline, Homebrew-friendly

---

## Technical Notes

### Binary Size Estimates

```
stigmer-server:    ~25 MB
workflow-runner:   ~20 MB
agent-runner:      ~80 MB (compressed tar.gz)
--------------------------------------
Total embedded:    ~125 MB
CLI overhead:      ~10 MB
--------------------------------------
Final CLI binary:  ~135-150 MB
```

**Acceptable?** Yes!
- Docker Desktop: ~500 MB
- Pulumi CLI: ~100 MB
- kubectl: ~50 MB (but requires separate components)

### Platform Support

**Target Platforms**:
- macOS arm64 (Apple Silicon)
- macOS amd64 (Intel)
- Linux amd64

**Per platform, need**:
- stigmer-server binary (specific to OS/arch)
- workflow-runner binary (specific to OS/arch)
- agent-runner tarball (Python - portable, but venv platform-specific)

**Build strategy**:
- Embed binaries for ALL platforms (or just target platform?)
- **Decision needed**: Single universal binary vs platform-specific builds?

---

## Implementation Challenges

### Challenge 1: Agent Runner is Python

**Problem**: Can't just embed a Go binary - need Python environment

**Solution**: 
- Package as tar.gz: `backend/services/agent-runner/` + Python venv
- Extract entire directory to `~/.stigmer/bin/agent-runner/`
- Use `run.sh` script as entry point

**Size**: ~80 MB compressed, ~150 MB uncompressed

---

### Challenge 2: Platform Detection

**Need**: Select correct binary for current platform at runtime

**Go approach**:
```go
import "runtime"

func selectStigmerServerBinary() []byte {
    switch runtime.GOOS {
    case "darwin":
        switch runtime.GOARCH {
        case "arm64":
            return stigmerServerDarwinARM64
        case "amd64":
            return stigmerServerDarwinAMD64
        }
    case "linux":
        if runtime.GOARCH == "amd64" {
            return stigmerServerLinuxAMD64
        }
    }
    panic("unsupported platform")
}
```

---

### Challenge 3: Extraction Timing

**When to extract?**

**Option A**: On daemon start (every time)
- ❌ Slow startup
- ❌ Unnecessary I/O

**Option B**: On first run only
- ✅ Fast subsequent starts
- ✅ Check if already extracted

**Decision**: Extract on first run, skip if exists

**Implementation**:
```go
func ensureBinariesExtracted(dataDir string) error {
    binDir := filepath.Join(dataDir, "bin")
    
    // Check if already extracted (existence + version check?)
    if allBinariesExist(binDir) {
        return nil
    }
    
    // Extract all binaries
    return extractAllBinaries(binDir)
}
```

**Version mismatch handling**:
- Store version in `~/.stigmer/bin/.version`
- If CLI version != extracted version, re-extract

---

## Questions to Resolve

### Q1: Checksum Verification? ✅ DECIDED

**Do we need SHA256 verification of extracted binaries?**

**Pros**:
- Detect corruption
- Security best practice

**Cons**:
- Extra complexity
- Adds ~100 lines of code
- Unlikely to be corrupted (embedded in same binary)

**Decision**: **Skip for v1**. If corruption becomes an issue in production, we can add it in v2.

**Rationale**:
- Binaries are embedded in CLI binary (Go verifies CLI binary integrity)
- If CLI binary corrupted, extraction would likely fail anyway
- Focus on core functionality first
- Can add later with minimal code change (store checksums with embedded data)

---

### Q2: Universal Binary or Platform-Specific? ✅ DECIDED

**Option A**: Single universal binary (all platforms embedded)
- ❌ 300+ MB (3 platforms × 3 binaries × ~30 MB)
- ✅ One download for all platforms

**Option B**: Platform-specific binaries
- ✅ ~150 MB (just one platform)
- ❌ Must build for each platform separately

**Homebrew**: Supports platform-specific bottles (recommended approach)

**Decision**: **Platform-specific builds** (Homebrew best practice)

**Rationale**:
- 150 MB vs 300+ MB is significant
- Homebrew automatically selects correct bottle for platform
- GitHub releases support per-platform binaries
- Industry standard (kubectl, terraform, pulumi all do this)

---

### Q3: Bazel Integration? ✅ DECIDED

**Do we need to update Bazel build rules?**

Currently using:
- `make release-local` - builds with Go
- Bazel - for development/CI

**Decision**: **Keep Makefile primary**. Bazel can call Makefile targets if needed.

**Rationale**:
- Go embed is native Go feature (works seamlessly with `go build`)
- Makefile is simpler for release builds
- Bazel can invoke Makefile if needed for CI
- Don't overcomplicate - start simple

---

## Task 1: Embedding Strategy Design ✅ COMPLETED

### 1. Platform Detection Strategy

**Implementation**: Use Go's `runtime.GOOS` and `runtime.GOARCH`

```go
package embedded

import "runtime"

// selectBinaryForPlatform returns the embedded binary for current platform
func selectBinaryForPlatform(binaries map[string][]byte) ([]byte, error) {
    platform := fmt.Sprintf("%s_%s", runtime.GOOS, runtime.GOARCH)
    
    // Supported platforms
    supportedPlatforms := map[string]string{
        "darwin_arm64": "darwin_arm64",
        "darwin_amd64": "darwin_amd64",
        "linux_amd64":  "linux_amd64",
    }
    
    key, ok := supportedPlatforms[platform]
    if !ok {
        return nil, fmt.Errorf("unsupported platform: %s/%s", runtime.GOOS, runtime.GOARCH)
    }
    
    binary, ok := binaries[key]
    if !ok {
        return nil, fmt.Errorf("binary not found for platform: %s", key)
    }
    
    return binary, nil
}
```

**Why this works**:
- `runtime.GOOS` = "darwin" | "linux"
- `runtime.GOARCH` = "arm64" | "amd64"
- Determined at runtime (not compile time)
- Standard Go practice

**Supported platforms**:
- macOS arm64 (Apple Silicon)
- macOS amd64 (Intel Macs)
- Linux amd64

---

### 2. Extraction Logic

**When to extract**: First run + version mismatch

**Where to extract**: `~/.stigmer/bin/`

**Directory structure**:
```
~/.stigmer/
├── bin/
│   ├── .version              # CLI version that extracted these binaries
│   ├── stigmer-server        # Extracted Go binary
│   ├── workflow-runner       # Extracted Go binary
│   └── agent-runner/         # Extracted tarball
│       ├── run.sh            # Entry point script
│       ├── src/              # Python source code
│       └── .venv/            # Python virtual environment
├── data/                     # SQLite database
└── logs/                     # Runtime logs
```

**Extraction flow**:

```go
func ensureBinariesExtracted(dataDir string) error {
    binDir := filepath.Join(dataDir, "bin")
    
    // 1. Check if extraction needed
    needsExtraction, err := needsExtraction(binDir)
    if err != nil {
        return errors.Wrap(err, "failed to check extraction status")
    }
    
    if !needsExtraction {
        log.Debug().Msg("Binaries already extracted, skipping extraction")
        return nil
    }
    
    // 2. Create bin directory (clean slate if version mismatch)
    if err := os.RemoveAll(binDir); err != nil {
        return errors.Wrap(err, "failed to remove old binaries")
    }
    if err := os.MkdirAll(binDir, 0755); err != nil {
        return errors.Wrap(err, "failed to create bin directory")
    }
    
    // 3. Extract stigmer-server
    if err := extractStigmerServer(binDir); err != nil {
        return errors.Wrap(err, "failed to extract stigmer-server")
    }
    
    // 4. Extract workflow-runner
    if err := extractWorkflowRunner(binDir); err != nil {
        return errors.Wrap(err, "failed to extract workflow-runner")
    }
    
    // 5. Extract agent-runner (tarball)
    if err := extractAgentRunner(binDir); err != nil {
        return errors.Wrap(err, "failed to extract agent-runner")
    }
    
    // 6. Write version marker
    version := getBuildVersion() // From ldflags or const
    versionFile := filepath.Join(binDir, ".version")
    if err := os.WriteFile(versionFile, []byte(version), 0644); err != nil {
        return errors.Wrap(err, "failed to write version file")
    }
    
    log.Info().Str("version", version).Msg("Successfully extracted embedded binaries")
    return nil
}

func needsExtraction(binDir string) (bool, error) {
    // Check if bin directory exists
    if _, err := os.Stat(binDir); os.IsNotExist(err) {
        return true, nil // First run
    }
    
    // Check version file
    versionFile := filepath.Join(binDir, ".version")
    data, err := os.ReadFile(versionFile)
    if err != nil {
        return true, nil // Version file missing = re-extract
    }
    
    extractedVersion := strings.TrimSpace(string(data))
    currentVersion := getBuildVersion()
    
    if extractedVersion != currentVersion {
        log.Info().
            Str("extracted", extractedVersion).
            Str("current", currentVersion).
            Msg("Version mismatch detected, will re-extract binaries")
        return true, nil
    }
    
    // Version matches, no extraction needed
    return false, nil
}
```

**When extraction runs**:
1. On daemon start (`daemon.Start()`)
2. Before `findServerBinary()` is called
3. Blocks startup until complete (typically < 5 seconds)

**Error handling**:
- Extraction failure = daemon startup fails
- Clear error messages guide user to reinstall
- Log detailed errors to help debug

---

### 3. Binary Finder Functions (Production Mode)

**New implementation** (replaces current development fallback logic):

```go
// findServerBinary finds the stigmer-server binary
//
// Production mode (default):
//   1. Check ~/.stigmer/bin/stigmer-server (extracted binary)
//   2. If not found, return clear error to reinstall
//
// Development mode (STIGMER_SERVER_BIN env var set):
//   1. Use env var path
func findServerBinary(dataDir string) (string, error) {
    // Dev mode: env var takes precedence
    if bin := os.Getenv("STIGMER_SERVER_BIN"); bin != "" {
        if _, err := os.Stat(bin); err == nil {
            log.Debug().Str("path", bin).Msg("Using stigmer-server from STIGMER_SERVER_BIN")
            return bin, nil
        }
        return "", fmt.Errorf("STIGMER_SERVER_BIN set but file not found: %s", bin)
    }
    
    // Production mode: use extracted binary only
    binPath := filepath.Join(dataDir, "bin", "stigmer-server")
    if _, err := os.Stat(binPath); err == nil {
        return binPath, nil
    }
    
    // Binary not found - user must reinstall
    return "", errors.New(`stigmer-server binary not found

This usually means the Stigmer CLI installation is corrupted.

To fix this:
  brew reinstall stigmer    (if installed via Homebrew)
  
Or download and install the latest release:
  https://github.com/stigmer/stigmer/releases

For development, set STIGMER_SERVER_BIN environment variable:
  export STIGMER_SERVER_BIN=/path/to/stigmer-server`)
}

// findWorkflowRunnerBinary - similar to above
// findAgentRunnerScript - similar to above
```

**Key changes from current implementation**:
- ❌ Remove all development path searches (`bin/`, `bazel-bin/`, etc.)
- ❌ Remove workspace root detection
- ❌ Remove auto-build logic
- ✅ Production: only check `~/.stigmer/bin/`
- ✅ Development: only use env vars (`STIGMER_*_BIN`)
- ✅ Clear separation: no fallbacks!

---

### 4. Error Messages

**Error scenarios and messages**:

#### Scenario 1: Extraction fails

```
Error: Failed to extract embedded binaries

Details: <specific error>

This may indicate:
- Insufficient disk space
- Permissions issue with ~/.stigmer directory
- Corrupted CLI installation

To fix:
  1. Check disk space: df -h ~
  2. Check permissions: ls -la ~/.stigmer
  3. Reinstall: brew reinstall stigmer
```

#### Scenario 2: Binary not found (shouldn't happen if extraction succeeded)

```
Error: stigmer-server binary not found

Expected location: ~/.stigmer/bin/stigmer-server

This usually means the Stigmer CLI installation is corrupted.

To fix:
  brew reinstall stigmer

For development, set environment variable:
  export STIGMER_SERVER_BIN=/path/to/stigmer-server
```

#### Scenario 3: Unsupported platform

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

#### Scenario 4: Version mismatch (informational, not error)

```
[INFO] Detected CLI version change (1.2.0 → 1.3.0)
[INFO] Re-extracting embedded binaries...
```

---

### 5. Development Mode

**How developers will work**:

```bash
# Option 1: Set env vars (recommended for most devs)
export STIGMER_SERVER_BIN=~/bin/stigmer-server
export STIGMER_WORKFLOW_RUNNER_BIN=~/bin/workflow-runner
export STIGMER_AGENT_RUNNER_SCRIPT=~/stigmer/backend/services/agent-runner/run.sh

# Option 2: Build and "install" to same directory as CLI
# (CLI checks same directory as itself - for release testing)
make build-all
cp bin/* ~/bin/

# Option 3: Reinstall from local build
make release-local    # Embeds binaries, installs to ~/bin/stigmer
```

**No more development fallbacks in production code!**

---

### 6. Extraction Performance

**Expected timings**:
- stigmer-server: ~25 MB → ~500ms to write
- workflow-runner: ~20 MB → ~400ms to write
- agent-runner: ~80 MB compressed → ~2s to extract tarball
- Version file: negligible

**Total: ~3-4 seconds** (acceptable for first run / version upgrade)

**Optimization opportunities (if needed later)**:
- Compress Go binaries with UPX (can reduce by 60%)
- Parallel extraction (extract all 3 simultaneously)
- Progress indicator for user feedback

---

### 7. Checksum Verification (Future Enhancement)

**If we add checksums in v2**:

```go
//go:embed binaries/darwin_arm64/stigmer-server
//go:embed binaries/darwin_arm64/stigmer-server.sha256
var stigmerServerDarwinARM64Binary []byte
var stigmerServerDarwinARM64Checksum string

func extractWithVerification(dest string, data []byte, expectedChecksum string) error {
    // Write file
    if err := os.WriteFile(dest, data, 0755); err != nil {
        return err
    }
    
    // Compute SHA256
    hash := sha256.Sum256(data)
    actualChecksum := hex.EncodeToString(hash[:])
    
    // Verify
    if actualChecksum != expectedChecksum {
        os.Remove(dest) // Clean up corrupted file
        return fmt.Errorf("checksum mismatch (expected %s, got %s)", 
            expectedChecksum, actualChecksum)
    }
    
    return nil
}
```

**Decision**: Not implementing in v1 (keep it simple)

---

## Learnings

### Task 2: Implementing Go Embed (2026-01-21)

**What went well:**
- ✅ Go embed directives are straightforward - just `//go:embed path/to/file`
- ✅ Gazelle automatically detected embedded files and added `embedsrcs` to BUILD.bazel
- ✅ Platform detection with `runtime.GOOS` and `runtime.GOARCH` is clean and simple
- ✅ Code organization: 3 focused files (embedded.go, extract.go, version.go) - each with single responsibility
- ✅ Placeholder binaries (empty files) allow code to compile during development

**Key insights:**
1. **Embed at package level, not function level** - Variables must be package-level for embed to work
2. **One embed directive per file** - Can't use wildcards like `//go:embed binaries/**/*`
3. **Gazelle integration** - Automatically generates `embedsrcs` field in BUILD.bazel (don't touch manually!)
4. **Version checking** - `.version` file prevents unnecessary re-extraction (performance win)
5. **Tarball extraction** - Need custom reader for `[]byte` → `tar.Reader` (Go's compress/gzip expects io.Reader)

**Implementation decisions:**
- **Separate binary getters** - `GetStigmerServerBinary()`, `GetWorkflowRunnerBinary()`, `GetAgentRunnerTarball()`
  - Pro: Clear separation, easy to test
  - Con: Some code duplication in platform selection
  - Decision: Clarity > DRY for this use case

- **Version checking before extraction** - Check `.version` file, all binaries exist
  - Pro: Fast subsequent starts (< 1s instead of 3-5s)
  - Con: Extra complexity (~50 lines)
  - Decision: Worth it - startup time matters

- **Platform-specific embed variables** - `stigmerServerDarwinARM64`, `stigmerServerDarwinAMD64`, etc.
  - Pro: Type-safe, compile-time guarantee
  - Con: Verbose (9 embed variables)
  - Decision: Explicitness > cleverness

**Error handling patterns:**
- Unsupported platform → detailed error with supported platforms + GitHub issue link
- Extraction failure → specific error + troubleshooting steps
- Missing binary post-extraction → shouldn't happen, but handled with "corrupted installation" message

**File structure:**
```
embedded/
├── embedded.go       (163 lines) - Platform detection, embed directives, getters
├── extract.go        (186 lines) - Extraction orchestration, binary/tarball logic
├── version.go        (76 lines)  - Version checking, .version file management
└── binaries/         - Placeholder files (replaced at build time)
```

**What's next:**
- ~~Task 3: Integrate `embedded.EnsureBinariesExtracted()` into daemon startup~~ ✅ COMPLETED
- Task 4: Add Makefile targets to build and copy binaries before embedding
- Task 5: ~~Remove all development fallback paths from daemon.go~~ ✅ COMPLETED (merged with Task 3)
- Task 6: End-to-end testing with actual binaries

---

### Task 3: Integrating Extracted Binaries (2026-01-21)

**What went well:**
- ✅ Clean separation: Production code uses ONLY extracted binaries (no fallbacks!)
- ✅ Simple implementation: Each finder function is < 30 lines
- ✅ Dev mode: Environment variables provide escape hatch for development
- ✅ Error messages: Clear, actionable guidance for users
- ✅ No breaking changes: Function signatures remain compatible with existing code
- ✅ Compilation success: All changes compile without errors

**Key changes made:**

1. **Added extraction to daemon startup** (daemon.go:70-75)
   - Calls `embedded.EnsureBinariesExtracted(dataDir)` early in `Start()` function
   - Shows progress message: "Extracting binaries"
   - Blocks startup until extraction completes (3-5 seconds first run, < 1s subsequent)

2. **Rewrote `findServerBinary(dataDir)` function** (daemon.go:771-801)
   - Removed 60+ lines of development fallback logic
   - Now: 30 lines - env var check, then extracted binary check, then error
   - Production: Uses only `dataDir/bin/stigmer-server`
   - Dev mode: `STIGMER_SERVER_BIN` env var
   - Clear error: Points to `brew reinstall stigmer` or GitHub releases

3. **Rewrote `findWorkflowRunnerBinary(dataDir)` function** (daemon.go:803-833)
   - Removed 60+ lines of development fallback logic
   - Same pattern as stigmer-server
   - Production: Uses only `dataDir/bin/workflow-runner`
   - Dev mode: `STIGMER_WORKFLOW_RUNNER_BIN` env var

4. **Rewrote `findAgentRunnerScript(dataDir)` function** (daemon.go:835-865)
   - Removed 35+ lines of workspace root detection
   - Production: Uses only `dataDir/bin/agent-runner/run.sh`
   - Dev mode: `STIGMER_AGENT_RUNNER_SCRIPT` env var

5. **Deleted `findWorkspaceRoot()` function** (was daemon.go:1069-1110)
   - No longer needed - development paths removed
   - 40+ lines of dead code eliminated

**Code reduction:**
- Before: ~200 lines of binary finding logic with fallbacks
- After: ~95 lines of clean, focused production code
- Net reduction: ~105 lines removed (52% smaller!)

**Development mode:**
Developers can now work in two ways:

```bash
# Option 1: Set environment variables (recommended)
export STIGMER_SERVER_BIN=~/bin/stigmer-server
export STIGMER_WORKFLOW_RUNNER_BIN=~/bin/workflow-runner
export STIGMER_AGENT_RUNNER_SCRIPT=~/stigmer/backend/services/agent-runner/run.sh

# Option 2: Build release-local (embeds placeholder binaries for now)
make release-local
```

**Error handling patterns:**
- Environment variable set but file not found → specific error message
- Extracted binary not found → "corrupted installation" with reinstall instructions
- All error messages include:
  1. What's wrong (specific binary missing)
  2. Where we looked (expected path)
  3. How to fix (reinstall steps + dev mode instructions)

**Design validation:**
- ✅ No fallbacks → forces clean separation
- ✅ Env vars only for dev → explicit, not implicit
- ✅ Clear errors → users know exactly what to do
- ✅ Simple code → easy to maintain and debug

**What's next:**
- Task 4: Build actual binaries and copy them to `embedded/binaries/` before compilation
- Task 5: Merged with Task 3 (already done!)
- Task 6: End-to-end test with real embedded binaries

---

## References

- Go embed package: https://pkg.go.dev/embed
- Pulumi plugin architecture: https://www.pulumi.com/docs/iac/concepts/plugins/
- Terraform provider protocol: https://developer.hashicorp.com/terraform/plugin/framework/provider-servers
- Docker architecture: https://docs.docker.com/get-started/overview/#docker-architecture
- kubectl + kustomize: https://kubernetes.io/docs/reference/kubectl/generated/kubectl_kustomize/
- Bazelisk: https://github.com/bazelbuild/bazelisk
