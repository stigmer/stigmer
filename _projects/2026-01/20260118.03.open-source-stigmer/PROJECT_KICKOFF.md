# Project Kickoff: Open Source Stigmer

**Date**: January 18, 2026
**Project**: 20260118.03.open-source-stigmer
**Status**: Planning Phase - Awaiting Review

## Vision

Transform Stigmer from a proprietary platform into an **Open Core** architecture where:

- ✅ **Open Source** (Apache 2.0): CLI, Runners, SDK, Local Backend
- 🔒 **Proprietary**: Cloud Service, Auth/Governance, Web Console

This enables developers to use Stigmer locally with **zero infrastructure** (SQLite-based) while providing an upgrade path to the commercial cloud offering.

## Key Architecture Innovation

**Backend Abstraction Layer** - Defined via Protocol Buffers to ensure strict parity between:

1. **Local Backend** (SQLite) - For individual developers, testing, CI/CD
2. **Cloud Backend** (gRPC to Stigmer Service) - For production, teams, enterprise features

Both backends implement the same Protobuf interface, guaranteeing feature parity and preventing drift between Go (CLI/Workflow) and Python (Agent) components.

## Two-Tier Local Experience

### Tier 1: "Stigmer Lite" (Default)
```bash
stigmer agent execute my-agent "hello"
```
- No infrastructure required
- Embedded SQLite
- Perfect for rapid iteration and testing

### Tier 2: "Full Stack" (Advanced)
```bash
stigmer local start
```
- Docker Compose with Temporal + MongoDB
- Full production-like environment
- For testing complex workflows

## Project Phases

### Phase 1: Foundation & Architecture (Current - T01)
**Duration**: 2-3 weeks
**Focus**: Design, planning, repository setup

- Set up `stigmer/stigmer` repository
- Define Protobuf backend interface
- Create migration strategy
- Design SQLite backend
- Document architecture

**Deliverables**:
- Working repository structure
- Complete Protobuf API definition
- Architecture documentation
- Migration blueprint

### Phase 2: Backend Implementation (T02-T03)
**Duration**: 3-4 weeks
**Focus**: Build the abstraction layer

- Implement Protobuf codegen
- Build SQLite backend
- Build Cloud backend wrapper
- Implement JIT secret resolution

### Phase 3: Code Migration (T04-T06)
**Duration**: 4-6 weeks
**Focus**: Move code from leftbin/* to stigmer/stigmer

- Migrate CLI
- Migrate SDK (Go + Python)
- Migrate Runners
- Update import paths
- Add Apache 2.0 licenses

### Phase 4: Testing & Documentation (T07-T08)
**Duration**: 2-3 weeks
**Focus**: Ensure quality and usability

- Comprehensive testing
- Example projects
- Getting started guides
- API documentation

### Phase 5: Launch (T09)
**Duration**: 1 week
**Focus**: Public release

- Announce open source
- Release v1.0.0
- Community setup (Discord, GitHub Discussions)

## Repository Structure

```
stigmer/stigmer/                    # New open source repo
├── cmd/stigmer/                   # CLI entry point
├── sdk/
│   ├── go/                        # Go SDK
│   └── python/                    # Python SDK
├── runners/
│   ├── workflow/                  # Workflow Runner (Go)
│   └── agent/                     # Agent Runner (Python)
├── internal/backend/
│   ├── local/                     # SQLite implementation
│   └── cloud/                     # gRPC client wrapper
├── proto/stigmer/backend/v1/      # Backend interface definitions
└── docs/                          # Comprehensive documentation

leftbin/stigmer/                   # Existing proprietary repo
├── services/api/                  # STAYS PRIVATE
├── services/auth/                 # STAYS PRIVATE
└── web-console/                   # STAYS PRIVATE
```

## Key Technical Decisions

### 1. Protobuf for Backend Interface
**Why**: Ensures Go and Python never drift apart, enables multiple backend implementations

### 2. SQLite for Local Mode
**Why**: Zero infrastructure, no Docker required for basic usage, sufficient for local development

### 3. JIT (Just-In-Time) Secret Resolution
**Why**: Secrets never pass through workflow engine, decrypted only at execution time in runner memory

### 4. Open Core Model
**Why**: Build developer trust with open execution layer, monetize with cloud platform and enterprise features

## Success Metrics

### Developer Experience
- [ ] New user can run their first agent in < 5 minutes
- [ ] Zero infrastructure required for local development
- [ ] Seamless upgrade path from local to cloud

### Security
- [ ] Secrets encrypted at rest (local and cloud)
- [ ] JIT resolution prevents secret leakage
- [ ] Open source allows security audits

### Community
- [ ] Apache 2.0 license attracts contributors
- [ ] Clear contribution guidelines
- [ ] Active community support

### Business
- [ ] Open source drives adoption
- [ ] Cloud offering provides monetization
- [ ] Enterprise features (SSO, RBAC) remain competitive differentiators

## Reference Documents

- **Architecture**: [references/gemini-architecture-final.md](references/gemini-architecture-final.md)
- **Current Task Plan**: [tasks/T01_0_plan.md](tasks/T01_0_plan.md)
- **Project README**: [README.md](README.md)

## Current Status

**Phase**: Planning
**Task**: T01 (Foundation & Architecture)
**Status**: ⚠️ Awaiting developer review of task plan

## Next Steps

1. **Review** the detailed task plan in `tasks/T01_0_plan.md`
2. **Provide feedback** on the proposed approach
3. **Approve** to begin Phase 1 execution

## Notes

- No current users means we have complete freedom to refactor
- Architecture is based on extensive Gemini conversation (final design v2.0)
- Focus on getting foundation right before rushing to code
- This is a multi-month project - quality over speed

---

*"The best time to plant a tree was 20 years ago. The second best time is now."*

Let's build something the open source community will love. 🚀
