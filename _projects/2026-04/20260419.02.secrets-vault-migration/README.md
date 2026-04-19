# Project: 20260419.02.secrets-vault-migration

## Overview
Replace Stigmer's DB-stored secrets (AES-256-GCM with static key in MongoDB) with OpenBAO (Vault)-backed secrets management using envelope encryption, per-org Transit keys, and just-in-time secret resolution for agent/workflow execution.

**Created**: 2026-04-19
**Status**: Active 🟢

## Project Information

### Primary Goal
Deliver production-ready secrets management with: (1) OpenBAO infrastructure, (2) envelope encryption with per-org KEK via Transit, (3) secret values out of MongoDB into vault, (4) JIT resolution so runners fetch secrets on demand from vault, (5) vault-native audit trail for all secret access.

### Timeline
**Target Completion**: 4-6 weeks

### Technology Stack
Java/Spring Boot, Protobuf, OpenBAO (Vault-compatible), Spring Vault, MongoDB, Bazel, OpenFGA

### Project Type
Feature Development

### Affected Components
stigmer-cloud/backend/libs/java/infra/encryption, stigmer-cloud/backend/services/stigmer-service (environment, executioncontext, oauthapp, mcpserver domains), stigmer/apis (executioncontext, environment, oauthapp protos), stigmer-cloud/_ops (OpenBAO infrastructure), stigmer-cloud/backend/services/stigmer-service/src/main/resources/fga (authorization model)

## Project Context

### Dependencies
Planton vault-commons library (PlatformVaultClient), Planton secrets-commons library (EnvelopeEncryptionService), KubernetesOpenBao deployment component, existing Planton OpenBAO infrastructure patterns

### Success Criteria
- Secrets never stored in MongoDB (only vault references); Envelope encryption with per-org Transit keys; Secret retrieval p95 < 100ms; Every secret read logged in vault audit trail; Backward-compatible proto changes (enc:v1 still decryptable); OAuthApp client_secret in vault; Runner resolves secrets JIT from vault; Self-hosted enterprise edition documented as roadmap answer for paranoid enterprises

### Known Risks & Mitigations
OpenBAO operational complexity; Migration of existing enc:v1 secrets (lazy re-encryption); Runner latency increase from vault reads; Spring Vault library compatibility with OpenBAO

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