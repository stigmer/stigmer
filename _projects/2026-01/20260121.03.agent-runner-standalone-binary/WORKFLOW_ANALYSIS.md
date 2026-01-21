# Workflow Analysis - Current vs Future Architecture

**Date**: 2026-01-21  
**Context**: Reviewing existing release workflows in light of new agent-runner binary approach

## Executive Summary

You have **TWO existing release workflows** with **DIFFERENT architectures**:

1. **`release.yml`** - **OBSOLETE** (GoReleaser approach, builds Go binaries only)
2. **`release-embedded.yml`** - **CURRENT** (Embeds all binaries into CLI at build time)

The **new agent-runner binary approach** will **REPLACE** the embedded architecture with a **download-at-runtime** pattern (like Temporal).

## Detailed Analysis

---

## Workflow 1: `release.yml` (GoReleaser)

### What It Does

```yaml
Trigger: git tag push (v*)
↓
Build with GoReleaser:
  - stigmer CLI (Go)
  - stigmer-server (Go)
↓
Create GitHub Release
↓
Update Homebrew Tap (formula)
```

### Architecture

- Uses GoReleaser for cross-platform builds
- Only builds **Go binaries** (CLI + server)
- Does **NOT** handle agent-runner (Python)
- Creates archives with both binaries

### Homebrew Formula (from GoReleaser)

```ruby
class Stigmer < Formula
  desc "AI-powered workflow automation"
  homepage "https://github.com/stigmer/stigmer"
  
  # Downloads include BOTH stigmer AND stigmer-server
  on_macos do
    # ...
  end
  
  def install
    bin.install "stigmer"
    bin.install "stigmer-server"
  end
end
```

### Status: **⚠️ OBSOLETE**

**Why it's obsolete:**
- ❌ Doesn't handle agent-runner (Python component)
- ❌ Doesn't embed any binaries into CLI
- ❌ Requires users to manage stigmer-server separately
- ❌ Not aligned with "single CLI binary" vision

**Replaced by**: `release-embedded.yml`

**Action**: ❌ **DELETE THIS WORKFLOW** (or disable it)

---

## Workflow 2: `release-embedded.yml` (Current Architecture)

### What It Does

```yaml
Trigger: git tag push (v*) or manual
↓
For each platform (darwin-arm64, darwin-amd64, linux-amd64):
  ├── Build stigmer-server (Go) for platform
  ├── Build workflow-runner (Go) for platform  
  ├── Package agent-runner (Python tarball) for platform
  ├── Make embed-binaries (embeds all 3 into CLI source)
  ├── Build CLI with embedded binaries
  ├── Package CLI as tar.gz
  └── Upload artifact
↓
Create GitHub Release (all platform binaries)
↓
Update Homebrew Tap (per-platform formula)
```

### Architecture: **Embed-at-Build, Extract-at-Runtime**

**Build Time** (GitHub Actions):
```
client-apps/cli/embedded/binaries/
├── darwin_arm64/
│   ├── stigmer-server (25MB)
│   ├── workflow-runner (20MB)
│   └── agent-runner.tar.gz (80MB)
├── darwin_amd64/
│   └── ...
└── linux_amd64/
    └── ...
```

**Runtime** (User's machine):
```
User runs: brew install stigmer
Downloads: stigmer-v1.0.0-darwin-arm64.tar.gz (150MB CLI)

User runs: stigmer server
CLI extracts to ~/.stigmer/bin/:
  ├── stigmer-server (from embedded)
  ├── workflow-runner (from embedded)
  └── agent-runner/ (from embedded tarball)
```

### Key Characteristics

**Pros**:
- ✅ Single binary distribution (Homebrew friendly)
- ✅ Works completely offline
- ✅ No version mismatches (everything bundled)
- ✅ Fast first run (< 5s extraction)

**Cons**:
- ❌ Large CLI binary (~150MB)
- ❌ Agent-runner is a **tarball of Python code** (not a binary)
- ❌ Still requires Python environment on user's machine
- ❌ Not the "Temporal pattern" (download binary → run)

### Homebrew Formula (from `release-embedded.yml`)

```ruby
class Stigmer < Formula
  desc "AI-powered workflow automation"
  homepage "https://github.com/stigmer/stigmer"
  
  # Downloads CLI ONLY (all binaries embedded inside)
  on_macos do
    if Hardware::CPU.arm?
      url ".../stigmer-v1.0.0-darwin-arm64.tar.gz"  # ~150MB
    end
  end
  
  def install
    bin.install "stigmer"  # ONLY the CLI
  end
end
```

### Status: **✅ CURRENT (but will be REPLACED)**

**Why it exists:**
- Previous project: `_projects/2026-01/20260121.01.cli-embedded-binary-packaging/`
- Goal was to achieve "single binary" distribution
- Works well for Go components (stigmer-server, workflow-runner)
- **Limitation**: agent-runner is still Python code in a tarball

**What will replace it:**
- New agent-runner binary approach (PyInstaller)
- Download-at-runtime pattern (like Temporal)

---

## New Architecture: Download-at-Runtime (Future)

### Vision

```yaml
Trigger: git tag push (v*)
↓
Build stigmer CLI ONLY (Go binary, ~10MB)
  - No embedded binaries
  - Just CLI logic + download capability
↓
Trigger agent-runner binary build (separate workflow)
  - Build agent-runner-v1.0.0 binaries (PyInstaller)
  - Upload to releases.stigmer.ai or GitHub Releases
↓
Create GitHub Release
↓
Update Homebrew Tap (lightweight formula)
```

### Runtime Flow

```
User runs: brew install stigmer
Downloads: stigmer-v1.0.0-darwin-arm64.tar.gz (10MB CLI only)

User runs: stigmer server
CLI daemon:
  1. Detects missing binaries
  2. Downloads stigmer-server (if needed)
  3. Downloads workflow-runner (if needed)
  4. Downloads temporal (already does this)
  5. Downloads agent-runner BINARY (NEW - PyInstaller)
  6. Starts all services
```

### Key Changes

| Component | Old (Embedded) | New (Download) |
|-----------|----------------|----------------|
| **CLI Size** | 150MB | ~10MB |
| **stigmer-server** | Embedded | Download |
| **workflow-runner** | Embedded | Download |
| **temporal** | Download | Download (no change) |
| **agent-runner** | Embedded tarball | **Download binary** |
| **Python Required** | Yes (for agent-runner) | **NO** |
| **Offline Mode** | Yes (everything embedded) | No (first run needs internet) |

### Benefits of New Approach

**For agent-runner specifically:**
- ✅ **NO Python installation required** (PyInstaller bundles Python)
- ✅ Architecture consistency (ALL components are downloaded binaries)
- ✅ Smaller CLI (10MB vs 150MB)
- ✅ Independent versioning (agent-runner can update separately)

**For overall architecture:**
- ✅ Follows Temporal pattern (daemon downloads and manages binaries)
- ✅ Easier to update components (just re-download)
- ✅ Clearer separation of concerns

---

## Impact on Existing Workflows

### `release.yml` (GoReleaser)

**Status**: ⚠️ **DELETE or DISABLE**

**Rationale**:
- Doesn't handle agent-runner
- Doesn't support embedded architecture
- Superseded by `release-embedded.yml`

**Action**:
```bash
rm .github/workflows/release.yml
# OR
# Rename to release.yml.disabled
```

### `release-embedded.yml`

**Status**: ✅ **KEEP for now, REPLACE later**

**Short-term** (Phase 2-4):
- Keep this workflow active
- Use it for CLI releases until new approach is ready
- Agent-runner binaries build separately (new workflow)

**Long-term** (Phase 5):
- Replace with new lightweight workflow
- CLI only builds CLI (no embedding)
- All components downloaded at runtime

**Migration Plan**:
1. **Phase 2-3**: Keep `release-embedded.yml` (current behavior)
2. **Phase 4**: Update CLI daemon to download agent-runner binary
3. **Phase 5**: Remove embedding logic, create new `release-lightweight.yml`

---

## Recommended Actions

### Immediate (Phase 2)

1. ✅ **Keep `release-embedded.yml`** - Still needed for current architecture
2. ✅ **Add `build-agent-runner-binaries.yml`** - New workflow for PyInstaller binaries (separate)
3. ❌ **Delete `release.yml`** - Obsolete GoReleaser approach

```bash
# Delete obsolete workflow
rm .github/workflows/release.yml
git add .github/workflows/release.yml
git commit -m "chore(ci): remove obsolete GoReleaser workflow

- GoReleaser workflow doesn't handle agent-runner
- Superseded by release-embedded.yml
- No longer aligned with architecture"
```

### Phase 3-4: Dual Architecture (Transition Period)

**CLI releases** (keep embedded approach):
- Use `release-embedded.yml`
- Tag: `v1.0.0`, `v1.1.0`, etc.

**Agent-runner releases** (new binary approach):
- Use `build-agent-runner-binaries.yml`
- Tag: `agent-runner-v1.0.0`, `agent-runner-v1.1.0`, etc.

**Why dual approach**:
- Gradual migration (safer)
- Test new binary approach before full switch
- Backwards compatibility (old CLI still works)

### Phase 5: Full Migration (Future)

Create **`release-lightweight.yml`**:
```yaml
name: Release CLI (Lightweight)

# Only builds CLI (10MB)
# All components downloaded at runtime
build-darwin-arm64:
  - Build stigmer CLI only (no embedding)
  - Daemon downloads: stigmer-server, workflow-runner, temporal, agent-runner

# ~10MB CLI vs ~150MB embedded CLI
```

**Delete** `release-embedded.yml`:
- No longer needed
- All components downloaded at runtime
- CLI is lightweight again

---

## Homebrew Formula Evolution

### Current Formula (Embedded)

```ruby
class Stigmer < Formula
  desc "AI-powered workflow automation"
  homepage "https://github.com/stigmer/stigmer"
  
  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/stigmer/stigmer/releases/download/v1.0.0/stigmer-v1.0.0-darwin-arm64.tar.gz"
      sha256 "..." # ~150MB
    end
  end
  
  def install
    bin.install "stigmer"  # Contains embedded binaries
  end
end
```

### Future Formula (Lightweight + Download)

```ruby
class Stigmer < Formula
  desc "AI-powered workflow automation"
  homepage "https://github.com/stigmer/stigmer"
  
  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/stigmer/stigmer/releases/download/v2.0.0/stigmer-v2.0.0-darwin-arm64.tar.gz"
      sha256 "..." # ~10MB
    end
  end
  
  def install
    bin.install "stigmer"
  end
  
  def caveats
    <<~EOS
      On first run, stigmer will download required binaries:
        - stigmer-server (~25MB)
        - workflow-runner (~20MB)
        - temporal (~50MB)
        - agent-runner (~60MB)
      
      Total download: ~155MB (one-time, cached in ~/.stigmer)
    EOS
  end
end
```

**Key Difference**:
- Install size: **10MB** vs **150MB**
- First run: Downloads components (internet required)
- Subsequent runs: Uses cached binaries

---

## Decision Matrix

| Question | Answer | Recommendation |
|----------|--------|----------------|
| Delete `release.yml`? | Yes | ✅ **DELETE NOW** (obsolete) |
| Delete `release-embedded.yml`? | Not yet | ✅ **KEEP for Phase 2-4** |
| Add `build-agent-runner-binaries.yml`? | Yes | ✅ **ADD NOW** (Phase 2) |
| Migrate to download-at-runtime? | Eventually | ⏳ **Phase 5** (after testing) |
| Update Homebrew formula? | Eventually | ⏳ **Phase 5** (with new CLI) |

---

## Summary

### What You Have Now

1. ❌ **`release.yml`** (GoReleaser) - **OBSOLETE, DELETE**
2. ✅ **`release-embedded.yml`** (Embedded binaries) - **CURRENT, KEEP**

### What You're Adding

3. ✅ **`build-agent-runner-binaries.yml`** (PyInstaller) - **NEW, ADD NOW**

### Future State (Phase 5)

1. ❌ `release.yml` - Deleted
2. ❌ `release-embedded.yml` - Replaced
3. ✅ `build-agent-runner-binaries.yml` - Active
4. ✅ `release-lightweight.yml` - New CLI workflow (download-at-runtime)

---

## Next Steps

1. **Delete** `release.yml` (obsolete GoReleaser approach)
2. **Keep** `release-embedded.yml` (current architecture, works)
3. **Add** `build-agent-runner-binaries.yml` (new Phase 2 workflow)
4. **Test** dual architecture (embedded CLI + binary agent-runner)
5. **Plan** Phase 5 migration (lightweight CLI + all downloads)

---

*Analysis completed: 2026-01-21*  
*Based on: ADR, project history, workflow inspection*
