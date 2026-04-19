# Project: 20260419.01.platform-java-libs-extraction

## Overview
Refactor Stigmer Cloud's shared Java backend libraries (grpc-request pipeline, api-state, api-authentication, api-authorization, api-shape) to be proto-agnostic and publish them as Maven artifacts. This enables reuse across multiple products (Scenar Cloud, future platforms) without forking.

**Created**: 2026-04-19
**Status**: Active 🟢

## Project Information

### Primary Goal
Make the core Java backend infrastructure (request pipeline, repository layer, auth framework, authorization framework) independent of any specific product's protobuf types. Replace concrete ApiResourceKind enum with String-based kind registry, replace concrete ApiResourceMetadata casts with reflection-based or interface-based metadata access, replace RpcAuthorizationConfig with neutral method auth config. Publish resulting libraries to Maven for cross-product consumption.

### Timeline
**Target Completion**: 3 weeks

### Technology Stack
Java/Spring Boot, Protocol Buffers, Bazel, Maven publishing, OpenFGA

### Project Type
Refactoring

### Affected Components
stigmer-cloud/backend/libs/java/grpc/grpc-request (pipeline framework), stigmer-cloud/backend/libs/java/api/api-state (MongoDB repositories), stigmer-cloud/backend/libs/java/api/api-shape (metadata/kind reflection), stigmer-cloud/backend/libs/java/api/api-authentication (Auth0/JWT/ApiKey framework), stigmer-cloud/backend/libs/java/api/api-authorization (OpenFGA authorization), stigmer-cloud/backend/libs/java/grpc/grpc-router-codegen (gRPC routing)

## Project Context

### Dependencies
Must not break stigmer-cloud/backend/services/stigmer-service. Stigmer service must continue working after libs are extracted -- it becomes a consumer of the Maven artifacts. Proto commons types (metadata, kind) must be publishable as a separate Maven artifact.

### Success Criteria
- 1) All shared Java libs compile and pass tests with zero imports from protos.ai.stigmer.* (only from a neutral commons package). 2) stigmer-service consumes the extracted libs via Maven coordinates and all existing tests pass. 3) A new product (Scenar Cloud) can depend on the same Maven artifacts with its own proto types. 4) Pipeline steps (validate
- resolveSlug
- persist
- authorize) work with any product's resource types.

### Known Risks & Mitigations
Breaking stigmer-service during extraction. The ApiResourceKind enum is deeply embedded -- moving to String-based registry touches many files. Authorization config types are tightly coupled to Stigmer's RPC proto options. Must maintain backward compatibility during transition.

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