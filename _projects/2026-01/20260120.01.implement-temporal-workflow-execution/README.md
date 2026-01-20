# Implement Temporal Workflow Execution

**Created:** 2026-01-20  
**Status:** 🚧 In Progress  
**Type:** Quick Project (1-2 sessions)

## Overview

Compare Temporal configuration between Java Cloud and Go OSS implementations, then implement the missing Temporal worker infrastructure for polyglot workflows with proper queue management and naming consistency.

## Goal

Enable workflow execution in Stigmer OSS by implementing Temporal workers, task queues, and worker configurations matching the Java Cloud polyglot workflow architecture.

## Technology Stack

- **Go/Bazel** - OSS implementation
- **Java/Spring Boot** - Cloud reference implementation
- **gRPC** - Cross-service communication
- **Temporal** - Workflow orchestration engine

## Affected Components

- `backend/services/stigmer-server` - Main Go server
- Temporal worker configuration and startup
- `workflowexecution` domain - Workflow execution handlers
- `agentexecution` domain - Similar pattern for reference
- Task queue naming and routing logic

## Context

**Problem:**
- Workflow executions are created successfully but stay in PENDING state forever
- No Temporal workers are started in stigmer-server main.go
- Temporal infrastructure exists in codebase but is not initialized
- Need to match Java Cloud's polyglot workflow architecture

**Current State:**
- ✅ Workflow execution creation works (API layer)
- ✅ Temporal workflow/activity definitions exist
- ✅ Worker config structs defined
- ❌ Workers not started in main.go
- ❌ Temporal client not initialized
- ❌ Queue names may not match Java Cloud

**Reference:**
- Java Cloud: `stigmer-cloud/backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/`
  - `workflow/temporal/`
  - `workflowexecution/temporal/`
  - `agentexecution/temporal/`

## Success Criteria

- [ ] Temporal workers start successfully with stigmer-server
- [ ] Workflow executions transition from PENDING → IN_PROGRESS → COMPLETED
- [ ] Queue names and task routing match Java Cloud architecture
- [ ] Subscribe RPC streams real-time updates during execution
- [ ] Test workflow completes successfully end-to-end

## Tasks

See `tasks.md` for detailed task breakdown and status tracking.

## Notes

See `notes.md` for implementation notes, learnings, and important findings.

## Quick Resume

To resume work on this project, drag `next-task.md` into any chat window.
