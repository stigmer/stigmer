# Project: Migrate Agent-Runner to Docker

**Created**: 2026-01-22  
**Status**: Planning  
**Timeline**: 4-6 hours (single session)

## Description

Replace PyInstaller-based agent-runner binary with Docker-based distribution to solve persistent multipart import issues.

## Primary Goal

Get agent-runner working reliably using Docker instead of PyInstaller, eliminating packaging complexity and import errors.

## Context

After 7+ hours of attempting to fix PyInstaller import issues with the `python-multipart` package, we've exhausted all reasonable approaches:
- PyInstaller hooks
- Runtime hooks  
- Data file inclusion
- TOC manipulation
- Lazy imports
- Pre-import injection (Gemini's suggestion)

All approaches failed due to PyInstaller's fundamental limitations with dynamic imports and complex dependency chains (daytona SDK → httpx → multipart).

## Technical Details

**Technology Stack**: Python, Docker, Docker Compose, Go (stigmer CLI updates)

**Project Type**: Migration

**Affected Components**:
- agent-runner service (Python)
- stigmer CLI daemon management (Go)
- server startup orchestration

## Dependencies

- Docker must be installed on user machines
- Docker daemon must be running
- Docker Compose for orchestration (optional but recommended)

## Success Criteria

1. ✅ agent-runner starts successfully in Docker container
2. ✅ Processes agent executions without import errors
3. ✅ `stigmer server start` handles Docker container lifecycle
4. ✅ Logs accessible via `stigmer server logs` command
5. ✅ No multipart import errors

## Risks & Challenges

1. **UX Change**: Users now need Docker installed (additional dependency)
2. **Installation Complexity**: Need clear Docker install instructions
3. **Docker Daemon Overhead**: ~200MB memory, startup time
4. **Container Networking**: Ensure proper localhost connectivity
5. **Volume Mounts**: Workspace and logs need proper mounting

## Related Context

- **Issue**: PyInstaller multipart import error
- **Context Document**: `_cursor/pyinstaller-multipart-issue-context.md`
- **Gemini Analysis**: `_cursor/gemini-response.md`
- **Post-Mortem**: `_cursor/adr-how-to-handle-multipart-package.md`
- **Error Logs**: `_cursor/logs.md`, `_cursor/error.md`

## Why Docker?

**Benefits**:
- ✅ Regular Python environment (no packaging surprises)
- ✅ Development = Production environment
- ✅ No import/freeze issues
- ✅ Easy debugging (shell into container)
- ✅ Industry standard
- ✅ Future-proof for new dependencies

**Trade-offs**:
- ❌ Requires Docker installation
- ❌ Slightly larger "distribution"
- ❌ Container startup overhead

## Current State

- **stigmer-server (Go)**: ✅ Works as native binary
- **workflow-runner (Go)**: ✅ Works as native binary
- **agent-runner (Python)**: ❌ Broken with PyInstaller
  - **Workaround**: Run with `poetry run python main.py` (dev mode)

## Success Metrics

- Time to implement: < 6 hours
- Binary size: N/A (Docker image ~200-300MB)
- Startup time: < 5 seconds (container cold start)
- Memory usage: ~200MB (Python + container overhead)
- Ongoing maintenance: Minimal (just Dockerfile updates)

## Next Steps

See `tasks/T01_0_plan.md` for initial task breakdown and implementation plan.
