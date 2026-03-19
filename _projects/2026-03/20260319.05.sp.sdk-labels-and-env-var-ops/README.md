# Sub-Project: 20260319.05.sp.sdk-labels-and-env-var-ops

## Parent Project

- **Parent**: 20260319.02.agent-picker-personal-env
- **Parent Path**: [../../20260319.02.agent-picker-personal-env/](../../20260319.02.agent-picker-personal-env/)
- **Spawned From Task**: Phase 2 preparation

---

## Overview
Add labels support to all SDK resource input types (codegen fix) and add incremental environment variable management RPCs (updateVariables, removeVariables) with backend sentinel defense-in-depth.

**Created**: 2026-03-19
**Status**: Active

## Sub-Project Information

### Goal
1) Add optional labels field to ALL SDK resource input types and wire into build*Proto functions. 2) Add updateVariables proto RPC to EnvironmentCommandController (server-side merge of new/changed vars). 3) Add removeVariables proto RPC to EnvironmentCommandController (remove specific keys). 4) Implement Go OSS handlers for both new RPCs. 5) Implement Java Cloud handlers for both new RPCs (with encryption awareness). 6) Add backend sentinel defense-in-depth: update handlers preserve existing secret values when redaction marker is sent back. 7) Add SDK TypeScript client methods + React hooks for the new RPCs.

### Technology Stack
TypeScript/React, Go (backend env merge), Protobuf, OpenFGA

### Project Type
Feature Development

### Affected Components
sdk/react (AgentPicker, useAgentSearch, SessionComposer), sdk/typescript (useCreateSession), backend/libs/go/envmerge (env_spec filtering), client-apps/web (SessionLauncher), FGA model (labels)

### Additional Context
Cross-repo work: proto definitions and SDK in stigmer OSS, backend handlers in both stigmer OSS (Go) and stigmer-cloud (Java). Key discovery: EnvironmentInput and AgentInstanceInput have no labels field — buildEnvironmentProto/buildAgentInstanceProto only set metadata.name and metadata.org. Backend does NOT treat redaction sentinel as keep-existing during updates — EncryptSecretValues encrypts the literal ***REDACTED*** string, destroying real secrets on read-modify-write. The new updateVariables/removeVariables RPCs perform server-side merge where unredacted values are accessible, avoiding the problem entirely.

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
