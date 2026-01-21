# Testing Checklist - Agent-Runner Binary Workflow

## Pre-Testing: Verify Compilation

```bash
cd /Users/suresh/scm/github.com/stigmer/stigmer
cd client-apps/cli
go build -o /tmp/stigmer-test .
```

**Expected**: ✅ Compiles without errors

---

## Test 1: Developer Workflow - Quick CLI Rebuild

**Goal**: Verify quick CLI rebuild without rebuilding agent-runner

```bash
cd /Users/suresh/scm/github.com/stigmer/stigmer

# Clean old CLI
rm -f ~/bin/stigmer

# Quick rebuild (reuses existing agent-runner)
make release-local

# Verify
which stigmer
stigmer --version || echo "CLI installed"
```

**Expected**:
- ✅ CLI builds and installs to `~/bin/stigmer`
- ✅ Uses existing `~/.stigmer/bin/agent-runner`
- ✅ Fast rebuild (no PyInstaller step)

---

## Test 2: Developer Workflow - Full Rebuild

**Goal**: Verify complete rebuild including agent-runner

```bash
cd /Users/suresh/scm/github.com/stigmer/stigmer

# Clean everything
rm -f ~/bin/stigmer
rm -rf ~/.stigmer/bin/agent-runner

# Full rebuild
make release-local-full

# Verify installations
ls -lh ~/bin/stigmer
ls -lh ~/.stigmer/bin/agent-runner
```

**Expected**:
- ✅ CLI builds and installs to `~/bin/stigmer`
- ✅ Agent-runner builds with PyInstaller
- ✅ Agent-runner installs to `~/.stigmer/bin/agent-runner`
- ✅ Both binaries are executable

---

## Test 3: Developer Workflow - Agent-Runner Only

**Goal**: Verify rebuilding just agent-runner

```bash
cd /Users/suresh/scm/github.com/stigmer/stigmer

# Rebuild agent-runner only
make install-agent-runner

# Verify
ls -lh ~/.stigmer/bin/agent-runner
file ~/.stigmer/bin/agent-runner
```

**Expected**:
- ✅ PyInstaller builds agent-runner
- ✅ Installs to `~/.stigmer/bin/agent-runner`
- ✅ Binary is executable
- ✅ CLI not rebuilt (faster iteration)

---

## Test 4: Local Daemon Startup (Normal Path)

**Goal**: Verify daemon starts with extracted agent-runner binary

```bash
# Ensure agent-runner exists
ls -lh ~/.stigmer/bin/agent-runner

# Stop any running daemon
stigmer server stop 2>/dev/null || true

# Start daemon
stigmer server

# Verify (in another terminal)
stigmer server status
```

**Expected**:
- ✅ Daemon starts successfully
- ✅ Uses existing `~/.stigmer/bin/agent-runner`
- ✅ No download triggered
- ✅ All services running:
  - Temporal
  - stigmer-server (via `internal-server` command)
  - workflow-runner (via `internal-workflow-runner` command)
  - agent-runner (PyInstaller binary)

**Check logs**:
```bash
tail -f ~/.stigmer/logs/agent-runner.log
```

---

## Test 5: Download Fallback (Missing Binary)

**Goal**: Verify automatic download when agent-runner missing

**⚠️ Note**: This test will only work if you've created a GitHub release with agent-runner binaries. For local testing, manually restore the binary instead.

```bash
# Stop daemon
stigmer server stop

# Delete agent-runner binary
rm ~/.stigmer/bin/agent-runner

# Try to start daemon
stigmer server
```

**Expected (with GitHub release)**:
- ✅ Detects missing agent-runner binary
- ✅ Downloads from GitHub releases matching CLI version
- ✅ Installs to `~/.stigmer/bin/agent-runner`
- ✅ Continues startup successfully

**Expected (without GitHub release / dev build)**:
- ❌ Fails with error message about missing binary
- ℹ️ This is expected for "dev" version builds
- 💡 Use `make install-agent-runner` to fix

---

## Test 6: Version Extraction Logic

**Goal**: Verify embedded binary extraction on version mismatch

```bash
# Stop daemon
stigmer server stop

# Simulate version mismatch
echo "v0.0.0" > ~/.stigmer/bin/.version

# Start daemon
stigmer server
```

**Expected**:
- ✅ Detects version mismatch
- ✅ Re-extracts agent-runner from embedded binary
- ✅ Updates version file
- ✅ Starts successfully

**Verify**:
```bash
cat ~/.stigmer/bin/.version
# Should show: dev (or current version)
```

---

## Test 7: BusyBox Pattern Verification

**Goal**: Verify stigmer-server and workflow-runner run from CLI

```bash
# Start daemon
stigmer server

# Check processes (in another terminal)
ps aux | grep stigmer | grep -v grep
```

**Expected**:
- ✅ See process: `stigmer internal-server`
- ✅ See process: `stigmer internal-workflow-runner`
- ✅ See process: `agent-runner` (PyInstaller binary)
- ✅ NO separate `stigmer-server` or `workflow-runner` processes

**Verify binary locations**:
```bash
# These should NOT exist (BusyBox pattern)
ls ~/.stigmer/bin/stigmer-server 2>/dev/null && echo "❌ UNEXPECTED" || echo "✅ Correct"
ls ~/.stigmer/bin/workflow-runner 2>/dev/null && echo "❌ UNEXPECTED" || echo "✅ Correct"

# This SHOULD exist (only embedded binary)
ls ~/.stigmer/bin/agent-runner && echo "✅ Correct" || echo "❌ MISSING"
```

---

## Test 8: Makefile Help Text

**Goal**: Verify help text is updated and correct

```bash
# Root Makefile
make help | grep -E "(agent-runner|release-local-full)"

# Agent-runner Makefile
cd backend/services/agent-runner
make help
```

**Expected**:
- ✅ Root Makefile shows new targets:
  - `build-agent-runner`
  - `install-agent-runner`
  - `release-local-full`
- ✅ Agent-runner Makefile shows only PyInstaller targets
- ✅ No Docker-related targets in agent-runner Makefile

---

## Test 9: Clean Build from Scratch

**Goal**: Verify everything works from clean state

```bash
cd /Users/suresh/scm/github.com/stigmer/stigmer

# Clean everything
make clean
rm -f ~/bin/stigmer
rm -rf ~/.stigmer

# Build from scratch
make release-local-full

# Start daemon
stigmer server

# Verify
stigmer server status
```

**Expected**:
- ✅ Clean build succeeds
- ✅ All binaries created
- ✅ Daemon starts successfully
- ✅ All services running

---

## Test 10: GitHub Workflow (Manual Testing)

**⚠️ Requires pushing to GitHub**

**Goal**: Verify CI builds agent-runner binaries correctly

```bash
# Create test branch
git checkout -b test/agent-runner-workflow

# Commit changes
git add -A
git commit -m "test: verify agent-runner workflow"
git push origin test/agent-runner-workflow
```

**Manual steps**:
1. Go to GitHub Actions
2. Select "Release with Embedded Binaries" workflow
3. Click "Run workflow" → Select your branch → Run
4. Wait for builds to complete (darwin-arm64, darwin-amd64, linux-amd64)
5. Download artifacts
6. Verify each artifact contains:
   - `stigmer-{version}-{platform}.tar.gz`
   - `stigmer-{version}-{platform}.tar.gz.sha256`
   - `agent-runner-{version}-{platform}`
   - `agent-runner-{version}-{platform}.sha256`

**Expected**:
- ✅ All three platform builds succeed
- ✅ Artifacts contain CLI tarballs
- ✅ Artifacts contain standalone agent-runner binaries
- ✅ Checksums generated correctly

---

## Test 11: Actual Release (When Ready)

**Goal**: End-to-end release testing

```bash
# Tag release
git tag -a v2.0.0 -m "Release v2.0.0 - Standalone agent-runner binary"
git push origin v2.0.0
```

**Verify GitHub Release**:
1. Check release is created: https://github.com/stigmer/stigmer/releases/tag/v2.0.0
2. Verify release assets:
   - 3x CLI tarballs (darwin-arm64, darwin-amd64, linux-amd64)
   - 3x CLI checksums
   - 3x agent-runner binaries
   - 3x agent-runner checksums
   - Total: 12 files

**Test Homebrew Installation** (once tap is updated):
```bash
# Uninstall existing
brew uninstall stigmer 2>/dev/null || true
rm -rf ~/.stigmer

# Install fresh
brew install stigmer

# Test
stigmer server
stigmer server status
```

**Expected**:
- ✅ Homebrew installs successfully
- ✅ CLI version shows v2.0.0
- ✅ Daemon starts without issues
- ✅ All services running

---

## Success Criteria

All tests must pass:
- ✅ Test 1: Quick CLI rebuild
- ✅ Test 2: Full rebuild
- ✅ Test 3: Agent-runner only rebuild
- ✅ Test 4: Normal daemon startup
- ✅ Test 5: Download fallback (or manual restore)
- ✅ Test 6: Version extraction
- ✅ Test 7: BusyBox pattern verification
- ✅ Test 8: Makefile help text
- ✅ Test 9: Clean build from scratch
- ✅ Test 10: GitHub workflow (when pushed)
- ✅ Test 11: Actual release (when tagged)

---

## Troubleshooting

### Issue: CLI doesn't compile

```bash
cd client-apps/cli
go mod tidy
go build .
```

### Issue: Agent-runner binary fails to build

```bash
cd backend/services/agent-runner
poetry install
poetry run pyinstaller agent-runner.spec
```

### Issue: Daemon won't start

```bash
# Check logs
tail -f ~/.stigmer/logs/daemon.err
tail -f ~/.stigmer/logs/agent-runner.err

# Clean and retry
stigmer server stop
rm -rf ~/.stigmer/bin
make release-local-full
stigmer server
```

### Issue: Version mismatch

```bash
# Check versions
stigmer --version || echo "dev"
cat ~/.stigmer/bin/.version

# Force re-extraction
rm ~/.stigmer/bin/.version
stigmer server stop
stigmer server
```

---

## Next Steps After Testing

1. ✅ All local tests pass
2. ✅ Push to feature branch
3. ✅ Test GitHub workflow manually
4. ✅ Review workflow artifacts
5. ✅ Create v2.0.0 release
6. ✅ Test Homebrew installation
7. ✅ Update documentation
8. 🎉 Celebrate!
