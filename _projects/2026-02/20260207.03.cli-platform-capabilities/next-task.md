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

**Full Report**: `research.platform-capabilities-draft-implementation/04.report.gpt.md`

### Key Findings

**Recommended Architecture: Hybrid Capabilities Bundle Model**

1. **Embed baseline bundle in CLI** via `go:embed` (~100KB)
   - Works offline with zero config
   - Version-locked to CLI release
   - Bootstrap path for first-run

2. **Allow optional signed updates** from registry (GitHub releases)
   - Explicit update command (no auto-updates)
   - Version compatibility metadata
   - Signed bundles for security

3. **System scope separation**
   - Capabilities are NOT user-visible skills
   - `stigmer skill list` shows user skills only
   - `stigmer capabilities list` shows platform capabilities

### Industry References
- **GitHub Copilot CLI**: Built-in defaults + user/repo scoped extensibility
- **OpenAI Codex Skills**: System skills + installable skills, multi-scope loading
- **Kiro CLI**: Prompts managed via commands, migration/backward compatibility
- **Terraform**: Offline mirrors, caching, explicit update commands

### Target Command Structure
```
stigmer capabilities
├── status     # Show installed versions, compatibility
├── update     # Fetch and install latest compatible bundle
├── list       # List available capabilities (system-only)
├── pin        # Pin to specific version
└── unpin      # Remove version pin

stigmer agent draft      # AI-assisted agent YAML creation
stigmer workflow draft   # AI-assisted workflow YAML creation
stigmer skill draft      # AI-assisted skill YAML creation
stigmer mcpserver draft  # AI-assisted MCP server YAML creation
```

---

## Essential Files to Review

### 1. Deep Research Report (CRITICAL)
Read the research report for architectural decisions:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.03.cli-platform-capabilities/research.platform-capabilities-draft-implementation/04.report.gpt.md
```

### 2. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260207.03.cli-platform-capabilities/checkpoints/
```

### 3. Current Task
Review the current task status and plan:
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
**Current Task**: T01 (Initial Setup)
**Status**: Planning

## Quick Commands

After loading context:
- "Continue with T01" - Resume the current task
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
