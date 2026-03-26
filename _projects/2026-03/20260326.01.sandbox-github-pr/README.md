# Project: 20260326.01.sandbox-github-pr

## Overview
Enable Stigmer agents to push code changes and create GitHub PRs from within the Daytona sandbox by persisting git credentials past the provisioning phase, adding a platform-provided create_pr tool, and gating push operations with HITL approval — all without exposing the token to the LLM context or MCP placeholder resolution.

**Created**: 2026-03-26
**Status**: Active 🟢

## Project Information

### Primary Goal
Allow agents working on git_repo workspaces to commit changes, push branches, and create GitHub pull requests autonomously (with HITL gating), using the GITHUB_TOKEN from the user's personal environment — without the LLM ever seeing the credential.

### Timeline
**Target Completion**: Flexible / no hard deadline

### Technology Stack
Python (agent-runner, Graphton), Go (stigmer-server), Java (stigmer-service), Protobuf, Daytona SDK

### Project Type
Feature Development

### Affected Components
agent-runner (workspace provisioning, execute_graphton, Graphton backends), stigmer-server (CreateExecutionContextStep), stigmer-service (CreateExecutionContextStep Java), Graphton library (platform tools, prompt enhancement, sandbox backends), Daytona sandbox image

## Project Context

### Dependencies
- Recent GITHUB_TOKEN personal environment injection fix (2026-03-26)
- Daytona SDK sandbox.process.exec API
- Existing HITL tool approval policy system
- **BLOCKER:** Daytona volume mount filesystem must support git I/O operations (currently failing with ENOSYS on `.git/config` write — see `_cursor/error.md`)

### Success Criteria
1. Agent can git push to a new branch in a private GitHub repo from the sandbox
2. Agent can create a GitHub PR via a platform-provided `create_pull_request` tool
3. GITHUB_TOKEN never appears in LLM system prompt, message context, or MCP placeholder resolution
4. Push/PR operations are gated by HITL approval
5. PR URL is captured as an execution artifact visible in the execution viewer

### Known Risks & Mitigations
1. Credential file on disk is readable by the LLM's `read` tool — mitigated by sandbox isolation boundary and optional path deny-list
2. Platform `create_pull_request` tool design must not couple to GitHub API specifics if we extend to GitLab/Bitbucket later — mitigated by generic tool interface with provider-specific implementation
3. HITL approval granularity — the `create_pull_request` platform tool naturally fits the existing tool-level approval model (unlike gating specific commands within `execute`)
4. Agent may create poor-quality PRs — mitigated by HITL approval gate showing diff, title, and branch before allowing push

## Project Structure

This project follows the **Next Project Framework** for structured multi-day development:

- **`tasks/`** - Detailed task planning and execution logs (update freely)
- **`checkpoints/`** - Major milestone summaries (⚠️ ASK before creating)
- **`design-decisions/`** - Significant architectural choices (⚠️ ASK before creating)
- **`coding-guidelines/`** - Project-wide code standards (⚠️ ASK before creating)
- **`wrong-assumptions/`** - Important misconceptions (⚠️ ASK before creating)
- **`dont-dos/`** - Critical anti-patterns (⚠️ ASK before creating)

**📌 IMPORTANT**: Knowledge folders require developer permission. See [coding-guidelines/documentation-discipline.md](coding-guidelines/documentation-discipline.md)

## Current Status

### Active Task
See [tasks/](tasks/) for the current task being worked on.

### Latest Checkpoint
See [checkpoints/](checkpoints/) for the most recent project state.

### Progress Tracking
- [x] Project initialized
- [ ] Initial analysis complete
- [ ] Core implementation
- [ ] Testing and validation
- [ ] Documentation finalized
- [ ] Project completed

## How to Resume Work

**Quick Resume**: Simply drag and drop the `next-task.md` file into your AI conversation.

The `next-task.md` file contains:
- Direct paths to all project folders
- Current status information
- Resume checklist
- Quick commands

## Quick Links

- [Next Task](next-task.md) - **Drag this into chat to resume**
- [Current Task](tasks/)
- [Latest Checkpoint](checkpoints/)
- [Design Decisions](design-decisions/)
- [Coding Guidelines](coding-guidelines/)

## Documentation Discipline

**CRITICAL**: AI assistants must ASK for permission before creating:
- Checkpoints
- Design decisions
- Guidelines
- Wrong assumptions
- Don't dos

Only task logs (T##_1_feedback.md, T##_2_execution.md) can be updated without permission.

## Notes

_Add any additional notes, links, or context here as the project evolves._