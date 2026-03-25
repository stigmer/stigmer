# Sub-Project: 20260325.02.sp.on-behalf-of-grpc-channel

## Parent Project

- **Parent**: 20260325.01.auto-personal-org
- **Parent Path**: [../../20260325.01.auto-personal-org/](../../20260325.01.auto-personal-org/)
- **Spawned From Task**: Task 2

---

## Overview
Build gRPC on-behalf-of infrastructure for in-process calls, enabling the system (machine account) to create resources attributed to a specific user identity. Solves the FGA ownership problem when system-created resources (personal orgs, execution contexts, default agent instances) get incorrectly owned by the machine account instead of the actual user.

**Created**: 2026-03-25
**Status**: Active

## Sub-Project Information

### Goal
Create OnBehalfOfClientInterceptor, ImpersonatedChannelFactory, and server-side interceptor changes so that downstream gRPC clients can create resources with correct FGA ownership attribution to the actual user instead of the machine account.

### Technology Stack
Proto/Buf, Go/gRPC (server), TypeScript/React (web console, SDK)

### Project Type
⚡ **Quick Project** - Designed to complete in 1-2 sessions with minimal overhead.

### Affected Components
Organization protos, IdentityAccount provisioning handler (stigmer-cloud), web console OrgGate/OrgSwitcher, SDK react org components

### Additional Context
This sub-project was discovered during planning for personal org auto-creation. The core problem: when creating an Organization via inProcessChannelAsSystem, CreateAuthorizationTuplesStepV2 uses the machine account as the caller, making it the FGA owner. The on-behalf-of pattern (industry standard: Kubernetes Impersonate-User, AWS STS AssumeRole, Microsoft OBO) lets the machine account assert 'create this as user X' via gRPC metadata. This also fixes execution context ownership (currently all owned by admin/machine account) and provides reusable infrastructure for any future system-acts-on-behalf-of-user scenario.

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
- [Parent Project](../../20260325.01.auto-personal-org/)
- [Checkpoints](checkpoints/)
- [Design Decisions](design-decisions/)
