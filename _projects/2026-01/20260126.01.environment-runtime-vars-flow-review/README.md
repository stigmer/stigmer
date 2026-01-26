# Environment Runtime Variables Flow Review

## Overview
This project documents the complete environment variables, secrets, and execution context flow across the Stigmer platform - from CLI/frontend to agent/workflow runner execution.

## Key Finding

**The proto APIs are well-designed, but most of the backend implementation is missing.**

The platform has a 3-tier architecture for environment management:
1. **Template Layer** (Agent/Workflow) - Declares required env vars via `env_spec`
2. **Instance Layer** (AgentInstance/WorkflowInstance) - Binds Environment resources
3. **Execution Layer** (AgentExecution/WorkflowExecution) - Accepts runtime overrides

**Merge Priority**: Agent defaults < Environment < runtime_env (highest)

## Status Summary

| Component | Status | Notes |
|-----------|--------|-------|
| Proto Definitions | ✅ Complete | All APIs well-documented |
| Environment CRUD | ✅ Partial | No secret encryption |
| ExecutionContext CRUD | ✅ Partial | Not auto-created during execution |
| Environment Resolution | ❌ Missing | Resolving `environment_refs` to values |
| Environment Merging | ❌ Missing | Multi-source merge logic |
| Placeholder Resolution | ❌ Missing | `${VAR}` → actual value |
| Secret Encryption | ❌ Missing | At-rest encryption |
| runtime_env → ExecutionContext | ❌ Missing | Ephemeral storage flow |
| Agent Runner Integration | ❌ Missing | Env vars not passed to runner |
| **Workflow Runner (Go)** | ❌ **SERVICE MISSING** | The entire service doesn't exist |
| CLI --env flags | ❌ Missing | No way to pass runtime env from CLI |

## Goal
Document current state, identify gaps, and create a detailed implementation plan for each missing component.

## Timeline
1-2 weeks

## Technology Stack
- Go/CLI
- Java/Backend  
- Proto/APIs
- Temporal

## Affected Components
- CLI
- SDK
- APIs (environment, executioncontext, agentinstance, workflowinstance, agentexecution, workflowexecution)
- Backend handlers (stigmer-cloud)
- Agent runner (Java/Python)
- Workflow runner (Go - missing)

## Success Criteria
- Complete documentation of current state
- Gap analysis for each component
- Detailed implementation plan with milestones
- Security considerations documented
- Test cases defined

## Risks
- Large scope spanning multiple components
- Two repos involved (stigmer-oss and stigmer-cloud)
- Missing Go workflow runner is a significant infrastructure gap

## Files
- `tasks/T01_0_plan.md` - Full state review and implementation plan
- `next-task.md` - Quick resume file

## Quick Start
To resume this project in a new session, drag `next-task.md` into the chat.
