# Next Task: 20260207.03.cli-platform-capabilities

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: CLI Platform Capabilities (Draft Commands)

**Description**: Implement hybrid capabilities bundle model for AI-powered draft commands. Embed baseline capabilities in CLI binary (go:embed) with optional signed updates from registry. Capabilities are system-scoped, not user-visible skills.

**Goal**: Enable `stigmer agent|workflow|skill|mcpserver draft` commands with embedded platform capabilities that power AI-assisted YAML authoring. Implement `stigmer capabilities` command group (status, update, pin, list) for managing capability bundles.

**Tech Stack**: Go (CLI), go:embed, YAML, GitHub Releases

**Components**: 
- CLI commands: `/Users/suresh/scm/github.com/stigmer/stigmer/client-apps/cli`
- Capabilities bundle: `internal/capabilities/` (new)
- Registry integration (GitHub releases)

---

## Research Summary (Deep Research Completed)

**Research Reports**:
- `research.platform-capabilities-draft-implementation/04.report.gpt.md` (Original)
- `research.skill-format-integration-strategy/04.report.gpt.md` (Primary - Self-Bootstrapping)

### Key Findings (Revised)

**Recommended Architecture: Self-Bootstrapping Agent & Skill System**

1. **Two-Plane Design**
   - Control plane: DB-backed registry for skills, agents, versions
   - Runtime plane: Execution engine with tracing, permissions, progressive disclosure

2. **Hybrid Distribution**
   - Embedded seed pack in CLI (`go:embed`) for offline bootstrap
   - DB registry takes precedence when available
   - `stigmer system sync` to bootstrap/update

3. **Progressive Disclosure** (matches Codex/Claude)
   - Level 1: Metadata only (`name`, `description`) - always loaded
   - Level 2: Instructions (`SKILL.md` body) - loaded when skill triggers
   - Level 3: Resources/scripts - loaded on-demand via tools

4. **Skills as Versioned Packages**
   - First-class DB resources (not prompt blobs)
   - Immutable versions with provenance tracking
   - Content-addressed blob storage

5. **Trust Boundaries**
   - AI-generated skills start in DRAFT state
   - Review gates before publishing
   - Permission profiles per invocation

### Bootstrapping Flow
```
Anthropic skill-creator → Import → skill-creator-agent
                                          ↓
                                   Invoke with schemas
                                          ↓
                                   Creates drafter skills
                                          ↓
                                   Create drafter agents
                                          ↓
                                   stigmer draft <resource>
```

### Target Command Structure
```
stigmer system
├── sync       # Bootstrap/sync system pack to DB
└── status     # Show system pack version

stigmer draft agent      # AI-assisted agent YAML creation
stigmer draft workflow   # AI-assisted workflow YAML creation
stigmer draft skill      # AI-assisted skill YAML creation
stigmer draft mcpserver  # AI-assisted MCP server YAML creation

stigmer skill
├── create     # Create skill from SKILL.md package
├── publish    # Promote DRAFT → PUBLISHED
├── eval       # Run skill evaluation suite
└── list       # List skills by scope

stigmer invoke agent <agent-name>  # Invoke agent (for bootstrapping)
```

---

## Essential Files to Review

### 1. Revised Plan (CRITICAL - START HERE)
Read the revised plan based on deep research:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.03.cli-platform-capabilities/tasks/T01_1_revised_plan.md
```

### 2. Deep Research Reports
Primary research report (self-bootstrapping architecture):
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.03.cli-platform-capabilities/research.skill-format-integration-strategy/04.report.gpt.md
```

Original research report (platform capabilities):
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.03.cli-platform-capabilities/research.platform-capabilities-draft-implementation/04.report.gpt.md
```

### 3. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.03.cli-platform-capabilities/checkpoints/
```

### 4. All Tasks
Review all task files:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.03.cli-platform-capabilities/tasks/
```

### 4. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.03.cli-platform-capabilities/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.03.cli-platform-capabilities/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.03.cli-platform-capabilities/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.03.cli-platform-capabilities/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.03.cli-platform-capabilities/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.03.cli-platform-capabilities/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.03.cli-platform-capabilities/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.03.cli-platform-capabilities/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.03.cli-platform-capabilities/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.03.cli-platform-capabilities/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.03.cli-platform-capabilities/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-02-07 13:36
**Current Task**: T01 Phase 0.1 (Skill Data Model)
**Status**: Ready to Execute

**Revised Plan**: `tasks/T01_1_revised_plan.md` (based on deep research)

## Quick Commands

After loading context:
- "Start Phase 0.1" - Begin skill data model implementation
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

## Implementation Order (from Revised Plan)

| Order | Phase | Description |
|-------|-------|-------------|
| 1 | Phase 0.1 | Skill package data model |
| 2 | Phase 0.4 | Execution tracing |
| 3 | Phase 0.2 | Progressive disclosure |
| 4 | Phase 0.3 | Permission profiles |
| 5 | Phase 1 | System pack embedding |
| 6 | Phase 2 | `stigmer system sync` |
| 7 | Phase 3 | Create drafter skills |
| 8 | Phase 4 | Create drafter agents |
| 9 | Phase 5 | Draft commands |
| 10 | Phase 6 | Lifecycle & evals |
| 11 | Phase 7 | Trust boundaries |

---

*This file provides direct paths to all project resources for quick context loading.*
