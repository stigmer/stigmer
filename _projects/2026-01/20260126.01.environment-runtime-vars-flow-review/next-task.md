# Environment Runtime Variables - Implementation Plan

## Quick Resume
Drag this file into chat to continue.

## Status After Investigation

| Component | Status |
|-----------|--------|
| Proto Definitions | ✅ Complete |
| Environment CRUD | ✅ Basic (needs encryption) |
| **Workflow Runner (Go)** | ✅ **EXISTS** - already processes runtime_env! |
| **Agent Runner (Python)** | ✅ **EXISTS** - needs env integration |
| Environment Resolution | ❌ Missing |
| Secret Encryption | ❌ Missing |
| CLI --env flags | ❌ Missing |

**Key Correction**: The Go workflow-runner EXISTS in `stigmer-oss/backend/services/workflow-runner/` and already handles `runtime_env` (lines 265-300 of `execute_workflow_activity.go`). The missing pieces are upstream.

## Key Design Decisions

1. **Encryption (Cloud)**: Follow existing service configuration pattern with `$secrets-group/`
2. **Encryption (OSS)**: Environment variable `STIGMER_ENCRYPTION_KEY` or `~/.stigmer/encryption.key`
3. **Algorithm**: AES-256-GCM (same for both)
4. **Pulumi-Inspired**: SDK-first, layered environments, runtime overrides
5. **Security**: ExecutionContext pattern - pass IDs through Temporal, not secrets

## Implementation Milestones

| Milestone | Duration | Description |
|-----------|----------|-------------|
| 1. Encryption Foundation | 2-3 days | AES-256-GCM service, key management |
| 2. ExecutionContext Lifecycle | 2-3 days | Auto-create on execution, auto-delete on completion |
| 3. Environment Resolution | 2-3 days | Resolve refs, merge with priority, decrypt |
| 4. Runner Integration | 2-3 days | Query ExecutionContext, pass to engine |
| 5. CLI Integration | 1-2 days | --env, --secret, --env-file flags |

**Total: ~10-13 days**

## Quality Requirements (From User)

- This is foundational code for a world-class platform
- No complacency, no garbage code, no technical debt
- Follow existing patterns (ConfigurationProperties, pipeline steps)
- Pulumi-inspired UX for SDK users

## Task Files
- Full plan: `tasks/T01_0_plan.md`

## Design Summary

```
┌─────────────────────────────────────────────────────────────────┐
│                     ENVIRONMENT FLOW                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Agent.env_spec (lowest)                                         │
│         │                                                        │
│         ▼                                                        │
│  Instance.environment_refs (medium) → Decrypt secrets           │
│         │                                                        │
│         ▼                                                        │
│  Execution.runtime_env (highest)                                 │
│         │                                                        │
│         ▼                                                        │
│  ┌─────────────────────────────────────────────┐                │
│  │ MERGED ENVIRONMENT                           │                │
│  │ (stored in ExecutionContext, secrets        │                │
│  │  encrypted at rest)                         │                │
│  └─────────────────────────────────────────────┘                │
│         │                                                        │
│         │ execution_id only (NO SECRETS)                        │
│         ▼                                                        │
│  Temporal Workflow                                               │
│         │                                                        │
│         │ execution_id only                                     │
│         ▼                                                        │
│  Activity (Go/Python)                                            │
│         │                                                        │
│         │ Query ExecutionContext, decrypt                       │
│         ▼                                                        │
│  Agent/Workflow Engine                                           │
│         │                                                        │
│         │ Resolve ${PLACEHOLDERS}                               │
│         ▼                                                        │
│  MCP Servers with real secrets                                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```
