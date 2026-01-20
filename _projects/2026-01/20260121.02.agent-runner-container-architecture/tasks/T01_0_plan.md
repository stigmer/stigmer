# T01 - Initial Task Plan

**Created**: 2026-01-21  
**Status**: ⏸️ PENDING REVIEW  
**Type**: Plan

## Overview

This is the initial task breakdown for transforming agent-runner to a containerized architecture with complete lifecycle management (local dev, CI/CD, Brew integration).

**IMPORTANT**: This plan needs your review and approval before execution begins.

## Task Breakdown

### Task 1: Containerize Agent-Runner with Local Development Workflow
**Estimated Duration**: Week 1  
**Status**: ⏸️ TODO

**Objectives**:
- Create optimized multi-stage Dockerfile for agent-runner
- Add Makefile targets for local building and testing
- Implement version tagging strategy
- Ensure security best practices (non-root user, health checks)

**Deliverables**:
- `backend/services/agent-runner/Dockerfile` (multi-stage, optimized)
- `backend/services/agent-runner/Makefile` with targets:
  - `build-image VERSION=<version>` - Build local image
  - `run-local` - Run container locally for testing
  - `test-image` - Validate image works
  - `docker-login` - Authenticate to ghcr.io
  - `push-image VERSION=<version>` - Manual push to registry
- `.dockerignore` for build optimization
- Local testing validated (can run agent-runner in container)

**Key Decisions**:
- Base image: `python:3.11-slim` (balance size vs compatibility)
- Multi-stage build: builder stage + runtime stage
- Non-root user: `stigmer` user with UID 1000
- Health check: TCP check on gRPC port
- Version tags: semantic versioning (1.2.3, 1.2, 1, latest)

**Acceptance Criteria**:
- [ ] Developer can run `make build-image VERSION=dev-test`
- [ ] Image builds successfully (<100MB target)
- [ ] Developer can run `make run-local` and container starts
- [ ] Health check passes
- [ ] Agent-runner connects to local Temporal
- [ ] Manual `make push-image` works (with credentials)

---

### Task 2: CLI Container Management Integration
**Estimated Duration**: Week 2  
**Status**: ⏸️ TODO

**Objectives**:
- Add Docker/Podman detection and abstraction
- Implement container lifecycle management in CLI
- Support local image preference over remote pull
- Add proper logging and error handling

**Deliverables**:
- `client-apps/cli/internal/container/` (new package)
  - `runtime.go` - Detect Docker vs Podman
  - `manager.go` - Container lifecycle (start, stop, logs, cleanup)
  - `image.go` - Image pull, version detection, local vs remote
- Update `client-apps/cli/internal/cli/daemon/daemon.go`:
  - Replace shell script execution with container management
  - Add `--use-local-image` flag for development
- Environment variable passthrough to container
- Network configuration (host mode for Temporal communication)

**Key Decisions**:
- Container runtime abstraction (support both Docker and Podman)
- Image resolution order: local dev image → local tagged image → remote pull
- Network mode: host networking for simplicity (Temporal on localhost:7233)
- Container naming: `stigmer-agent-runner` (consistent, easy to find)
- Volume mounts: workspace directory for code access
- Environment variables: Pass TEMPORAL_SERVICE_ADDRESS, STIGMER_BACKEND_ENDPOINT, etc.

**Acceptance Criteria**:
- [ ] CLI detects Docker or Podman automatically
- [ ] `stigmer server start` pulls image if not present
- [ ] `stigmer server start --use-local-image` uses local image
- [ ] Container starts with proper environment variables
- [ ] `stigmer server logs --all` includes agent-runner logs
- [ ] `stigmer server stop` properly stops and removes container
- [ ] Works on macOS (Docker Desktop) and Linux (Podman)

---

### Task 3: GitHub Actions CI/CD Pipeline
**Estimated Duration**: Week 2  
**Status**: ⏸️ TODO

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
- GitHub Actions secrets configuration documentation
- Release checklist in documentation

**Key Decisions**:
- Registry: GitHub Container Registry (ghcr.io) - free, integrated
- Authentication: GITHUB_TOKEN (automatic, no setup needed)
- Multi-arch: Use Docker buildx with qemu
- Platforms: linux/amd64, linux/arm64 (no darwin - containers don't run on macOS)
- Tagging strategy:
  - `latest` - Always points to most recent release
  - `v1.2.3` - Exact version
  - `v1.2` - Latest patch in minor version
  - `v1` - Latest minor in major version

**Acceptance Criteria**:
- [ ] Workflow triggers on tag push (v1.2.3)
- [ ] Builds multi-arch images (amd64, arm64)
- [ ] Pushes to ghcr.io/stigmer/agent-runner with all tags
- [ ] Images are publicly accessible
- [ ] Workflow succeeds end-to-end
- [ ] Manual workflow dispatch works for testing

---

### Task 4: Homebrew Formula Integration
**Estimated Duration**: Week 3  
**Status**: ⏸️ TODO

**Objectives**:
- Update Homebrew formula to coordinate CLI version with container version
- Embed container version info in CLI at build time
- Ensure seamless user experience (zero Docker commands)

**Deliverables**:
- Update Homebrew formula (stigmer tap):
  - Add container version as dependency metadata
  - Document that Docker/Podman is required
- CLI version coordination:
  - Embed expected agent-runner image tag at compile time
  - `client-apps/cli/version/version.go` - Add AgentRunnerImageTag constant
- User documentation:
  - Installation guide with Docker/Podman prerequisites
  - First-run experience documentation

**Key Decisions**:
- CLI embeds expected image version (e.g., "v1.2.3")
- CLI pulls exact version, not "latest" (reproducibility)
- CLI checks for Docker/Podman on first run, provides helpful error if missing
- No fallback to shell script - container is the only mode

**Acceptance Criteria**:
- [ ] `brew install stigmer` installs CLI with version info
- [ ] First `stigmer server start` pulls correct image version
- [ ] No Docker commands needed from user
- [ ] Clear error message if Docker/Podman not installed
- [ ] `stigmer version` shows both CLI and expected agent-runner versions
- [ ] End-to-end Brew install → first run tested

---

### Task 5: Testing, Documentation, and Cleanup
**Estimated Duration**: Week 3  
**Status**: ⏸️ TODO

**Objectives**:
- Comprehensive end-to-end testing on all platforms
- Complete documentation for developers and users
- Remove old shell script and Poetry-based startup code
- Create troubleshooting guides

**Deliverables**:
- **Testing**:
  - Test matrix: macOS (Docker Desktop), Linux (Podman, Docker)
  - Local dev workflow tested
  - CI/CD pipeline tested end-to-end
  - Brew installation tested
- **Documentation**:
  - `backend/services/agent-runner/README.md` - Updated with container instructions
  - `client-apps/cli/README.md` - Updated with container architecture
  - `docs/DEVELOPER_GUIDE.md` - Local development workflow
  - `docs/USER_GUIDE.md` - Installation and usage
  - `docs/TROUBLESHOOTING.md` - Common issues and solutions
- **Cleanup**:
  - Remove `backend/services/agent-runner/run.sh`
  - Remove shell script handling in CLI daemon code
  - Remove `STIGMER_AGENT_RUNNER_SCRIPT` and `STIGMER_AGENT_RUNNER_WORKSPACE` env var handling
  - Update all references to new container architecture
- **Changelog**:
  - Create comprehensive changelog entry

**Key Decisions**:
- Complete removal of shell script fallback (clean break)
- Migration guide for existing users (if needed)
- Document Docker/Podman requirement clearly

**Acceptance Criteria**:
- [ ] All workflows tested on target platforms
- [ ] Developer guide complete and validated
- [ ] User guide complete and validated
- [ ] Troubleshooting guide covers common scenarios
- [ ] Old shell script code removed
- [ ] Changelog entry created
- [ ] All documentation updated
- [ ] README files reflect new architecture

---

## Overall Timeline

**Week 1**: Tasks 1 (Containerization + Local Dev)  
**Week 2**: Tasks 2-3 (CLI Integration + CI/CD)  
**Week 3**: Tasks 4-5 (Brew + Testing/Docs)

**Total**: 3 weeks

## Dependencies Between Tasks

- Task 2 depends on Task 1 (need working container)
- Task 3 can run in parallel with Task 2 after Task 1 complete
- Task 4 depends on Tasks 1-3 (need full pipeline working)
- Task 5 depends on all previous tasks

## Risks and Open Questions

1. **Image Size**: Target <100MB. If larger, need to optimize further (alpine base, strip unnecessary packages)

2. **Network Mode**: Host networking is simplest but may not work in all environments. May need to support bridge mode with port mapping.

3. **Volume Mounts**: Do we need to mount workspace directories for code access? Or is agent-runner fully self-contained?

4. **Temporal Connection**: How does containerized agent-runner connect to Temporal? Localhost? Container networking?

5. **Development Experience**: How do developers debug issues in container? Need good logging and possibly exec access.

6. **Migration**: Do existing users need migration path from shell script? Or is this for new installations only?

## Review Feedback Requested

Please review this plan and provide feedback on:

1. **Task breakdown**: Are these the right tasks? Anything missing?
2. **Priorities**: Is the order correct? Any tasks that should be reordered?
3. **Timeline**: Does 3 weeks seem reasonable?
4. **Risks**: Are there risks I haven't considered?
5. **Open questions**: Can you help clarify the open questions above?

Once you approve (or provide feedback for revision), I'll proceed with execution.
