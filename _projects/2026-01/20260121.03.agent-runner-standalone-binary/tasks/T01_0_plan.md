# Task 01 - Initial Plan: PyInstaller Setup & Optimization

**Status**: 📋 PENDING REVIEW  
**Phase**: 1 of 5  
**Estimated Time**: 2 days  
**Created**: 2026-01-21

## Overview

Set up PyInstaller to build agent-runner into a standalone executable binary. Optimize bundle size and validate the approach works on the current development platform before expanding to multi-platform builds.

## Context

**Current State**:
- agent-runner exists as Python package with Poetry dependency management
- Started via shell script that runs `poetry run python main.py`
- Requires Python 3.x + Poetry on user machine

**Desired State**:
- Single executable binary: `agent-runner`
- No external dependencies (Python interpreter + all packages bundled)
- Binary size under 100MB (acceptable for dev tool)
- Fast startup, works identically to current behavior

**Why This Matters**:
- Aligns with Temporal binary pattern (consistency)
- Eliminates Python environment management complexity
- Enables daemon to manage agent-runner like any other binary
- Zero user setup for Python/Poetry

## Goals

1. ✅ Install and configure PyInstaller for agent-runner
2. ✅ Create PyInstaller spec file with optimizations
3. ✅ Build single-file executable for current platform
4. ✅ Validate binary works (connects to Temporal, executes agents)
5. ✅ Document binary size and startup performance
6. ✅ Identify any dependency issues when frozen

## Detailed Steps

### Step 1: PyInstaller Installation & Setup (1-2 hours)

**Actions**:
```bash
cd backend/services/agent-runner

# Install PyInstaller
poetry add --group dev pyinstaller

# Create initial spec file
pyinstaller --onefile --name agent-runner src/main.py

# This generates agent-runner.spec
```

**Validation**:
- [ ] PyInstaller added to pyproject.toml
- [ ] `agent-runner.spec` file created
- [ ] No errors during spec generation

### Step 2: Spec File Optimization (2-3 hours)

**Actions**:
Review and optimize `agent-runner.spec`:

```python
# -*- mode: python ; coding: utf-8 -*-

block_cipher = None

a = Analysis(
    ['src/main.py'],
    pathex=[],
    binaries=[],
    datas=[
        # Add any data files agent-runner needs
        # Example: ('config/*.yaml', 'config'),
    ],
    hiddenimports=[
        # Add any dynamically imported modules
        'langchain',
        'temporalio',
        # ... other imports that PyInstaller might miss
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # Exclude unnecessary packages to reduce size
        'tkinter',
        'matplotlib',
        'IPython',
        # ... other large packages not needed
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='agent-runner',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,  # Enable UPX compression if available
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,  # Keep console for logging
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
```

**Key Optimizations**:
- `hiddenimports`: Add dynamically imported modules PyInstaller misses
- `excludes`: Remove unnecessary packages (tkinter, test frameworks, etc.)
- `upx=True`: Enable compression (if UPX installed)
- `console=True`: Keep console output for logging

**Validation**:
- [ ] Spec file customized for agent-runner
- [ ] Hidden imports identified and added
- [ ] Unnecessary packages excluded

### Step 3: Initial Build (30 minutes)

**Actions**:
```bash
# Build using the spec file
pyinstaller agent-runner.spec

# Binary will be in dist/agent-runner (or dist/agent-runner.exe on Windows)
ls -lh dist/agent-runner
```

**Expected Output**:
```
-rwxr-xr-x  1 user  staff   85M Jan 21 10:00 dist/agent-runner
```

**Validation**:
- [ ] Build completes without errors
- [ ] Binary created in `dist/` folder
- [ ] Binary is executable (`chmod +x` if needed)
- [ ] Size documented (should be 60-100MB)

### Step 4: Functional Testing (2-3 hours)

**Actions**:
Test the binary in realistic scenarios:

```bash
# Test 1: Basic execution
./dist/agent-runner --help
# Should show help without errors

# Test 2: Temporal connection
# Start Temporal locally first
./dist/agent-runner
# Should connect to Temporal, register workers

# Test 3: Execute test agent/workflow
# Trigger a simple agent execution
# Verify logs show correct behavior

# Test 4: Environment variables
ANTHROPIC_API_KEY=test_key ./dist/agent-runner
# Should read env vars correctly

# Test 5: Shutdown
# Send SIGTERM, verify graceful shutdown
```

**Common Issues to Watch For**:
1. **Missing imports**: "ModuleNotFoundError" at runtime
   - Fix: Add to `hiddenimports` in spec
2. **Missing data files**: Config files, templates not bundled
   - Fix: Add to `datas` in spec
3. **Dynamic loading failures**: Libraries loaded at runtime fail
   - Fix: Use PyInstaller hooks or manual bundling
4. **Permission errors**: Binary not executable
   - Fix: `chmod +x dist/agent-runner`

**Validation**:
- [ ] Binary executes without import errors
- [ ] Connects to Temporal successfully
- [ ] Can execute test agent/workflow
- [ ] Reads environment variables correctly
- [ ] Graceful shutdown works

### Step 5: Performance Validation (1 hour)

**Actions**:
Measure and document performance characteristics:

```bash
# Measure binary size
du -h dist/agent-runner

# Measure startup time
time ./dist/agent-runner --version

# Compare to Poetry version
time poetry run python src/main.py --version

# Memory usage (monitor during execution)
# Use Activity Monitor (Mac) or htop (Linux)
```

**Document**:
- Binary size: ___ MB
- Startup time (binary): ___ seconds
- Startup time (poetry): ___ seconds
- Runtime memory: ___ MB
- Comparison notes

**Validation**:
- [ ] Binary size under 100MB (acceptable)
- [ ] Startup time under 3 seconds (acceptable for daemon process)
- [ ] Runtime behavior identical to Poetry version
- [ ] No unexpected errors or warnings

### Step 6: Makefile Integration (1 hour)

**Actions**:
Create Makefile targets for binary builds:

```makefile
# backend/services/agent-runner/Makefile

.PHONY: build-binary
build-binary:
	@echo "Building agent-runner binary..."
	poetry run pyinstaller agent-runner.spec
	@echo "Binary created at: dist/agent-runner"
	@ls -lh dist/agent-runner

.PHONY: clean-binary
clean-binary:
	@echo "Cleaning build artifacts..."
	rm -rf build/ dist/ *.spec

.PHONY: test-binary
test-binary: build-binary
	@echo "Testing binary..."
	./dist/agent-runner --help
	@echo "Binary test passed!"

.PHONY: run-binary
run-binary: build-binary
	@echo "Running agent-runner binary..."
	./dist/agent-runner
```

**Validation**:
- [ ] `make build-binary` works
- [ ] `make test-binary` validates binary
- [ ] `make clean-binary` removes artifacts
- [ ] Makefile documented in README

## Deliverables

At the end of this task, we should have:

1. **PyInstaller Configuration**:
   - `agent-runner.spec` optimized and documented
   - `pyproject.toml` updated with PyInstaller dev dependency

2. **Working Binary**:
   - `dist/agent-runner` executable for current platform
   - Validated to work identically to Poetry version

3. **Build System**:
   - Makefile targets for building/testing binary
   - Clean separation of dev workflow (Poetry) and distribution (binary)

4. **Documentation**:
   - Binary size, startup time, performance characteristics
   - Known issues or limitations (if any)
   - Build instructions in README

5. **Validation Report**:
   - Test results showing binary functionality
   - Comparison with Poetry version
   - Any dependency issues encountered and resolved

## Success Criteria

This task is complete when:
- ✅ PyInstaller successfully builds single-file executable
- ✅ Binary size is acceptable (<100MB)
- ✅ Binary executes without errors on current platform
- ✅ Functional testing passes (Temporal connection, agent execution)
- ✅ Performance is acceptable (startup <3s, runtime identical)
- ✅ Makefile targets work for build/test/clean
- ✅ Documentation updated with build instructions

## Risks and Mitigations

**Risk 1: Hidden Import Issues**
- **Symptom**: Runtime "ModuleNotFoundError"
- **Mitigation**: Use `--debug imports` flag, add to hiddenimports
- **Severity**: Medium (common with PyInstaller, solvable)

**Risk 2: Dynamic Loading Failures**
- **Symptom**: Libraries fail to load at runtime
- **Mitigation**: Use PyInstaller hooks, bundle manually if needed
- **Severity**: Medium (langchain/temporalio may need special handling)

**Risk 3: Binary Size Too Large**
- **Symptom**: Binary over 150MB
- **Mitigation**: Aggressive excludes, UPX compression
- **Severity**: Low (acceptable up to 100MB, we have headroom)

**Risk 4: Platform-Specific Issues**
- **Symptom**: Binary works on Mac but may have issues on Linux/Windows
- **Mitigation**: Document platform, test on GitHub Actions in Phase 2
- **Severity**: Low (expected, addressed in multi-platform phase)

## Next Steps (After Completion)

After Task 01 is complete and validated:
- **Task 02**: Multi-Platform Build System (GitHub Actions)
- Set up matrix builds for all target platforms
- Validate binaries work on each platform
- Prepare for distribution phase

## Notes

- Keep Poetry workflow intact for development (don't remove it)
- Binary is for distribution only, developers still use `poetry run` locally
- Document any special PyInstaller configuration for future reference
- If we encounter blocker issues, we can pivot to alternatives (Nuitka)

## Review Checklist (For Approval)

Before approving this plan, consider:
- [ ] Does this approach make sense for agent-runner?
- [ ] Are there missing steps or edge cases?
- [ ] Is the timeline realistic (2 days)?
- [ ] Are there alternative approaches we should consider?
- [ ] Do we need to test on specific platforms first?

---

**Status**: 📋 Awaiting developer review and feedback
