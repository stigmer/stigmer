# Sub-Project: 20260319.04.sp.env-instance-list-rpcs

## Parent Project

- **Parent**: 20260319.02.agent-picker-personal-env
- **Parent Path**: [../../20260319.02.agent-picker-personal-env/](../../20260319.02.agent-picker-personal-env/)
- **Spawned From Task**: Phase 2 preparation

---

## Overview
Add label-based list RPCs for environments, agent instances, and other resource types that currently lack list/query capabilities. Enables personal resource lookup via labels instead of deterministic slug conventions, establishing a reusable pattern for all resource kinds.

**Created**: 2026-03-19
**Status**: Active

## Sub-Project Information

### Goal
1) Add list RPC with label filtering to EnvironmentQueryController. 2) Add list RPC with label filtering to AgentInstanceQueryController. 3) Implement Go backend handlers (OSS). 4) Implement Java backend handlers with FGA visibility (cloud). 5) Update SDK codegen schemas and regenerate TypeScript clients. 6) Establish a reusable pattern for adding label-based list RPCs to other resource types.

### Technology Stack
TypeScript/React, Go (backend env merge), Protobuf, OpenFGA

### Project Type
Feature Development

### Affected Components
sdk/react (AgentPicker, useAgentSearch, SessionComposer), sdk/typescript (useCreateSession), backend/libs/go/envmerge (env_spec filtering), client-apps/web (SessionLauncher), FGA model (labels)

### Additional Context
Cross-repo work: proto definitions and SDK in stigmer OSS, backend handlers in both stigmer OSS (Go) and stigmer-cloud (Java). Current state: Environment has only get/getByReference/getSecretValue RPCs (no list). AgentInstance has get/getByAgent/getByReference (no label filtering). SearchService indexes agents, skills, mcp_servers, workflows — but NOT environments or agent instances. Labels exist on resources (metadata.labels) but are never used as query filters. Slug uniqueness is per (org, kind) which prevents multiple users from having the same slug. This sub-project unblocks Phase 2 personal environment orchestration by providing a proper lookup mechanism.

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
- [Parent Project](../../20260319.02.agent-picker-personal-env/)
- [Checkpoints](checkpoints/)
- [Design Decisions](design-decisions/)
