# Agent Instance Controller

gRPC controller for managing agent instances (configured deployments of agent templates).

## Overview

An **Agent Instance** is a configured deployment of an **Agent** template. While agents define behavior and capabilities, agent instances provide the runtime configuration including environment variables and secrets.

## Architecture

```
Agent (Template)
  │
  ├─── Agent Instance 1 (Production)
  │    └─── Environment: prod-secrets
  │
  ├─── Agent Instance 2 (Staging)
  │    └─── Environment: staging-secrets
  │
  └─── Agent Instance 3 (Default)
       └─── No environment (minimal config)
```

Every agent automatically gets a **default instance** created during agent creation.

## Responsibilities

- Create, update, delete agent instances
- Validate agent instance configuration
- Manage default instances (auto-created by agents)
- Query agent instances by ID or agent reference

## Pipeline (Create)

1. **ValidateFieldConstraints** - Validate proto constraints using buf
2. **ResolveSlug** - Generate slug from metadata.name
3. **CheckDuplicate** - Ensure no duplicate instance exists
4. **SetDefaults** - Set ID, kind, api_version, timestamps
5. **Persist** - Save to BadgerDB

## Default Instances

Every agent automatically creates a default instance with:
- **Name**: `{agent-slug}-default`
- **Configuration**: No environment variables (empty)
- **Purpose**: Minimal working instance for testing/basic usage

The default instance is created via the `agentinstance` downstream client during agent creation.

## Files

- `agentinstance_controller.go` - Controller struct and initialization
- `create.go` - Create pipeline implementation
- (Future) `update.go`, `delete.go`, `query.go`

## Usage

This controller is typically used via:
1. **Direct gRPC calls** - From CLI or other services
2. **Downstream client** - For in-process calls from other domains (e.g., Agent creation)

See `downstream/agentinstance/README.md` for in-process usage patterns.
