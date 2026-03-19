# Sub-Project: 20260319.03.sp.env-auth-and-secret-redaction

## Parent Project

- **Parent**: 20260319.02.agent-picker-personal-env
- **Parent Path**: [../../20260319.02.agent-picker-personal-env/](../../20260319.02.agent-picker-personal-env/)
- **Spawned From Task**: Phase 2 preparation

---

## Overview
Update FGA authorization model to support personal environments (member-level creation permissions) and implement secret value redaction in environment queries with owner-only secret retrieval.

**Created**: 2026-03-19
**Status**: Active

## Sub-Project Information

### Goal
1) Allow regular org members to create environments and agent instances (FGA can_create_* to member). 2) Add secret redaction to environment get/getByReference RPCs (admins see keys but not values). 3) Add a new owner-only RPC for retrieving unredacted secret values. 4) Add can_read_secrets permission to the FGA model.

### Technology Stack
TypeScript/React, Go (backend env merge), Protobuf, OpenFGA

### Project Type
Feature Development

### Affected Components
sdk/react (AgentPicker, useAgentSearch, SessionComposer), sdk/typescript (useCreateSession), backend/libs/go/envmerge (env_spec filtering), client-apps/web (SessionLauncher), FGA model (labels)

### Additional Context
Cross-repo work: FGA model and backend handlers in stigmer-cloud, proto definitions in stigmer OSS. Key files: stigmer-cloud/.../fga/model/agentic/environment.fga, stigmer-cloud/.../fga/model/tenancy/organization.fga, stigmer/apis/.../environment/v1/query.proto

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
