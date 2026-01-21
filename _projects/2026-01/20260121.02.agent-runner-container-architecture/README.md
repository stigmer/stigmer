# Agent-Runner Container Architecture

**Created**: 2026-01-21  
**Status**: ⛔ OBSOLETE - Wrong Architectural Direction  
**Type**: Multi-day Project (3 weeks)  
**Project Path**: `_projects/2026-01/20260121.02.agent-runner-container-architecture/`

---

## ⚠️ PROJECT OBSOLETE - DO NOT PROCEED

**Reason**: This Docker-based approach was the wrong architectural direction.

**Better Solution**: PyInstaller standalone binary approach (like Temporal CLI)
- See: `_projects/2026-01/20260121.03.agent-runner-standalone-binary/`
- See: `_cursor/adr-use-python-binary.md`

**Key Insight**: We don't need to manage containers or Python environments. We need to manage **binaries**, following Temporal's pattern: "Download binary → Run".

**Superseded By**: Project `20260121.03.agent-runner-standalone-binary`

---

## Original Plan (For Historical Reference)

## Overview

Transform agent-runner from shell script + Poetry architecture to production-ready containerized service. Publish to GitHub Container Registry (ghcr.io), integrate container management into stigmer CLI, and follow industry standards for modern dev tools.

## Problem Statement

**Current architecture** (brittle):
```
stigmer-server:    Go binary (self-contained) ✅
workflow-runner:   Go binary (self-contained) ✅
agent-runner:      Shell script → Poetry → Python ❌
```

**Dependencies** (all must be present on user machine):
- bash/zsh shell
- Python 3.x
- Poetry
- Network access for `poetry install`
- All transitive Python dependencies

**Failure modes**:
- User doesn't have Python
- User has wrong Python version
- User doesn't have Poetry or it's not in PATH
- `poetry install` fails (network issues, conflicting dependencies)
- Platform-specific issues

## Goal

Achieve zero manual dependency installation by containerizing agent-runner with complete lifecycle management:

1. **Local development** - Build and test images locally without GitHub
2. **Brew installation** - Seamless user experience with zero setup
3. **CI/CD automation** - Automatic publishing on releases
4. **Manual publishing** - When developers need to push manually

Users run `stigmer server start`, CLI automatically pulls and manages Docker container. Clean, professional, industry-standard architecture.

## Timeline

**3 weeks** (6 phases)

## Technology Stack

- **Docker** - Containerization
- **GitHub Actions** - CI/CD for image publishing
- **GitHub Container Registry (ghcr.io)** - Image hosting
- **Go** - CLI integration for container management
- **Python/Poetry** - agent-runner implementation (unchanged)
- **Bazel** - Build system
- **Makefile** - Build orchestration

## Project Type

**Refactoring/Migration** - Architectural transformation

## Affected Components

1. **backend/services/agent-runner/** - Add Dockerfile, multi-stage builds, optimize for containers
2. **.github/workflows/** - Add CI/CD for image publishing
3. **client-apps/cli/** - Container detection, pull, lifecycle management
4. **Build system** - Update Makefiles for container builds
5. **Homebrew formula** - Version pinning, image tag coordination
6. **Documentation** - Developer guide, user guide, troubleshooting

## Success Criteria

### Developer Experience
- ✅ `make build-agent-runner-image` - Build Docker image locally with version tag
- ✅ `make run-agent-runner-local` - Run local image for testing
- ✅ `make push-agent-runner-image` - Manual push to ghcr.io (with auth)
- ✅ CLI detects local images first, falls back to ghcr.io pull
- ✅ Development workflow unchanged (poetry for local Python dev)
- ✅ Can test entire flow locally without GitHub push

### User Experience (Brew Install)
- ✅ `brew install stigmer` installs CLI with embedded version info
- ✅ First `stigmer server start` pulls correct image version automatically
- ✅ Subsequent starts use cached image (fast)
- ✅ `stigmer server update` pulls latest image
- ✅ Zero manual Docker commands, zero configuration

### CI/CD Automation
- ✅ Push git tag → GitHub Actions builds multi-arch images → Push to ghcr.io
- ✅ Semantic versioning (tags: latest, v1.2.3, v1.2, v1)
- ✅ Automated Brew formula update on release
- ✅ Multi-arch support (amd64, arm64)

### Image Quality
- ✅ Multi-stage builds (optimized size <100MB if possible)
- ✅ Non-root user (security best practice)
- ✅ Health checks built-in
- ✅ Proper labels and metadata

### Integration
- ✅ `stigmer server logs --all` shows agent-runner container logs
- ✅ `stigmer server stop` properly cleans up containers
- ✅ Container networking works with Temporal, stigmer-server

## Key Workflows

### Workflow 1: Developer Building Locally
```bash
cd backend/services/agent-runner
make build-image VERSION=dev-$(whoami)
# Builds: ghcr.io/stigmer/agent-runner:dev-username

# Test locally
stigmer server start --use-local-image
# CLI uses local image instead of pulling
```

### Workflow 2: Manual Release Push
```bash
# Authenticate
make docker-login

# Build and push specific version
make push-image VERSION=1.2.3
# Builds and pushes multi-arch images with tags: 1.2.3, 1.2, 1, latest
```

### Workflow 3: Automated Release (CI/CD)
```bash
# Developer creates release
git tag v1.2.3
git push origin v1.2.3

# GitHub Actions automatically:
# 1. Builds multi-arch images
# 2. Pushes to ghcr.io/stigmer/agent-runner:1.2.3
# 3. Updates Brew formula with new version
```

### Workflow 4: User Installation
```bash
# User installs from Brew
brew install stigmer

# First run
stigmer server start
# CLI: "Pulling agent-runner:1.2.3..."
# CLI: "Starting agent-runner container..."
# CLI: "✓ All services running"

# Subsequent runs (fast, uses cached image)
stigmer server start
# CLI: "✓ All services running"
```

## Risks and Mitigations

### Risk 1: First-time Docker registry setup
**Risk**: Need GitHub Actions secrets configured properly

**Mitigation**: 
- Follow GitHub's official GHCR documentation
- Use GITHUB_TOKEN (automatic)
- Test with manual push first

### Risk 2: Container networking
**Risk**: Need proper host networking for Temporal communication

**Mitigation**:
- Test networking configuration thoroughly
- Support localhost, bridge, host modes
- Document network requirements

### Risk 3: Cross-platform compatibility
**Risk**: Docker Desktop (Mac), Podman (Linux) differences

**Mitigation**:
- Abstract container runtime (detect Docker vs Podman)
- Use compatible commands across both
- Test on all target platforms

### Risk 4: Image size
**Risk**: Python containers can be large (>200MB)

**Mitigation**:
- Multi-stage builds
- Slim base images (python:3.11-slim)
- .dockerignore for build context
- Target <100MB if possible

## Implementation Phases

### Phase 1: Containerize Agent-Runner (Week 1)
- Multi-stage Dockerfile with optimization
- Local build targets in Makefile
- Health checks and non-root user
- Version tagging strategy

### Phase 2: Local Development Workflow (Week 1)
- Make targets for build, run, test
- Local image detection in CLI
- Docker/Podman abstraction layer

### Phase 3: CLI Container Management (Week 2)
- Container runtime detection
- Image pull logic (with version pinning)
- Container lifecycle (start, stop, logs, cleanup)
- Local vs remote image preference

### Phase 4: GitHub Actions CI/CD (Week 2)
- Build multi-arch images (amd64, arm64)
- Publish to ghcr.io with proper tagging
- Secrets setup and testing

### Phase 5: Brew Integration (Week 3)
- Update Brew formula with version pinning
- Coordinate CLI version with container version
- Test installation flow end-to-end

### Phase 6: Testing & Documentation (Week 3)
- Test all workflows end-to-end
- Developer guide (building, testing, releasing)
- User guide (installation, usage)
- Troubleshooting guide

## Related Work

- Original architecture proposal: `_cursor/agent-runner-architecture-proposal.md`
- Previous project (embedded binaries): `_projects/2026-01/20260121.01.cli-embedded-binary-packaging/`

## Notes

See `tasks/` for detailed task breakdown and tracking.
See `design-decisions/` for architectural decisions.
See `coding-guidelines/` for implementation standards.
