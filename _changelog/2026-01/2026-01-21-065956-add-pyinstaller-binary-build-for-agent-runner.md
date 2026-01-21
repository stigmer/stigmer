# Add PyInstaller Binary Build Infrastructure for Agent Runner

**Date**: 2026-01-21  
**Type**: Infrastructure  
**Impact**: Development Workflow  
**Scope**: `backend/services/agent-runner/`

## What Changed

Added complete PyInstaller-based binary build system for agent-runner service, enabling standalone executable distribution without Python dependencies.

## Implementation Details

### 1. PyInstaller Configuration

**File Created**: `backend/services/agent-runner/agent-runner.spec`

- Single-file executable configuration
- Optimized with hidden imports for all dependencies:
  - Temporal SDK (temporalio)
  - LangChain ecosystem (langchain, langchain_core, langgraph)
  - gRPC and protobuf
  - Local packages (graphton, stigmer_stubs)
  - Supporting libraries (redis, authlib, httpx, jwt, daytona, deepagents_cli)
- Excluded unnecessary packages:
  - GUI frameworks (tkinter, PyQt)
  - Plotting libraries (matplotlib, seaborn)
  - Development tools (pytest, mypy, IPython)
  - Large unused modules (scipy, pandas)
- UPX compression enabled
- Console mode for logging visibility

### 2. Dependency Management

**File Modified**: `backend/services/agent-runner/pyproject.toml`

Added PyInstaller to dev dependencies with Python version constraint:
```toml
pyinstaller = {version = "^6.18.0", python = ">=3.11,<3.15"}
```

**File Modified**: `backend/services/agent-runner/poetry.lock`

Locked PyInstaller 6.18.0 and its dependencies (altgraph, macholib, pyinstaller-hooks-contrib).

### 3. Build System Integration

**File Modified**: `backend/services/agent-runner/Makefile`

Added binary build targets:
- `make build-binary` - Build standalone executable (~45s clean build)
- `make clean-binary` - Remove build artifacts
- `make test-binary` - Build and validate binary
- `make rebuild-binary` - Clean rebuild

All targets clearly document that outputs go to `dist/` and `build/` (ignored by .gitignore).

### 4. Git Protection

**Verified**: Existing `.gitignore` already protects:
- Line 8: `dist/` - Binary output directory
- Line 30: `build/` - Build cache
- Line 89: `backend/services/*/agent-runner` - Binary executables

No changes needed - protection was already in place.

## Binary Characteristics

**Size**: 59MB (well under 100MB target)
- Includes Python 3.13.3 interpreter
- All dependencies bundled (temporalio, langchain, grpc, redis, etc.)
- Zero external requirements

**Build Performance**:
- Clean build: ~45 seconds
- Incremental build: ~15 seconds
- Fast enough for development iteration

**Platform**: macOS ARM64 (current development)
- Future work: Multi-platform builds (Linux amd64/arm64, macOS Intel, Windows)

## Why This Matters

### Problem Solved

Current agent-runner requires:
1. Python 3.11+ installation
2. Poetry installation and configuration
3. `poetry install` (network + time)
4. Environment variable configuration
5. Run via: `poetry run python main.py`

This creates friction for:
- Fresh machine setup
- CI/CD environments
- Container-free deployments
- Users without Python expertise

### Solution Provided

Binary approach enables:
1. Download single file (~59MB)
2. Run directly: `./agent-runner`
3. No Python or Poetry required
4. Consistent with Temporal CLI pattern (both are downloaded binaries)

### Architecture Alignment

**Current state**:
```
stigmer-server:    Go binary ✅
workflow-runner:   Go binary ✅  
temporal:          Downloaded binary ✅
agent-runner:      Shell script → Poetry → Python ❌
```

**With this change**:
```
stigmer-server:    Go binary ✅
workflow-runner:   Go binary ✅
temporal:          Downloaded binary ✅
agent-runner:      Downloaded binary ✅
```

Uniform binary management - daemon can download and manage agent-runner like any other service.

## Development Workflow

### Building Binaries

```bash
cd backend/services/agent-runner

# Build binary
make build-binary
# Output: dist/agent-runner (59MB)

# Clean artifacts
make clean-binary

# Test binary (build + validate)
make test-binary
```

### Python Development (Unchanged)

```bash
# Developers still use Poetry for development
poetry install
poetry run python main.py

# Binary builds are for distribution only
```

### Git Safety

Build outputs are automatically ignored:
```bash
make build-binary     # Creates dist/agent-runner (59MB)
git status            # Shows NO binary artifacts ✅
```

## Technical Notes

### Spec File Organization

The PyInstaller spec is well-organized with clear sections:
1. **Header**: Purpose and build output locations
2. **Analysis**: Input files and dependencies
3. **Hidden Imports**: Dynamically loaded modules
4. **Excludes**: Unnecessary packages
5. **EXE**: Single-file configuration with UPX compression

### Hidden Imports Strategy

PyInstaller's static analysis can miss:
- Dynamically imported modules (e.g., `importlib.import_module()`)
- Plugin systems
- Runtime-loaded dependencies

We explicitly declare all key dependencies to ensure they're bundled.

### Build Artifacts

PyInstaller creates:
- `build/` - Intermediate build files, analysis cache
- `dist/` - Final executable binary

Both are in .gitignore and never committed.

## Testing Performed

1. ✅ Binary builds without errors (~45s)
2. ✅ Binary size acceptable (59MB)
3. ✅ No import errors at runtime
4. ✅ Core dependencies correctly frozen
5. ✅ Git properly ignores build outputs
6. ✅ Makefile targets work as expected

Full functional testing (Temporal connection, agent execution) requires Temporal server running - validated that binary starts without import errors.

## Future Work

This establishes the foundation for:

**Phase 2: Multi-Platform Builds**
- GitHub Actions matrix builds for:
  - Linux: amd64, arm64
  - macOS: amd64 (Intel), arm64 (Apple Silicon)
  - Windows: amd64
- Automated testing on each platform

**Phase 3: Distribution**
- Binary hosting (GitHub Releases or R2/S3)
- Version management and updates
- Download automation in stigmer daemon

**Phase 4: Daemon Integration**
- Daemon downloads appropriate binary for OS/arch
- Lifecycle management (start/stop/restart)
- Environment variable passing
- Log collection and monitoring

## Files Changed

```
modified:   backend/services/agent-runner/Makefile
modified:   backend/services/agent-runner/pyproject.toml
modified:   backend/services/agent-runner/poetry.lock
new file:   backend/services/agent-runner/agent-runner.spec
```

**Repository Impact**:
- +60KB of configuration files (all text)
- +0KB of binaries (protected by .gitignore)

## Documentation

Comprehensive project documentation created in:
- `_projects/2026-01/20260121.03.agent-runner-standalone-binary/README.md`
- `_projects/2026-01/20260121.03.agent-runner-standalone-binary/tasks/`
  - `T01_0_plan.md` - Detailed implementation plan
  - `T01_VALIDATION_REPORT.md` - Build validation results
  - `T01_SUMMARY.md` - Executive summary

## Decision Rationale

Chose PyInstaller over alternatives because:

1. **vs Docker**: Binary is simpler than container images
   - No Docker daemon required
   - Faster startup (no container overhead)
   - Easier to manage in daemon
   - Consistent with Temporal's distribution model

2. **vs Nuitka**: PyInstaller is mature and well-supported
   - Extensive hook ecosystem for popular packages
   - Known to work with our dependencies (temporalio, langchain)
   - Faster iteration during development

3. **vs Source Distribution**: Eliminates Python environment complexity
   - User doesn't need Python or Poetry
   - No "works on my machine" due to environment differences
   - Consistent experience across deployments

See `_cursor/adr-use-python-binary.md` for detailed architectural decision record.

## Related Work

This supersedes the Docker container approach explored in:
- `_projects/2026-01/20260121.02.agent-runner-container-architecture/` (marked OBSOLETE)

The key insight shift: **Don't manage Python environments, manage binaries.**

---

**Author**: AI Assistant  
**Reviewed**: Pending  
**Status**: Complete - Binary build infrastructure ready for use
