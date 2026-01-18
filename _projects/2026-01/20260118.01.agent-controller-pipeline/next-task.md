# Next Task - Agent Controller Pipeline

**Project:** Agent Controller Pipeline Framework  
**Location:** `_projects/2026-01/20260118.01.agent-controller-pipeline/`  
**Last Updated:** 2026-01-18

## Current Status

✅ **Task T01 Complete** - Pipeline framework foundation implemented

## Current Task

**Task T02:** Implement Common Pipeline Steps

**Status:** READY TO START

**Previous Task:** `@stigmer/_projects/2026-01/20260118.01.agent-controller-pipeline/tasks/T01_1_completed.md`

## What to Do Next

1. **Plan T02** - Design common reusable steps:
   - ResolveSlugStep - Generate slug from resource name
   - CheckDuplicateStep - Verify resource doesn't exist
   - SetAuditFieldsStep - Add created_at, updated_at, version
   - SetDefaultsStep - Apply default values
   - PersistStep - Save to database
   
2. **Implement steps** following the patterns from ValidateProtoStep

3. **Test thoroughly** with agent controller integration

## Quick Context

This project implements a pipeline framework for the Stigmer OSS agent controller to match the architecture used in Stigmer Cloud (Java). The goal is to transform the current monolithic controller into a maintainable, testable pipeline-based architecture.

Key features being added:
- Generic pipeline framework with step execution
- OpenTelemetry integration (no-op initially)
- Proto validation using buf.build/validate
- Slug resolution from resource names
- Audit fields (timestamps, versioning)
- Default instance creation
- Proper error handling and tracing

## Files to Reference

- **README:** `@stigmer/_projects/2026-01/20260118.01.agent-controller-pipeline/README.md`
- **Current Controller:** `@stigmer/backend/services/stigmer-server/pkg/controllers/agent_controller.go`
- **Java Reference:** `@stigmer-cloud/backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agent/request/handler/AgentCreateHandler.java`

## To Resume in Future Sessions

Simply drag this file (`next-task.md`) into the chat or reference:
```
@stigmer/_projects/2026-01/20260118.01.agent-controller-pipeline/next-task.md
```
