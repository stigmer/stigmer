# Next Task: 20260419.01.platform-java-libs-extraction

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260419.01.platform-java-libs-extraction

**Description**: Refactor Stigmer Cloud's shared Java backend libraries (grpc-request pipeline, api-state, api-authentication, api-authorization, api-shape) to be proto-agnostic and publish them as Maven artifacts. This enables reuse across multiple products (Scenar Cloud, future platforms) without forking.
**Goal**: Make the core Java backend infrastructure (request pipeline, repository layer, auth framework, authorization framework) independent of any specific product's protobuf types. Replace concrete ApiResourceKind enum with String-based kind registry, replace concrete ApiResourceMetadata casts with reflection-based or interface-based metadata access, replace RpcAuthorizationConfig with neutral method auth config. Publish resulting libraries to Maven for cross-product consumption.
**Tech Stack**: Java/Spring Boot, Protocol Buffers, Bazel, Maven publishing, OpenFGA
**Components**: stigmer-cloud/backend/libs/java/grpc/grpc-request (pipeline framework), stigmer-cloud/backend/libs/java/api/api-state (MongoDB repositories), stigmer-cloud/backend/libs/java/api/api-shape (metadata/kind reflection), stigmer-cloud/backend/libs/java/api/api-authentication (Auth0/JWT/ApiKey framework), stigmer-cloud/backend/libs/java/api/api-authorization (OpenFGA authorization), stigmer-cloud/backend/libs/java/grpc/grpc-router-codegen (gRPC routing)

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260419.01.platform-java-libs-extraction/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260419.01.platform-java-libs-extraction/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260419.01.platform-java-libs-extraction/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260419.01.platform-java-libs-extraction/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260419.01.platform-java-libs-extraction/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260419.01.platform-java-libs-extraction/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260419.01.platform-java-libs-extraction/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260419.01.platform-java-libs-extraction/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260419.01.platform-java-libs-extraction/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260419.01.platform-java-libs-extraction/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260419.01.platform-java-libs-extraction/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260419.01.platform-java-libs-extraction/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260419.01.platform-java-libs-extraction/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-04-19 11:51
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
