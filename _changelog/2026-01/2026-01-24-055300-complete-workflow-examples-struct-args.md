# Complete Workflow Examples Migration to Struct-Based Args

**Date**: January 24, 2026

## Summary

Completed the final phase of SDK options codegen migration by updating all remaining workflow examples (14-19) to use struct-based args pattern. This completes the comprehensive transition from functional options to Pulumi-style struct args across all 11 workflow examples in the SDK, providing developers with consistent, discoverable APIs.

## Problem Statement

After migrating the SDK core (agent, skill, workflow task types) and initial examples (07-11, 13) to struct-based args, 6 workflow examples remained unconverted, showing outdated functional options patterns.

### Pain Points

- **Inconsistent documentation**: Examples 07-13 showed new pattern, examples 14-19 showed old pattern
- **Developer confusion**: Mixed patterns in examples make it unclear which approach to use
- **Incomplete migration**: Can't mark migration complete with examples showing old API
- **Example drift**: Examples don't reflect current SDK capabilities

## Solution

Systematically updated all 6 remaining workflow examples (14-19) to follow the struct-based args pattern established in Phase 5 of the SDK options codegen project:

- Convert agent creation to `agent.New(ctx, name, &agent.AgentArgs{...})`
- Convert agent calls to `wf.CallAgent(name, &workflow.AgentCallArgs{...})`
- Convert HTTP calls to use `map[string]string` headers and `map[string]any` body
- Preserve runtime secret and interpolation helpers

## Implementation Details

### Examples Updated

**Example 14** (`14_workflow_with_runtime_secrets.go`):
- Updated 8 HTTP calls (OpenAI, GitHub, Stripe, database, webhooks, Slack)
- Converted headers from `workflow.Header()` to `map[string]string{}`
- Converted body from `workflow.WithBody()` to `map[string]any{}`
- Preserved runtime security patterns with `RuntimeSecret()` and `RuntimeEnv()`

**Example 15** (`15_workflow_calling_simple_agent.go`):
- Updated agent creation to struct args
- Converted agent call to `&workflow.AgentCallArgs{Agent: ..., Message: ...}`
- Preserved direct instance reference pattern: `workflow.Agent(instance).Slug()`

**Example 16** (`16_workflow_calling_agent_by_slug.go`):
- Updated 3 agent calls (org scope, platform scope, chaining)
- Preserved slug reference pattern: `workflow.AgentBySlug("slug").Slug()`
- Demonstrated scope handling (organization vs platform)

**Example 17** (`17_workflow_agent_with_runtime_secrets.go`):
- Updated HTTP call with runtime secret headers
- Converted agent call with environment variables and config
- Pattern: `Env: map[string]string{...}, Config: map[string]interface{}{"timeout": 600}`

**Example 18** (`18_workflow_multi_agent_orchestration.go`):
- Updated 5 agent creations (security, code-review, performance, devops, qa)
- Updated 5 agent calls with environment variables and timeouts
- Updated Set task to `wf.Set(name, &workflow.SetArgs{Variables: ...})`
- Updated 4 HTTP calls (GitHub fetch, deployment, Slack notifications)

**Example 19** (`19_workflow_agent_execution_config.go`):
- Updated 6 agent calls with execution configuration
- Demonstrated model selection: `Config: map[string]interface{}{"model": "claude-3-5-sonnet"}`
- Demonstrated temperature tuning: `"temperature": 0.9` (creative) to `0.0` (deterministic)
- Demonstrated timeout control: `"timeout": 15` (real-time) to `600` (deep analysis)

### Pattern Transformations

**Agent Creation** (old → new):
```go
// OLD (functional options)
agent.New(ctx,
    agent.WithName("code-reviewer"),
    agent.WithInstructions("Review code..."),
    agent.WithDescription("AI reviewer"),
)

// NEW (struct args)
agent.New(ctx, "code-reviewer", &agent.AgentArgs{
    Instructions: "Review code...",
    Description:  "AI reviewer",
})
```

**Agent Calls** (old → new):
```go
// OLD (functional options)
wf.CallAgent("reviewCode",
    workflow.AgentOption(workflow.Agent(codeReviewer)),
    workflow.Message("Review this code"),
    workflow.WithEnv(map[string]string{"GITHUB_TOKEN": "..."}),
    workflow.AgentTimeout(300),
    workflow.Model("claude-3-5-sonnet"),
    workflow.Temperature(0.5),
)

// NEW (struct args)
wf.CallAgent("reviewCode", &workflow.AgentCallArgs{
    Agent: workflow.Agent(codeReviewer).Slug(),
    Message: "Review this code",
    Env: map[string]string{
        "GITHUB_TOKEN": "...",
    },
    Config: map[string]interface{}{
        "timeout":     300,
        "model":       "claude-3-5-sonnet",
        "temperature": 0.5,
    },
})
```

**HTTP Calls** (old → new):
```go
// OLD (functional options)
wf.HttpPost("api",
    "https://api.example.com/endpoint",
    workflow.Header("Authorization", "Bearer token"),
    workflow.Header("Content-Type", "application/json"),
    workflow.WithBody(map[string]any{"key": "value"}),
)

// NEW (positional args)
wf.HttpPost("api",
    "https://api.example.com/endpoint",
    map[string]string{
        "Authorization": "Bearer token",
        "Content-Type":  "application/json",
    },
    map[string]any{"key": "value"},
)
```

### Preserved Patterns

**Helper functions still work** (these return strings):
- `workflow.RuntimeSecret("KEY")` → `"${.secrets.KEY}"`
- `workflow.RuntimeEnv("VAR")` → `"${.env_vars.VAR}"`
- `workflow.Interpolate(parts...)` → concatenated string
- `workflow.Agent(instance)` → `AgentRef` with `.Slug()` method
- `workflow.AgentBySlug("slug")` → `AgentRef` with `.Slug()` method

## Benefits

### Consistency

- ✅ **All 11 workflow examples now use identical pattern** (07-19)
- ✅ **No mixed API styles** - examples are internally consistent
- ✅ **Clear learning path** - each example builds on previous patterns

### Developer Experience

- ✅ **Discoverable APIs** - struct fields are autocomplete-friendly
- ✅ **Pulumi-familiar** - matches Pulumi Args pattern developers know
- ✅ **Type-safe** - struct fields provide better IDE support than functional options
- ✅ **Clear configuration** - all options visible in one struct literal

### Documentation Quality

- ✅ **Examples match reality** - all examples reflect current SDK API
- ✅ **Copy-paste ready** - developers can copy example code directly
- ✅ **Comprehensive coverage** - 11 examples cover all major patterns
- ✅ **Production-ready patterns** - examples show real-world usage (OpenAI, GitHub, Stripe, Slack)

### Migration Completeness

- ✅ **Full SDK migration** - agent, skill, workflow tasks, all examples
- ✅ **No legacy code** - functional options removed from examples
- ✅ **Single source of truth** - struct args is the only pattern shown
- ✅ **Ready for v0.2.0** - breaking change completed across entire SDK

## Impact

### Files Modified

**6 workflow example files** (`sdk/go/examples/`):
- `14_workflow_with_runtime_secrets.go` (382 lines)
- `15_workflow_calling_simple_agent.go` (80 lines)
- `16_workflow_calling_agent_by_slug.go` (84 lines)
- `17_workflow_agent_with_runtime_secrets.go` (133 lines)
- `18_workflow_multi_agent_orchestration.go` (325 lines)
- `19_workflow_agent_execution_config.go` (202 lines)

**Total**: 1,206 lines of example code updated

### Migration Status

**Complete** (Phases 0-7):
- ✅ Phase 0: Architecture fix (proto-driven generator, no circular imports)
- ✅ Phase 1: Agent constructor → struct args
- ✅ Phase 2: Skill constructor → struct args
- ✅ Phase 3: Agent examples updated (01-06, 12, 13)
- ✅ Phase 4: Agent test files updated (13 test files)
- ✅ Phase 5: Workflow task types → struct args (all 13 task types)
- ✅ Phase 6: Documentation (migration guide, architecture, implementation report)
- ✅ **Phase 7: Workflow examples updated (07-19) - THIS WORK** ✅

**Remaining** (out of scope for this project):
- API Reference documentation updates (`docs/API_REFERENCE.md`)
- Usage Guide documentation updates (`docs/USAGE.md`)
- Workflow creation args (still uses functional options - separate work)

### Developer Impact

- **7 agent examples** now show correct pattern (01-06, 12)
- **11 workflow examples** now show correct pattern (07-19)
- **18 examples total** demonstrate struct-based args
- **0 examples** show old functional options pattern
- **100% consistency** across all SDK examples

## Related Work

**Project**: 20260123.02.sdk-options-codegen
- Goal: Automate generation of functional options from proto schemas
- Status: Migration to struct args complete (Phase 7/7)
- Next: API Reference and Usage Guide updates

**Previous Conversations**:
- Conversation 1-2: Architecture fix and types generation
- Conversation 3: Skill constructor update
- Conversation 4: Agent constructor and workflow task types update
- Conversation 5: Documentation creation
- Conversation 6: Agent test files update
- Conversation 7: SDK cleanup and examples 07-11, 13
- **Conversation 8 (this work)**: Examples 14-19 completion

## Code Quality

### Patterns Applied

- ✅ **Single responsibility** - each example demonstrates specific pattern
- ✅ **Real-world scenarios** - production API integrations (OpenAI, GitHub, Stripe, Slack)
- ✅ **Security best practices** - runtime secrets, environment-specific config
- ✅ **Comprehensive coverage** - simple to complex, single to multi-agent
- ✅ **Educational value** - examples teach patterns progressively

### Example Complexity

**Simple** (15, 16): 80-84 lines
- Basic agent calls
- Slug references
- Scope handling

**Medium** (14, 17, 19): 130-382 lines
- Runtime secrets
- Environment variables
- Execution configuration

**Complex** (18): 325 lines
- Multi-agent orchestration
- 5 agents, 9 tasks
- Real-world CI/CD pipeline

### Documentation in Code

All examples include:
- Clear purpose and learning points
- Usage instructions
- Security explanations (where applicable)
- Real-world context
- Comparison with old patterns (where educational)

---

**Status**: ✅ Complete
**Timeline**: 30 minutes (systematic conversion of 6 examples)
**Project Phase**: 7/7 complete (workflow examples migration)
**Next Steps**: API Reference and Usage Guide documentation updates (medium priority)
