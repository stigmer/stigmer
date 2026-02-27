# Sub-Project: 20260228.01.sp.platform-file-isolation

## Parent Project

- **Parent**: 20260227.02.workspace-provisioning
- **Parent Path**: [../../20260227.02.workspace-provisioning/](../../20260227.02.workspace-provisioning/)
- **Spawned From Task**: T04

---

## Overview
Design and implement a session-root architecture where platform files (skills, inputs) are physically isolated outside the workspace root directory, with a managed symlink bridge for agent access. This ensures no workspace source type (git_repo, local_path, empty) has platform files polluting the user's project.

**Created**: 2026-02-28
**Status**: Active

## Sub-Project Information

### Goal
Physically isolate all platform files (bin/skills/, .stigmer-inputs/) outside the workspace root using a session-root directory structure with a .stigmer symlink bridge, so that the agent retains full tool and shell access to platform files while the user's project directory remains clean across all workspace source types.

### Technology Stack
Python (agent-runner, graphton), Protobuf (APIs), Go (CLI/server)

### Project Type
Feature Development

### Affected Components
apis/protos (session, agentexecution), backend/services/agent-runner (workspace provisioner, sandbox_manager, execute_graphton, prompt_enhancement), backend/libs/graphton (FilesystemBackend), client-apps/cli

### Additional Context
Architectural analysis completed. Recommended approach: Session Root with Symlink Bridge. Platform files live in session_root/.stigmer/ (sibling to workspace/). A managed .stigmer symlink inside the workspace provides transparent access. Key changes: (1) traversal guard moves from Path.resolve() to os.path.normpath() for logical containment checking, (2) initialize_workspace() creates session_root layout, (3) SkillWriter and inject_attachments write to .stigmer/skills/ and .stigmer/inputs/, (4) provisioner manages symlink lifecycle per source type. Five alternative approaches (A-E) were evaluated and rejected with documented rationale.

## Project Structure

This sub-project follows the **Next Project Framework** for structured multi-day development:

- **`tasks/`** - Detailed task planning and execution logs (update freely)
- **`checkpoints/`** - Major milestone summaries (ASK before creating)
- **`design-decisions/`** - Significant architectural choices (ASK before creating)
- **`coding-guidelines/`** - Project-wide code standards (ASK before creating)
- **`wrong-assumptions/`** - Important misconceptions (ASK before creating)
- **`dont-dos/`** - Critical anti-patterns (ASK before creating)

**Note**: Also check the parent project's knowledge folders for inherited context.

## Current Status

### Active Task
See [tasks/](tasks/) for the current task being worked on.

### Progress Tracking
- [x] Sub-project initialized
- [ ] Initial analysis complete
- [ ] Core implementation
- [ ] Testing and validation
- [ ] Sub-project completed

## How to Resume Work

**Quick Resume**: Simply drag and drop the `next-task.md` file into your AI conversation.

## Quick Links

- [Next Task](next-task.md) - **Drag this into chat to resume**
- [Current Task](tasks/)
- [Parent Project](../../20260227.02.workspace-provisioning/)
- [Checkpoints](checkpoints/)
- [Design Decisions](design-decisions/)
