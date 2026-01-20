# T01 - Review Feedback

**Created**: 2026-01-21  
**Status**: ✅ COMPLETE  
**Type**: Review

## Executive Summary

The initial plan (T01_0_plan.md) is **APPROVED with enhancements**. The task breakdown is solid, timeline is reasonable, and acceptance criteria are clear. This review provides answers to open questions and recommendations for strengthening the plan.

## Strengths of the Plan

1. **Clear task breakdown** - Logical progression from containerization → CLI integration → CI/CD → Brew
2. **Good timeline** - 3 weeks is reasonable with proper focus
3. **Comprehensive acceptance criteria** - Clear definition of done for each task
4. **Proper dependency management** - Tasks ordered correctly

## Answers to Open Questions

### Q1: Volume Mounts - Do we need workspace mounting?

**Answer**: YES, volume mounts are required.

**Evidence from codebase** (`daemon.go:365`):
```go
env = append(env,
    "SANDBOX_TYPE=filesystem",
    "SANDBOX_ROOT_DIR=./workspace",
)
```

Agent-runner uses filesystem-based sandboxes that need to persist across:
- Multiple agent executions
- Container restarts
- Session-based sandbox reuse (90% cost reduction)

**Required mount**:
```
-v ~/.stigmer/data/workspace:/workspace
```

### Q2: Temporal Connection - How does agent-runner connect?

**Answer**: Host networking is REQUIRED.

**Evidence from codebase** (`daemon.go:369`):
```go
fmt.Sprintf("TEMPORAL_SERVICE_ADDRESS=%s", temporalAddr)
```

Agent-runner receives Temporal address as environment variable. In managed Temporal mode (default), this is `localhost:7233`.

**Container network mode**:
```
--network host
```

This allows container to connect to:
- Temporal on host: `localhost:7233`
- stigmer-server on host: `localhost:7234`

### Q3: Network Mode - Bridge vs Host?

**Answer**: Host networking is the right choice.

**Rationale**:
- ✅ Simplest configuration (no port mapping)
- ✅ Direct access to Temporal on localhost
- ✅ Direct access to stigmer-server on localhost
- ✅ Works for local development use case
- ✅ No security concerns (all traffic is localhost)

Bridge mode would require:
- Port mapping configuration
- Service discovery complexity
- Host network aliases
- More error-prone setup

### Q4: Development Experience - How to debug?

**Answer**: Already planned in Task 2 with `--use-local-image` flag.

**Additional recommendations**:
- Good logging to `~/.stigmer/data/logs/agent-runner.log`
- `stigmer server logs --service agent-runner` command
- Document `docker exec` for advanced debugging
- Support `STIGMER_AGENT_RUNNER_DEBUG=true` for verbose logging

### Q5: Migration - Do users need migration path?

**Answer**: NO migration needed. Clean break is acceptable.

**Current approach**:
- CLI embeds Python source + `pyproject.toml`
- Extracts to `~/.stigmer/data/bin/agent-runner/`
- Runs via `run.sh` → Poetry → Python

**New approach**:
- CLI references container image tag
- Pulls image from ghcr.io
- Runs via Docker/Podman

**User experience**:
```bash
brew upgrade stigmer     # Upgrades to new CLI
stigmer server start     # Automatically pulls new image
```

No manual steps required. Old extracted files in `~/.stigmer/data/bin/agent-runner/` become unused but harmless.

### Q6: Image Size - Can we achieve <100MB?

**Answer**: YES, easily achievable with multi-stage build.

**Size breakdown**:
- `python:3.11-slim` base: ~150MB
- Poetry + dependencies: ~50MB
- **Multi-stage optimization**: Copy only runtime deps
- **Expected final size**: ~80MB

**Strategies**:
```dockerfile
# Builder stage: Install dependencies
FROM python:3.11-slim AS builder
RUN pip install poetry
COPY pyproject.toml poetry.lock ./
RUN poetry export -f requirements.txt --without-hashes > requirements.txt

# Runtime stage: Minimal image
FROM python:3.11-slim
COPY --from=builder requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
```

Plus aggressive `.dockerignore`:
```
__pycache__/
*.pyc
.pytest_cache/
.venv/
docs/
tests/
```

## Recommended Enhancements

### Task 1: Containerize Agent-Runner

**Add acceptance criteria**:
- [ ] Volume mount for workspace directory configured
- [ ] Environment variable passthrough documented
- [ ] Health check validates gRPC readiness (not just port open)

**Add deliverables**:
- `backend/services/agent-runner/docs/docker.md`
  - Volume mounts explained
  - Environment variables documented
  - Health check behavior
  - Local testing guide

**Update Key Decisions**:
```yaml
Volume Mounts:
  - ~/.stigmer/data/workspace:/workspace (sandbox persistence)
  - Read-write access required (skills, agent files)
  
Health Check:
  - Not just TCP check - validate Temporal worker registration
  - Use Temporal gRPC health check endpoint if available
  - 30s interval, 3 retries, 10s timeout
```

### Task 2: CLI Container Management

**Update Key Decisions**:
```diff
- Network mode: host networking for simplicity (Temporal on localhost:7233)
+ Network mode: host networking (REQUIRED - Temporal and stigmer-server on host)
```

**Add acceptance criteria**:
- [ ] Volume mount created at `~/.stigmer/data/workspace`
- [ ] Workspace persists across container restarts
- [ ] Environment variables passed correctly (verify in logs)
- [ ] Image pull shows progress indicator on first run

**Add deliverables**:
- Progress indicator during image pull
- Clear error message if Docker/Podman not found
- Documentation: `client-apps/cli/docs/container-mode.md`

### Task 3: CI/CD Pipeline

**No changes needed** - plan is solid.

**Note**: This task can run in parallel with Task 2 after Task 1 completes.

### Task 4: Homebrew Formula

**Clarify version coordination strategy**:

Current CLI embeds binaries via `client-apps/cli/embedded/`. For container mode:

**Recommendation**: Embed only image reference, not full Python codebase.

```go
// version/version.go
package version

const (
    Version = "1.2.3"
    AgentRunnerImageTag = "v1.2.3"
    AgentRunnerImageRepo = "ghcr.io/stigmer/agent-runner"
)

func GetAgentRunnerImage() string {
    return fmt.Sprintf("%s:%s", AgentRunnerImageRepo, AgentRunnerImageTag)
}
```

**Benefits**:
- CLI binary stays small (~10-20MB savings)
- Version coordination via constants
- Easy to override for development: `STIGMER_AGENT_RUNNER_IMAGE=local-dev:latest`

### Task 5: Testing, Documentation, and Cleanup

**Add cleanup tasks**:
- [ ] Remove embedded Python source extraction logic from `embedded/extract.go`
- [ ] Update `embedded/embed.go` to only embed stigmer-server and workflow-runner
- [ ] Remove agent-runner directory from embedded assets
- [ ] Delete `STIGMER_AGENT_RUNNER_SCRIPT` and `STIGMER_AGENT_RUNNER_WORKSPACE` handling
- [ ] Update extraction tests to not expect agent-runner files

**Add documentation tasks**:
- [ ] Document image pull on first run (one-time setup)
- [ ] Document workspace directory purpose and location
- [ ] Document how to inspect container: `docker ps`, `docker logs`
- [ ] Document development workflow: local build → test → push

**Expected binary size reduction**: ~10-20MB (agent-runner Python code removed)

## Additional Risks Identified

### Risk 7: Poetry in Container

**Current**: `run.sh` uses `poetry run python main.py`

**Options**:
- **Option A**: Keep Poetry in container (simpler, +20MB)
- **Option B**: Export to requirements.txt (smaller, more complex build)

**Recommendation**: Start with Poetry (simpler), optimize later if size becomes issue.

### Risk 8: Container Runtime Detection

**Challenge**: Support Docker and Podman across platforms.

**Detection order**:
1. Check `docker` command availability
2. Fall back to `podman` command
3. Clear error if neither found

**Platform considerations**:
- macOS: Docker Desktop (most common)
- Linux: Docker or Podman
- Windows: Docker Desktop (future)

**Error message template**:
```
Error: Container runtime not found

Stigmer requires Docker or Podman to run the agent-runner service.

Install Docker Desktop:
  https://www.docker.com/products/docker-desktop

Or install Podman:
  brew install podman
```

### Risk 9: First-Run Experience

**Challenge**: Image pull on first run can be slow (~100MB download).

**Recommendation**: Add progress indicator.

```go
cliprint.PrintInfo("📦 Downloading agent-runner image (one-time setup)...")
cliprint.PrintInfo("   Image size: ~80MB")
progress := cliprint.NewProgressDisplay()
progress.SetPhase(cliprint.PhaseInstalling, "Pulling image layers")
// Show Docker pull progress
```

**Consider**: Pre-pull image during Brew installation via post-install hook (optional enhancement).

## Timeline Optimization

**Current plan**: 3 weeks sequential

**Optimization opportunity**: Task 3 (CI/CD) can run in parallel with Task 2 (CLI Integration) after Task 1 completes.

**Revised timeline**:
- **Week 1**: Task 1 (Containerization + Local Dev)
- **Week 2**: Tasks 2 & 3 in parallel (CLI Integration + CI/CD)
- **Week 3**: Tasks 4-5 (Brew + Testing/Docs)

**Potential time savings**: 0.5 weeks if resources allow parallel work

## Final Verdict

✅ **APPROVED with enhancements above**

The plan is solid and will deliver a production-ready containerized architecture. The enhancements strengthen:
- Volume mount strategy
- Network configuration clarity
- Image size optimization
- User experience on first run
- CLI binary size reduction

## Next Steps

1. ✅ Create T01_1_review.md (this document)
2. 🔄 Create T01_2_revised_plan.md incorporating enhancements
3. ⏸️ Get approval to proceed
4. ⏸️ Create T01_3_execution.md and begin Task 1

---

**Reviewer Notes**: This review is based on analysis of:
- `backend/services/agent-runner/README.md`
- `backend/services/agent-runner/run.sh`
- `client-apps/cli/internal/cli/daemon/daemon.go`
- Current CLI embedded binary architecture
- Docker best practices for Python applications
