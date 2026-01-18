# Next Task - Agent Controller Pipeline

**Project:** Agent Controller Pipeline Framework  
**Location:** `_projects/2026-01/20260118.01.agent-controller-pipeline/`  
**Last Updated:** 2026-01-18

## Current Status

✅ **Task T01 Complete** - Pipeline framework foundation implemented  
✅ **Task T02 Complete** - Common pipeline steps implemented and interface fixed  
✅ **Architecture Alignment Complete** - Pipeline moved to correct location in grpc/request/

## Current Task

**Task T03:** Integrate Pipeline into Agent Controller

**Status:** READY TO START

**Previous Task:** `@stigmer/_projects/2026-01/20260118.01.agent-controller-pipeline/tasks/T02_2_complete.md`

## What to Do Next

Now that the pipeline framework is complete and properly located, integrate it into the Agent Controller:

### Implementation Checklist

1. **Update Agent Controller** - Replace inline logic with pipeline
   - Location: `backend/services/stigmer-server/pkg/controllers/agent_controller.go`
   - Import: `github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline`
   
2. **Build Create Pipeline**:
   ```go
   p := pipeline.NewPipeline[*agentv1.Agent]("agent-create").
       AddStep(steps.NewResolveSlugStep[*agentv1.Agent]()).
       AddStep(steps.NewCheckDuplicateStep[*agentv1.Agent](store, "Agent")).
       AddStep(steps.NewSetDefaultsStep[*agentv1.Agent]("agent")).
       AddStep(steps.NewPersistStep[*agentv1.Agent](store, "Agent")).
       Build()
   ```

3. **Execute Pipeline** in Create method
4. **Update Update/Delete methods** similarly
5. **Run tests** to verify integration

## Architecture Note

Pipeline is now at correct location matching Java structure:
- **Go:** `backend/libs/go/grpc/request/pipeline/`
- **Java:** `backend/libs/java/grpc/grpc-request/pipeline/`

See: `@backend/libs/go/grpc/request/README.md`

## Quick Context

This project implements a pipeline framework for the Stigmer OSS agent controller to match the architecture used in Stigmer Cloud (Java). 

**Completed so far:**
- ✅ Generic pipeline framework (T01)
- 🟡 4 common reusable steps: slug resolution, duplicate checking, defaults, persistence (T02 - needs interface fix)

**What remains:**
- ⏳ Fix interface mismatch (15 min)
- ⏳ Agent-specific steps (2-3 hours)
- ⏳ Agent controller refactoring (1-2 hours)
- ⏳ Integration testing

## Files to Reference

- **Partial Completion:** `@stigmer/_projects/2026-01/20260118.01.agent-controller-pipeline/tasks/T02_1_partial.md`
- **README:** `@stigmer/_projects/2026-01/20260118.01.agent-controller-pipeline/README.md`
- **Step Interface:** `@stigmer/backend/services/stigmer-server/pkg/pipeline/step.go`

## To Resume in Future Sessions

Simply drag this file (`next-task.md`) into the chat or reference:
```
@stigmer/_projects/2026-01/20260118.01.agent-controller-pipeline/next-task.md
```
