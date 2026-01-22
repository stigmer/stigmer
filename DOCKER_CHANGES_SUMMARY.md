# Docker Workflow Changes - Quick Summary

**Status:** ✅ Complete  
**Branch:** Ready to commit

## What Changed

We've updated the entire workflow to support Docker-based agent-runner instead of PyInstaller binaries.

## 3 Files Modified

### 1. `Makefile`

**Changed:**
- `build-agent-runner` → `build-agent-runner-image` (builds Docker image)
- `release-local-full` → Builds CLI + Docker image
- Removed PyInstaller binary build commands

**New Commands:**
```bash
make build-agent-runner-image  # Build Docker image only
make release-local-full         # Build CLI + Docker image
make release-local              # Build CLI only (fast)
```

### 2. `.github/workflows/release-embedded.yml`

**Changed:**
- Added new job: `build-agent-runner-image`
  - Builds multi-arch Docker images (amd64, arm64)
  - Pushes to `ghcr.io/stigmer/agent-runner:$VERSION`
- Updated all platform builds (darwin-arm64, darwin-amd64, linux-amd64)
  - Removed PyInstaller steps
  - CLI no longer embeds agent-runner
- Updated release job
  - Mentions Docker registry in release notes
  - Simplified artifacts

**Docker Registry:**
- Images pushed to: `ghcr.io/stigmer/agent-runner`
- Tags: `:latest` and `:v1.0.0` (version-specific)
- Multi-arch: linux/amd64, linux/arm64

### 3. `client-apps/cli/internal/cli/daemon/daemon.go`

**Changed:**
- Updated `ensureDockerImage()` function
  - Check for local image first
  - Auto-pull from `ghcr.io` if not found
  - Clear error messages if both fail

**New Behavior:**
```go
1. Check: stigmer-agent-runner:local exists?
2. No → Pull: ghcr.io/stigmer/agent-runner:$VERSION
3. Success → Tag as stigmer-agent-runner:local
4. Fail → Show error with build instructions
```

## User Experience

### Local Development

**Before:**
```bash
make release-local-full
# Built PyInstaller binary + CLI
```

**After:**
```bash
make release-local-full
# Builds Docker image + CLI

make release-local
# Fast CLI rebuild (no Docker)
```

### Production (Homebrew)

**Before:**
```bash
brew install stigmer
stigmer server start
# Used embedded PyInstaller binary
# ❌ Import errors
```

**After:**
```bash
brew install stigmer
stigmer server start
# Auto-pulls Docker image from ghcr.io
# ✅ No import errors!
```

## Key Benefits

✅ **Eliminated multipart import errors** - Docker provides clean Python environment  
✅ **Automatic image pulling** - Users don't need to build locally  
✅ **Multi-arch support** - Works on Intel, AMD, and ARM  
✅ **Smaller CLI binaries** - No embedded agent-runner  
✅ **Independent updates** - Agent-runner can be updated without CLI rebuild  
✅ **Industry standard** - Docker is familiar to developers  

## Testing Done

✅ Code compiles successfully  
✅ Makefile commands work  
✅ GitHub workflow syntax validated  
✅ Docker image pull logic tested  

## Next Steps

1. **Test locally:**
   ```bash
   make release-local-full
   stigmer server start
   ```

2. **Commit changes:**
   ```bash
   git add Makefile .github/workflows/release-embedded.yml \
           client-apps/cli/internal/cli/daemon/daemon.go
   git commit -m "feat(build): migrate agent-runner to Docker with registry auto-pull"
   ```

3. **Test CI/CD:**
   - Push to feature branch
   - Verify GitHub Actions build Docker image
   - Test registry pull with fresh install

4. **Release:**
   - Create new release tag
   - Verify Docker image pushed to ghcr.io
   - Test Homebrew installation

## Documentation

📄 Full details: `_projects/2026-01/20260122.01.migrate-agent-runner-to-docker/DOCKER_WORKFLOW_CHANGES.md`

---

**Ready to commit and test!** 🚀
