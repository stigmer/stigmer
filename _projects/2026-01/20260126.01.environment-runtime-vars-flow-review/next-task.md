# Next Task: Environment Runtime Variables Flow Review

## Quick Resume
Drag this file into a new chat to continue this project.

## Project Overview
Review the complete environment variables, secrets, and execution context flow from CLI/frontend to agent/workflow runner execution.

## Key Finding: MOST OF THE FLOW IS NOT IMPLEMENTED

The proto APIs are well-designed with a 3-tier architecture:
1. **Template** (Agent/Workflow) - Declares `env_spec` with required variables
2. **Instance** (AgentInstance/WorkflowInstance) - References Environment resources
3. **Execution** (AgentExecution/WorkflowExecution) - Accepts `runtime_env` overrides

**But the backend implementation is mostly missing.**

## Current State Summary

| Component | Status |
|-----------|--------|
| Proto Definitions | ✅ Complete |
| Environment CRUD | ✅ Basic (no encryption) |
| ExecutionContext CRUD | ✅ Basic (not auto-created) |
| Environment Resolution | ❌ Not Implemented |
| Environment Merging | ❌ Not Implemented |
| Placeholder Resolution (`${VAR}`) | ❌ Not Implemented |
| Secret Encryption | ❌ Not Implemented |
| runtime_env → ExecutionContext | ❌ Not Implemented |
| Agent Runner Integration | ❌ Not Implemented |
| Workflow Runner (Go) | ❌ **SERVICE DOESN'T EXIST** |
| CLI env flags | ❌ Not Implemented |

## Files Analyzed

### Stigmer OSS (apis)
- `apis/ai/stigmer/agentic/environment/v1/spec.proto` - Environment data model
- `apis/ai/stigmer/agentic/executioncontext/v1/spec.proto` - Ephemeral env storage
- `apis/ai/stigmer/agentic/agent/v1/spec.proto` - Agent with env_spec, MCP placeholders
- `apis/ai/stigmer/agentic/agentinstance/v1/spec.proto` - environment_refs binding
- `apis/ai/stigmer/agentic/workflowinstance/v1/spec.proto` - env_refs binding
- `apis/ai/stigmer/agentic/agentexecution/v1/spec.proto` - runtime_env field
- `apis/ai/stigmer/agentic/workflowexecution/v1/spec.proto` - runtime_env field

### Stigmer Cloud (backend)
- `AgentExecutionCreateHandler.java` - Missing runtime_env processing
- `AgentInstanceCreateHandler.java` - Missing environment_refs resolution
- `WorkflowExecutionCreateHandler.java` - Missing runtime_env processing  
- `WorkflowInstanceCreateHandler.java` - Only validates FGA access
- `EnvironmentCreateHandler.java` - No encryption
- `ExecutionContextCreateHandler.java` - Not auto-created
- `InvokeAgentExecutionWorkflowImpl.java` - No env var passing
- **Go workflow-runner service** - **COMPLETELY MISSING**

## Intended Data Flow (Not Implemented)

```
User creates Environment(s) with secrets
        ↓
User creates Agent with env_spec (declares requirements)
        ↓
User creates AgentInstance with environment_refs (binds envs)
        ↓
User creates AgentExecution with runtime_env (overrides)
        ↓
Backend MERGES: agent.env_spec + environments + runtime_env
        ↓
Backend creates ExecutionContext with merged values
        ↓
Temporal workflow fetches ExecutionContext
        ↓
Activity decrypts secrets and passes to runner
        ↓
Runner resolves ${PLACEHOLDERS} in MCP configs
        ↓
Agent runs with fully resolved environment
```

## Implementation Milestones

1. **Foundation** (3-4 days): Secret encryption, ExecutionContext lifecycle
2. **Resolution** (2-3 days): Environment resolver, merge service, placeholder resolution
3. **Agent Runner** (2-3 days): Fetch ExecutionContext activity, pass env to runner
4. **Workflow Runner** (5-7 days): CREATE the missing Go service!
5. **CLI** (1-2 days): --env, --secret flags

## Task Files
- Full plan: `tasks/T01_0_plan.md`

## Questions to Resolve
1. Where to store encryption key? (K8s Secret, Vault, KMS)
2. Go vs Java for workflow runner?
3. B2B integration requirements from Plant & Cloud?
