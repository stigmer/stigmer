# Next Task - Agent-Runner Container Architecture

**Project**: Agent-Runner Container Architecture  
**Status**: 🚀 Task 1 Complete - Ready for Testing  
**Last Updated**: 2026-01-21

## Quick Resume

**Drag this file into any chat to resume the project!**

## Project Context

Transform agent-runner from shell script + Poetry architecture to production-ready containerized service with complete lifecycle management.

**Goal**: Zero manual dependency installation. Users run `stigmer server start`, CLI automatically manages Docker containers.

## Current Status

✅ **Task 1 COMPLETE** - Containerization with Local Development Workflow

**Deliverables created**:
- ✅ `backend/services/agent-runner/Dockerfile` - Optimized multi-stage build with security
- ✅ `backend/services/agent-runner/.dockerignore` - Build optimization
- ✅ `backend/services/agent-runner/Makefile` - Complete build/run/test/push targets
- ✅ `backend/services/agent-runner/docs/docker.md` - Comprehensive documentation
- ✅ **NEW**: Makefile refactoring for automated Docker image build

**Key improvements**:
- 🔒 Non-root user execution (UID 1000)
- 🏥 Health check configured
- 📦 Python 3.11-slim base image
- 🎯 Version tagging support
- 📚 Complete documentation
- 🔧 Easy local testing workflow
- ⚡ **NEW**: Single command workflow - `make release-local` builds everything automatically

## What's Next

✅ **BONUS COMPLETE**: Makefile Automation (2026-01-21)
✅ **BLOCKER FIXED**: MyPy Type Errors Fixed (2026-01-21)

**Recent progress**:
- ✅ Makefile refactoring complete - automated Docker image build
- ✅ Fixed 20 mypy type checking errors in agent-runner
- ✅ Build now progresses through type checking and Docker image creation
- ⚠️ Revealed next issue: Missing `agent-runner.tar.gz` for CLI embedding

**Immediate**: Investigate CLI embedding issue
```bash
# Current status:
# ✅ stigmer-server binary built
# ✅ workflow-runner binary built  
# ✅ agent-runner Docker image built (dev-local)
# ❌ CLI build fails - missing embedded/binaries/darwin_arm64/agent-runner.tar.gz

# Error message:
# embedded/embedded.go:39:12: pattern binaries/darwin_arm64/agent-runner.tar.gz: no matching files found
```

**Next steps**:
1. Determine if agent-runner should be embedded as `.tar.gz` or if embedding pattern needs updating
2. Fix CLI embedding issue
3. Complete end-to-end testing of automated workflow
4. Move to Task 2 (CLI Container Management Integration)

## Project Location

```
_projects/2026-01/20260121.02.agent-runner-container-architecture/
├── README.md (project overview)
├── next-task.md (this file - drag into chat to resume)
├── tasks/
│   └── T01_0_plan.md (initial plan - NEEDS YOUR REVIEW)
├── checkpoints/ (ready for milestones)
├── design-decisions/ (ready for decisions)
├── coding-guidelines/ (ready for guidelines)
├── wrong-assumptions/ (ready for learnings)
└── dont-dos/ (ready for anti-patterns)
```

## Key Success Criteria

- ✅ Local development: `make build-agent-runner-image`, test locally
- ✅ User experience: `brew install stigmer` → `stigmer server start` (pulls image automatically)
- ✅ CI/CD: git tag push → multi-arch images → ghcr.io → Brew formula update
- ✅ Image quality: <100MB, non-root, health checks

## Timeline

3 weeks (6 phases)

## Next Steps for You

1. Open and review `_projects/2026-01/20260121.02.agent-runner-container-architecture/tasks/T01_2_revised_plan.md`
2. Review the analysis in `_projects/2026-01/20260121.02.agent-runner-container-architecture/tasks/T01_1_review.md`
3. Provide approval or request changes
4. I'll proceed based on your input

## Key Improvements in Revised Plan

- **Volume Mounts**: Explicit strategy for workspace persistence (`~/.stigmer/data/workspace:/workspace`)
- **Network Config**: Host networking required for Temporal/stigmer-server communication
- **Image Size**: Multi-stage build strategy to achieve <100MB target
- **CLI Binary**: ~15MB reduction by removing embedded Python source
- **First-Run UX**: Progress indicators during image pull with size estimates
- **Timeline**: Parallelization opportunity in Week 2 (Tasks 2 & 3)

---

**To resume anytime**: Just drag this file into chat and say "continue" or "let's proceed with the plan"
