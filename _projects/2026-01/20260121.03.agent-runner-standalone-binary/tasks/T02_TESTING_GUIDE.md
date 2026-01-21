# Phase 2 Testing Guide - Multi-Platform Builds

Quick reference for testing the GitHub Actions workflow.

## Step 1: Push Workflow to Repository

```bash
cd /Users/suresh/scm/github.com/stigmer/stigmer

# Verify workflow file exists
ls -la .github/workflows/build-agent-runner-binaries.yml

# Add and commit
git add .github/workflows/build-agent-runner-binaries.yml
git add _projects/2026-01/20260121.03.agent-runner-standalone-binary/

git commit -m "feat(ci): add multi-platform build workflow for agent-runner

- Build binaries for darwin-arm64, darwin-amd64, linux-amd64, linux-arm64, windows-amd64
- Automated release creation on agent-runner-v* tags
- Manual workflow_dispatch for testing
- Package binaries with checksums

Part of Phase 2: Multi-Platform Build System"

# Push to GitHub
git push origin feat/agent-runner-standalone-binary
```

## Step 2: Trigger Manual Workflow

**Option A: Via GitHub Web UI**

1. Go to: https://github.com/stigmer/stigmer/actions
2. Select "Build Agent-Runner Binaries" workflow
3. Click "Run workflow" dropdown
4. Select branch: `feat/agent-runner-standalone-binary`
5. Enter version: `dev` (or leave default)
6. Click "Run workflow"

**Option B: Via GitHub CLI**

```bash
# Install gh CLI if needed: brew install gh
gh auth login  # If not already authenticated

# Trigger workflow
gh workflow run build-agent-runner-binaries.yml \
  --ref feat/agent-runner-standalone-binary \
  -f version=dev

# Watch workflow progress
gh run watch

# Or list recent runs
gh run list --workflow=build-agent-runner-binaries.yml
```

## Step 3: Monitor Build Progress

**Check Status**:
```bash
# List workflow runs
gh run list --workflow=build-agent-runner-binaries.yml --limit 5

# View specific run (get ID from list above)
gh run view <run-id>

# Watch live logs
gh run watch <run-id>
```

**Expected Timeline**:
- darwin-arm64: ~5-7 minutes
- darwin-amd64: ~5-7 minutes  
- linux-amd64: ~4-6 minutes
- linux-arm64: ~6-10 minutes (QEMU emulation slower)
- windows-amd64: ~6-8 minutes

**Total**: ~10-15 minutes (jobs run in parallel)

## Step 4: Download and Verify Artifacts

**Download All Artifacts**:
```bash
# Get run ID
RUN_ID=$(gh run list --workflow=build-agent-runner-binaries.yml --limit 1 --json databaseId --jq '.[0].databaseId')

# Download artifacts
mkdir -p /tmp/agent-runner-artifacts
cd /tmp/agent-runner-artifacts

gh run download $RUN_ID
```

**Artifact Structure**:
```
/tmp/agent-runner-artifacts/
├── agent-runner-darwin-arm64/
│   ├── agent-runner-dev-darwin-arm64.tar.gz
│   └── agent-runner-dev-darwin-arm64.tar.gz.sha256
├── agent-runner-darwin-amd64/
│   ├── agent-runner-dev-darwin-amd64.tar.gz
│   └── agent-runner-dev-darwin-amd64.tar.gz.sha256
├── agent-runner-linux-amd64/
│   ├── agent-runner-dev-linux-amd64.tar.gz
│   └── agent-runner-dev-linux-amd64.tar.gz.sha256
├── agent-runner-linux-arm64/
│   ├── agent-runner-dev-linux-arm64.tar.gz
│   └── agent-runner-dev-linux-arm64.tar.gz.sha256
└── agent-runner-windows-amd64/
    ├── agent-runner-dev-windows-amd64.zip
    └── agent-runner-dev-windows-amd64.zip.sha256
```

## Step 5: Test Platform Binaries

### macOS ARM64 (Current Machine)

```bash
cd /tmp/agent-runner-test-arm64
cp /tmp/agent-runner-artifacts/agent-runner-darwin-arm64/* .

# Verify checksum
shasum -a 256 -c agent-runner-dev-darwin-arm64.tar.gz.sha256

# Extract
tar -xzf agent-runner-dev-darwin-arm64.tar.gz

# Verify binary
file agent-runner
# Expected: Mach-O 64-bit executable arm64

ls -lh agent-runner
# Expected: ~60MB

# Test execution (should fail gracefully, not crash)
./agent-runner
# Expected: Error about missing TEMPORAL_SERVICE_ADDRESS or similar
# NOT expected: Segfault, "file not found", or import errors
```

### macOS AMD64 (Intel or Rosetta)

```bash
cd /tmp/agent-runner-test-amd64
cp /tmp/agent-runner-artifacts/agent-runner-darwin-amd64/* .

shasum -a 256 -c agent-runner-dev-darwin-amd64.tar.gz.sha256
tar -xzf agent-runner-dev-darwin-amd64.tar.gz

file agent-runner
# Expected: Mach-O 64-bit executable x86_64

# Test with Rosetta on ARM Mac
./agent-runner
# Should work via Rosetta translation
```

### Linux AMD64 (Docker)

```bash
cd /tmp/agent-runner-test-linux-amd64
cp /tmp/agent-runner-artifacts/agent-runner-linux-amd64/* .

# Use Docker to test in Linux environment
docker run --rm -it -v $(pwd):/work ubuntu:22.04 bash

# Inside container:
cd /work
sha256sum -c agent-runner-dev-linux-amd64.tar.gz.sha256
tar -xzf agent-runner-dev-linux-amd64.tar.gz
file agent-runner
# Expected: ELF 64-bit LSB executable, x86-64

./agent-runner
# Expected: Error about missing env vars, NOT "command not found" or crashes
```

### Linux ARM64 (Docker with QEMU)

```bash
cd /tmp/agent-runner-test-linux-arm64
cp /tmp/agent-runner-artifacts/agent-runner-linux-arm64/* .

# Use Docker with ARM64 emulation
docker run --rm -it --platform linux/arm64 -v $(pwd):/work ubuntu:22.04 bash

# Inside container:
cd /work
sha256sum -c agent-runner-dev-linux-arm64.tar.gz.sha256
tar -xzf agent-runner-dev-linux-arm64.tar.gz
file agent-runner
# Expected: ELF 64-bit LSB executable, ARM aarch64

./agent-runner
# Expected: Error about missing env vars
```

### Windows AMD64 (Optional - requires Windows VM)

```powershell
# On Windows machine or VM
cd C:\temp\agent-runner-test-windows

# Copy artifact
Copy-Item /tmp/agent-runner-artifacts/agent-runner-windows-amd64/* .

# Verify checksum (using Git Bash or WSL)
sha256sum -c agent-runner-dev-windows-amd64.zip.sha256

# Extract
Expand-Archive agent-runner-dev-windows-amd64.zip

# Test
.\agent-runner.exe
# Expected: Error about missing env vars, NOT crashes
```

## Step 6: Document Results

Record findings in validation report:

```bash
cd /Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260121.03.agent-runner-standalone-binary/tasks

# Create validation report
touch T02_VALIDATION_REPORT.md
```

**Include**:
- ✅/❌ Status for each platform
- Binary sizes (MB)
- Build times (minutes)
- Any errors or warnings encountered
- Checksum validation results
- Basic execution test results

## Step 7: Test Tag-Based Release (Optional)

**Create Test Release**:

```bash
cd /Users/suresh/scm/github.com/stigmer/stigmer

# Create and push test tag
git tag agent-runner-v0.1.0-test
git push origin agent-runner-v0.1.0-test

# Workflow should trigger automatically
gh run list --workflow=build-agent-runner-binaries.yml

# After workflow completes, verify release created
gh release list
gh release view agent-runner-v0.1.0-test

# Download release assets
gh release download agent-runner-v0.1.0-test -D /tmp/release-test

# Verify all 10 files present
ls -la /tmp/release-test
# Expected: 5 binaries + 5 checksums
```

**Cleanup Test Release**:

```bash
# Delete release and tag
gh release delete agent-runner-v0.1.0-test --yes
git tag -d agent-runner-v0.1.0-test
git push origin :refs/tags/agent-runner-v0.1.0-test
```

## Troubleshooting

### Workflow Fails to Trigger

**Check**:
- Workflow file is in `main` or feature branch
- File is valid YAML (no syntax errors)
- Workflow permissions are correct

**Fix**:
```bash
# Validate YAML syntax
cat .github/workflows/build-agent-runner-binaries.yml | python3 -c 'import yaml, sys; yaml.safe_load(sys.stdin)'
```

### Poetry Install Fails

**Symptoms**: "Could not find pyproject.toml" or dependency resolution errors

**Fix**: Ensure workflow `cd` into correct directory before Poetry commands

### PyInstaller Build Fails

**Symptoms**: "Module not found" or import errors

**Fix**: Check if `agent-runner.spec` has all required hidden imports

**Debug**:
```bash
# In workflow, add verbose PyInstaller output
poetry run pyinstaller --log-level DEBUG agent-runner.spec
```

### Binary Won't Execute

**Symptoms**: "Permission denied" or "bad CPU type"

**Fix**: 
- Ensure binary has execute permissions
- Verify architecture matches platform (use `file` command)
- On macOS, may need to bypass Gatekeeper: `xattr -d com.apple.quarantine agent-runner`

### Checksum Validation Fails

**Symptoms**: "checksum mismatch"

**Fix**: Re-download artifact, verify upload didn't corrupt file

## Success Criteria

Phase 2 is complete when:

- ✅ All 5 platform jobs complete successfully
- ✅ All artifacts downloadable
- ✅ All checksums validate
- ✅ macOS ARM64 binary executes on local machine
- ✅ At least 2 other platforms verified (preferably Linux AMD64 via Docker)
- ✅ Binary sizes documented (~60MB each)
- ✅ Build times documented (~5-10 minutes per platform)
- ✅ Tag-based release tested (optional but recommended)

---

*For questions or issues, update T02_0_plan.md with findings*
