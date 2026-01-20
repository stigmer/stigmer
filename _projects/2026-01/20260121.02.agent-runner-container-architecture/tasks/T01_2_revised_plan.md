# T01 - Revised Task Plan

**Created**: 2026-01-21  
**Status**: ⏸️ PENDING APPROVAL  
**Type**: Revised Plan  
**Previous**: T01_0_plan.md → T01_1_review.md

## Overview

This is the revised task breakdown incorporating feedback from T01_1_review.md. Key improvements:
- Clarified volume mount strategy and network configuration
- Added container health check requirements
- Enhanced image size optimization approach
- Improved first-run user experience
- Added CLI binary size reduction tasks

## Task Breakdown

### Task 1: Containerize Agent-Runner with Local Development Workflow

**Estimated Duration**: Week 1  
**Status**: ⏸️ TODO

**Objectives**:
- Create optimized multi-stage Dockerfile for agent-runner
- Add Makefile targets for local building and testing
- Implement version tagging strategy
- Ensure security best practices (non-root user, health checks)
- Configure volume mounts and environment passthrough

**Deliverables**:
- `backend/services/agent-runner/Dockerfile` (multi-stage, optimized)
  - Builder stage: Poetry + dependency installation
  - Runtime stage: Minimal Python 3.11-slim + app code
  - Non-root user (UID 1000)
  - Working directory: `/app`
  - Volume mount point: `/workspace`
  - Health check: gRPC readiness validation
- `backend/services/agent-runner/Makefile` with targets:
  - `build-image VERSION=<version>` - Build local image
  - `run-local` - Run container locally for testing
  - `test-image` - Validate image works (health check passes)
  - `docker-login` - Authenticate to ghcr.io
  - `push-image VERSION=<version>` - Manual push to registry
- `.dockerignore` for build optimization:
  - `__pycache__/`, `*.pyc`, `.pytest_cache/`
  - `.venv/`, `docs/`, `tests/`, `.git/`
- `backend/services/agent-runner/docs/docker.md`:
  - Volume mounts explained (workspace persistence)
  - Environment variables documented
  - Health check behavior
  - Local testing guide
- Local testing validated (can run agent-runner in container)

**Key Decisions**:

**Base Image**: `python:3.11-slim` (~150MB)
- Balance between size and compatibility
- Well-maintained official image
- Good package availability

**Multi-Stage Build Strategy**:
```dockerfile
# Stage 1: Builder (install dependencies)
FROM python:3.11-slim AS builder
RUN pip install poetry
COPY pyproject.toml poetry.lock ./
RUN poetry export -f requirements.txt --without-hashes > requirements.txt

# Stage 2: Runtime (minimal image)
FROM python:3.11-slim
COPY --from=builder requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . /app
WORKDIR /app
USER stigmer
CMD ["python", "main.py"]
```

**Volume Mounts**:
- `~/.stigmer/data/workspace:/workspace` (read-write)
- Purpose: Persist filesystem-based sandboxes across container restarts
- Required for: Session-based sandbox reuse (90% cost reduction)
- Contains: Agent execution files, skills, intermediate artifacts

**Non-Root User**:
- Username: `stigmer`
- UID: 1000 (standard non-privileged user)
- Ownership: `/app` directory and `/workspace` mount

**Health Check**:
- Not just TCP check - validate Temporal worker is registered
- Interval: 30s, Timeout: 10s, Retries: 3
- Command: Check if agent-runner is ready (gRPC health endpoint or Temporal connection)

**Version Tagging Strategy**:
- `latest` - Always points to most recent release
- `v1.2.3` - Exact semantic version
- `v1.2` - Latest patch in minor version
- `v1` - Latest minor in major version
- `dev-<sha>` - Development builds

**Target Image Size**: <100MB (achievable with multi-stage + .dockerignore)

**Acceptance Criteria**:
- [ ] Developer can run `make build-image VERSION=dev-test`
- [ ] Image builds successfully (<100MB target)
- [ ] Developer can run `make run-local` and container starts
- [ ] Health check passes (validates Temporal connection)
- [ ] Agent-runner registers with Temporal worker pool
- [ ] Volume mount for workspace directory configured
- [ ] Environment variable passthrough documented
- [ ] Manual `make push-image` works (with credentials)
- [ ] Documentation in `docs/docker.md` complete

---

### Task 2: CLI Container Management Integration

**Estimated Duration**: Week 2  
**Status**: ⏸️ TODO

**Objectives**:
- Add Docker/Podman detection and abstraction
- Implement container lifecycle management in CLI
- Support local image preference over remote pull
- Add proper logging and error handling
- Configure volume mounts and network mode
- Implement first-run progress indicators

**Deliverables**:
- `client-apps/cli/internal/container/` (new package)
  - `runtime.go` - Detect Docker vs Podman
  - `manager.go` - Container lifecycle (start, stop, logs, cleanup)
  - `image.go` - Image pull, version detection, local vs remote
  - `pull_progress.go` - Progress display during image pull
- Update `client-apps/cli/internal/cli/daemon/daemon.go`:
  - Replace shell script execution with container management
  - Add `--use-local-image` flag for development
  - Configure volume mounts: `~/.stigmer/data/workspace:/workspace`
  - Configure network: `--network host` (required for Temporal)
- Environment variable passthrough to container:
  - `MODE=local`
  - `SANDBOX_TYPE=filesystem`
  - `SANDBOX_ROOT_DIR=/workspace`
  - `TEMPORAL_SERVICE_ADDRESS=localhost:7233`
  - `STIGMER_BACKEND_ENDPOINT=localhost:7234`
  - `STIGMER_LLM_PROVIDER`, `STIGMER_LLM_MODEL`, etc.
- First-run experience:
  - Progress indicator during image pull
  - Clear messaging about one-time setup
  - Estimate download size (~80MB)
- Error handling:
  - Clear message if Docker/Podman not found
  - Installation instructions per platform
- Documentation: `client-apps/cli/docs/container-mode.md`

**Key Decisions**:

**Container Runtime Abstraction**:
- Support both Docker and Podman
- Detection order: `docker` → `podman` → error
- Use same CLI flags for both (mostly compatible)

**Image Resolution Order**:
1. Local dev image (if `--use-local-image` flag set)
2. Local tagged image (if exists and matches version)
3. Remote pull from ghcr.io (default)

**Network Mode**: `--network host` (REQUIRED)
- Rationale: Container needs access to Temporal on `localhost:7233`
- Also needs: stigmer-server on `localhost:7234`
- No port mapping needed
- Simplest configuration for local development

**Container Naming**: `stigmer-agent-runner`
- Consistent, easy to find with `docker ps`
- Single instance (restart if already running)

**Volume Mounts**:
```bash
-v ~/.stigmer/data/workspace:/workspace:rw
```
- Read-write access required (agent creates files)
- Persists across container restarts
- Shared with host filesystem sandboxes

**Environment Variables**: Pass-through from daemon config
- LLM configuration: provider, model, base URL, API keys
- Temporal configuration: address, namespace, task queue
- Backend configuration: endpoint, API key
- Logging configuration: level, format

**Error Messages**:
```
Error: Container runtime not found

Stigmer requires Docker or Podman to run the agent-runner service.

Install Docker Desktop:
  https://www.docker.com/products/docker-desktop

Or install Podman:
  brew install podman      (macOS)
  apt install podman       (Ubuntu)
  dnf install podman       (Fedora)
```

**Acceptance Criteria**:
- [ ] CLI detects Docker or Podman automatically
- [ ] `stigmer server start` pulls image if not present
- [ ] Image pull shows progress indicator with size estimate
- [ ] `stigmer server start --use-local-image` uses local image
- [ ] Container starts with `--network host`
- [ ] Volume mount created at `~/.stigmer/data/workspace`
- [ ] Workspace persists across container restarts
- [ ] Container starts with proper environment variables
- [ ] Environment variables visible in container logs
- [ ] `stigmer server logs --all` includes agent-runner logs
- [ ] `stigmer server stop` properly stops and removes container
- [ ] Works on macOS (Docker Desktop) and Linux (Podman)
- [ ] Clear error message if Docker/Podman not found

---

### Task 3: GitHub Actions CI/CD Pipeline

**Estimated Duration**: Week 2 (parallel with Task 2)  
**Status**: ⏸️ TODO

**Note**: This task can run in parallel with Task 2 after Task 1 completes.

**Objectives**:
- Create GitHub Actions workflow for building and publishing images
- Support multi-architecture builds (amd64, arm64)
- Implement semantic versioning and tagging strategy
- Automate image publishing on git tag push

**Deliverables**:
- `.github/workflows/build-agent-runner-image.yml`:
  - Triggered on: push to main, pull requests, tag push (v*)
  - Multi-arch build using Docker buildx
  - Push to ghcr.io/stigmer/agent-runner
  - Tags: latest, vX.Y.Z, vX.Y, vX
  - Workflow permissions: write packages
- GitHub Actions secrets configuration documentation
- Release checklist in documentation:
  - How to create a release
  - Version bumping process
  - Testing before release
  - Rollback procedure

**Key Decisions**:

**Registry**: GitHub Container Registry (ghcr.io)
- Free for public repositories
- Integrated with GitHub Actions
- No additional setup required
- Good performance and reliability

**Authentication**: `GITHUB_TOKEN` (automatic)
- GitHub provides token automatically to workflows
- No manual secrets configuration needed
- Scoped to repository access only

**Multi-Architecture Build**:
- Use Docker buildx with QEMU emulation
- Platforms: `linux/amd64`, `linux/arm64`
- No `darwin` platform (containers don't run natively on macOS)
- Single manifest for both architectures

**Tagging Strategy** (on git tag `v1.2.3` push):
```yaml
tags:
  - ghcr.io/stigmer/agent-runner:latest
  - ghcr.io/stigmer/agent-runner:v1.2.3
  - ghcr.io/stigmer/agent-runner:v1.2
  - ghcr.io/stigmer/agent-runner:v1
```

**Workflow Triggers**:
- `push` to `main`: Build and push `:latest` (development)
- `pull_request`: Build only (no push) for validation
- `push` tag `v*`: Build and push all version tags (release)
- `workflow_dispatch`: Manual trigger for testing

**Build Context**: Repository root (need access to `backend/services/agent-runner`)

**Acceptance Criteria**:
- [ ] Workflow triggers on tag push (v1.2.3)
- [ ] Builds multi-arch images (amd64, arm64)
- [ ] Pushes to ghcr.io/stigmer/agent-runner with all tags
- [ ] Images are publicly accessible (no authentication needed)
- [ ] Workflow succeeds end-to-end
- [ ] Manual workflow dispatch works for testing
- [ ] PR builds succeed without pushing images
- [ ] Main branch pushes update `:latest` tag
- [ ] Release checklist documented

---

### Task 4: Homebrew Formula Integration

**Estimated Duration**: Week 3  
**Status**: ⏸️ TODO

**Objectives**:
- Update Homebrew formula to coordinate CLI version with container version
- Embed container version info in CLI at build time
- Ensure seamless user experience (zero Docker commands)
- Reduce CLI binary size by removing embedded Python source

**Deliverables**:
- Update Homebrew formula (stigmer tap):
  - Add container version as dependency metadata
  - Document that Docker/Podman is required
  - Add caveat about first-run image pull
- CLI version coordination:
  - `client-apps/cli/version/version.go` - Add constants:
    ```go
    const (
        Version = "1.2.3"
        AgentRunnerImageTag = "v1.2.3"
        AgentRunnerImageRepo = "ghcr.io/stigmer/agent-runner"
    )
    
    func GetAgentRunnerImage() string {
        return fmt.Sprintf("%s:%s", AgentRunnerImageRepo, AgentRunnerImageTag)
    }
    ```
  - Update build process to set version at compile time
- Remove embedded Python source:
  - Update `embedded/embed.go` to exclude agent-runner
  - Keep only stigmer-server and workflow-runner
  - Remove agent-runner extraction logic from `embedded/extract.go`
  - Expected savings: ~10-20MB CLI binary size
- User documentation:
  - Installation guide with Docker/Podman prerequisites
  - First-run experience documentation
  - Troubleshooting guide for container issues

**Key Decisions**:

**Version Coordination**:
- CLI embeds expected image tag (e.g., "v1.2.3")
- CLI pulls exact version, not "latest" (reproducibility)
- Development override: `STIGMER_AGENT_RUNNER_IMAGE=local-dev:latest`

**Docker/Podman Requirement**:
- CLI checks for runtime on first run
- Provides helpful error with installation instructions
- No fallback to shell script - container is the only mode

**Embedded Assets** (before):
```
CLI binary includes:
- stigmer-server binary (~30MB)
- workflow-runner binary (~20MB)
- agent-runner Python source + pyproject.toml (~15MB)
Total: ~65MB
```

**Embedded Assets** (after):
```
CLI binary includes:
- stigmer-server binary (~30MB)
- workflow-runner binary (~20MB)
- agent-runner image reference (few bytes)
Total: ~50MB (-15MB savings)
```

**Homebrew Caveats**:
```ruby
caveats <<~EOS
  Stigmer requires Docker or Podman to run the agent-runner service.
  
  Install Docker Desktop:
    https://www.docker.com/products/docker-desktop
  
  Or install Podman:
    brew install podman
  
  On first run, Stigmer will download the agent-runner image (~80MB).
EOS
```

**Acceptance Criteria**:
- [ ] `brew install stigmer` installs CLI with version info
- [ ] CLI binary size reduced by ~15MB
- [ ] First `stigmer server start` pulls correct image version
- [ ] No Docker commands needed from user
- [ ] Clear error message if Docker/Podman not installed
- [ ] `stigmer version` shows both CLI and expected agent-runner versions
- [ ] Development mode supports `STIGMER_AGENT_RUNNER_IMAGE` override
- [ ] End-to-end Brew install → first run tested
- [ ] Homebrew formula includes Docker/Podman requirement caveat

---

### Task 5: Testing, Documentation, and Cleanup

**Estimated Duration**: Week 3  
**Status**: ⏸️ TODO

**Objectives**:
- Comprehensive end-to-end testing on all platforms
- Complete documentation for developers and users
- Remove old shell script and Poetry-based startup code
- Create troubleshooting guides
- Clean up embedded assets extraction logic

**Deliverables**:

**Testing**:
- Test matrix: macOS (Docker Desktop), Linux (Podman, Docker)
- Local dev workflow tested:
  - `make build-image` → `--use-local-image` → test changes
- CI/CD pipeline tested end-to-end:
  - Create test tag → verify images pushed → verify all tags
- Brew installation tested:
  - Fresh install → first run → image pull → agent execution
- Workspace persistence tested:
  - Create sandbox → restart container → verify files persist
- Environment variable injection tested:
  - Verify LLM config, Temporal config visible in logs

**Documentation**:
- `backend/services/agent-runner/README.md` - Update with:
  - Container architecture overview
  - Local development with Docker
  - Makefile targets explained
  - Volume mounts and persistence
  - Environment variables reference
- `backend/services/agent-runner/docs/docker.md` - New document:
  - Detailed Docker setup
  - Multi-stage build explanation
  - Health check implementation
  - Debugging containers
- `client-apps/cli/README.md` - Update with:
  - Container mode architecture
  - How CLI manages containers
  - Development workflow changes
- `client-apps/cli/docs/container-mode.md` - New document:
  - Container runtime detection
  - Image pull process
  - Volume mounts and networking
  - Troubleshooting
- `docs/DEVELOPER_GUIDE.md` - Update:
  - Local development workflow
  - Building local images
  - Testing container changes
- `docs/USER_GUIDE.md` - Update:
  - Installation prerequisites
  - First-run experience
  - What happens on `stigmer server start`
- `docs/TROUBLESHOOTING.md` - New document:
  - Docker/Podman not found
  - Image pull failures
  - Container networking issues
  - Workspace permission errors
  - How to inspect running containers

**Cleanup**:
- [ ] Remove `backend/services/agent-runner/run.sh`
- [ ] Remove shell script handling in `daemon.go`:
  - Delete `findAgentRunnerScript()` function
  - Delete shell script execution logic
  - Delete `STIGMER_AGENT_RUNNER_SCRIPT` env var handling
  - Delete `STIGMER_AGENT_RUNNER_WORKSPACE` env var handling (lines 353-394)
- [ ] Update `embedded/embed.go`:
  - Remove agent-runner directory from embedded assets
  - Keep only stigmer-server and workflow-runner
- [ ] Update `embedded/extract.go`:
  - Remove agent-runner extraction logic
  - Update tests to not expect agent-runner files
- [ ] Update all references to new container architecture:
  - Search for "run.sh" references
  - Search for "Poetry" references in docs
  - Update environment variable documentation

**Changelog**:
- Create comprehensive changelog entry following Stigmer conventions
- Explain what changed and why
- Document breaking changes (if any)
- Provide migration guide (upgrade instructions)

**Key Decisions**:
- Complete removal of shell script fallback (clean break)
- No migration needed (CLI upgrade handles everything)
- Document Docker/Podman requirement clearly upfront
- Keep old embedded extraction code until after release (safety)

**Acceptance Criteria**:
- [ ] All workflows tested on target platforms (macOS Docker, Linux Podman)
- [ ] Developer guide complete and validated by team
- [ ] User guide complete and validated by team
- [ ] Troubleshooting guide covers common scenarios:
  - Docker not installed
  - Podman not found
  - Image pull timeout
  - Network connectivity issues
  - Workspace permission errors
  - Container logs access
- [ ] Old shell script code removed (`run.sh`)
- [ ] Shell script execution logic removed from CLI
- [ ] Embedded Python source removed from CLI binary
- [ ] CLI binary size reduced by ~15MB
- [ ] Changelog entry created
- [ ] All documentation updated
- [ ] README files reflect new architecture
- [ ] End-to-end test: Fresh macOS → Brew install → First run → Agent execution

---

## Overall Timeline

**Week 1**: Task 1 (Containerization + Local Dev)  
**Week 2**: Tasks 2 & 3 in parallel (CLI Integration + CI/CD)  
**Week 3**: Tasks 4-5 (Brew + Testing/Docs)

**Total**: 3 weeks (optimized from sequential to partial parallelization)

## Dependencies Between Tasks

- Task 2 depends on Task 1 (need working container)
- Task 3 depends on Task 1 (need Dockerfile to build)
- **Task 3 can run in parallel with Task 2** (independent after Task 1)
- Task 4 depends on Tasks 1-3 (need full pipeline working)
- Task 5 depends on all previous tasks

## Parallelization Strategy

**Week 2 can split work**:
- Track A: CLI integration (Task 2) - Go development
- Track B: CI/CD pipeline (Task 3) - GitHub Actions YAML

If resources allow, this saves ~0.5 weeks.

## Risks and Mitigation

### Risk 1: Image Size >100MB

**Mitigation**:
- Multi-stage build (proven to work)
- Aggressive .dockerignore
- Export to requirements.txt (no Poetry in runtime)
- If needed: Use alpine base (more complex but smaller)

### Risk 2: Network Mode Compatibility

**Mitigation**:
- Host networking is standard for Docker/Podman
- Document clearly in README
- Test on both macOS and Linux
- Provide fallback docs for bridge mode (if needed)

### Risk 3: Volume Mount Permissions

**Mitigation**:
- Use UID 1000 (standard non-root)
- Document permission requirements
- Test on macOS (different filesystem) and Linux
- Provide troubleshooting for permission denied errors

### Risk 4: First-Run Image Pull Timeout

**Mitigation**:
- Show progress indicator with size estimate
- Set reasonable timeout (5 minutes)
- Provide clear error message on timeout
- Document how to manually pull: `docker pull ghcr.io/stigmer/agent-runner:v1.2.3`

### Risk 5: Container Runtime Detection Fails

**Mitigation**:
- Test both Docker and Podman
- Provide clear error message with installation instructions
- Document platform-specific installation
- Consider auto-install offer (future enhancement)

### Risk 6: Workspace Persistence Issues

**Mitigation**:
- Document volume mount clearly
- Test sandbox creation → container restart → verify files
- Provide troubleshooting for missing files
- Log volume mount path on container start

### Risk 7: Poetry Build Time

**Mitigation**:
- Use requirements.txt export (faster, cacheable)
- Cache pip dependencies in Docker layer
- Optimize build order (most stable layers first)

### Risk 8: CLI Binary Size Still Too Large

**Mitigation**:
- Remove embedded Python source (~15MB savings expected)
- Use UPX compression on binaries (optional, ~30% savings)
- Split CLI and daemon into separate binaries (future)

## Review Changes from T01_0_plan.md

### Added

- ✅ Volume mount strategy and configuration
- ✅ Network mode clarification (host required)
- ✅ Health check requirements (gRPC readiness)
- ✅ First-run progress indicators
- ✅ Image pull experience improvements
- ✅ CLI binary size reduction tasks
- ✅ Embedded assets cleanup
- ✅ Container runtime detection and error handling
- ✅ Workspace persistence testing
- ✅ Environment variable validation
- ✅ Docker documentation

### Updated

- ✅ Task 2: Network mode rationale strengthened
- ✅ Task 4: Version coordination strategy clarified
- ✅ Task 5: Cleanup tasks expanded
- ✅ Timeline: Added parallelization opportunity

### Clarified

- ✅ Open questions answered with codebase evidence
- ✅ Risk mitigation strategies added
- ✅ Acceptance criteria expanded

## Next Steps

1. ✅ T01_1_review.md created
2. ✅ T01_2_revised_plan.md created (this document)
3. ⏸️ **Awaiting approval to proceed**
4. ⏸️ Create T01_3_execution.md and begin Task 1

---

**Ready for approval**: This revised plan incorporates all feedback and provides a clear path to production-ready containerization.
