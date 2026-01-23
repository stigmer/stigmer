# Design Decision: Pivot to Struct-Based Args (Pulumi Pattern)

**Date**: 2026-01-24
**Status**: APPROVED - Major Architectural Pivot
**Impact**: Breaking Change - Complete API redesign

---

## Context

After successfully implementing functional options code generation and updating examples, we discovered that **our API doesn't match Pulumi's actual pattern**.

We assumed Pulumi used functional options (like `WithName()`, `WithDescription()`), but Pulumi actually uses **struct-based args**.

## The Pulumi Pattern (What We Should Follow)

### Actual Pulumi API:

```go
// Pulumi AWS S3 Bucket
bucket, err := s3.NewBucket(ctx, "my-bucket", &s3.BucketArgs{
    Acl: pulumi.String("private"),
    Tags: pulumi.StringMap{
        "Name": pulumi.String("My bucket"),
    },
    Versioning: &s3.BucketVersioningArgs{
        Enabled: pulumi.Bool(true),
    },
})
```

**Key Characteristics:**
1. ✅ Name as first parameter (after context)
2. ✅ Single struct pointer for all configuration (`&BucketArgs`)
3. ✅ Struct fields are plain Go types (strings, ints, nested structs)
4. ✅ Helper functions like `pulumi.String()` for outputs/inputs
5. ✅ NO functional options for resource configuration

### Functional Options in Pulumi

Pulumi DOES use functional options, but ONLY for:
- **SDK-level concerns**: `Parent()`, `DependsOn()`, `Protect()`, `DeleteBeforeReplace()`
- **Resource registration options**: NOT resource configuration

```go
// SDK-level options (separate from resource config)
bucket, err := s3.NewBucket(ctx, "my-bucket", &s3.BucketArgs{...},
    pulumi.Parent(parentResource),
    pulumi.DependsOn([]pulumi.Resource{otherResource}),
    pulumi.Protect(true),
)
```

## What We Built (Wrong Pattern)

```go
// ❌ Our current API (NOT Pulumi-style)
agent, err := agent.New(ctx, "code-reviewer",
    gen.AgentInstructions("Review code..."),
    gen.AgentDescription("Professional reviewer"),
    gen.AgentIconUrl("https://..."),
)
```

**Problems:**
1. ❌ Generated `gen.Agent*()` functions are verbose
2. ❌ Not discoverable (IDE can't autocomplete field names)
3. ❌ Requires importing `gen` package
4. ❌ Mixing resource config with SDK options in varargs
5. ❌ Doesn't match Pulumi's established pattern

## The Right Pattern (What We Should Build)

```go
// ✅ Pulumi-style struct-based args
agent, err := agent.New(ctx, "code-reviewer", &agent.AgentArgs{
    Instructions: "Review code and suggest improvements",
    Description:  "Professional code reviewer",
    IconUrl:      "https://example.com/icon.png",
    Skills: []skill.Skill{
        skill.Platform("coding-best-practices"),
    },
})
```

**Benefits:**
1. ✅ Clean, readable struct literal
2. ✅ IDE autocomplete works perfectly
3. ✅ No `gen` package needed
4. ✅ Follows Pulumi conventions exactly
5. ✅ Clear separation: args struct vs SDK options

## Implementation Strategy

### Phase 1: Generate Args Structs (Not Option Functions)

**Generator Changes:**
- Generate `AgentArgs`, `SkillArgs`, `HttpCallArgs` structs
- NOT `gen.AgentOption` function types
- Fields are plain Go types (string, int, bool, nested structs)

**Example Generated Code:**

```go
// sdk/go/agent/agent.go (or agent/args.go)
type AgentArgs struct {
    Instructions string
    Description  string
    IconUrl      string
    Skills       []skill.Skill
    McpServers   []mcpserver.MCPServer
    SubAgents    []subagent.SubAgent
}

// Constructor accepts args struct
func New(ctx Context, name string, args *AgentArgs, opts ...pulumi.ResourceOption) (*Agent, error) {
    if args == nil {
        args = &AgentArgs{}
    }
    
    a := &Agent{
        Name:         name,
        Instructions: args.Instructions,
        Description:  args.Description,
        IconUrl:      args.IconUrl,
        Skills:       args.Skills,
        MCPServers:   args.McpServers,
        SubAgents:    args.SubAgents,
    }
    
    // Apply SDK-level options (Parent, DependsOn, etc.)
    for _, opt := range opts {
        opt.ApplyResourceOption(a)
    }
    
    // Validate and register...
}
```

### Phase 2: SDK-Level Options (Pulumi Pattern)

Reserve functional options ONLY for SDK concerns:

```go
// SDK-level options (NOT resource config)
type ResourceOption func(*resourceState)

func Parent(parent Resource) ResourceOption { ... }
func DependsOn(deps []Resource) ResourceOption { ... }
func Protect(protect bool) ResourceOption { ... }

// Usage:
agent, err := agent.New(ctx, "reviewer", &agent.AgentArgs{
    Instructions: "...",
}, Parent(parentResource), Protect(true))
```

### Phase 3: Workflow Tasks Use Same Pattern

```go
// ✅ Workflow task with struct args
wf.HttpCall("fetch", &workflow.HttpCallArgs{
    Method: "GET",
    Uri:    "https://api.example.com/data",
    Headers: map[string]string{
        "Authorization": "Bearer ${TOKEN}",
    },
})
```

## Migration Path

### Breaking Change Announcement

This is a **pre-launch breaking change** (acceptable since no production users).

**Migration:**
```go
// OLD (functional options):
agent.New(ctx, "reviewer",
    gen.AgentInstructions("..."),
    gen.AgentDescription("..."),
)

// NEW (struct args):
agent.New(ctx, "reviewer", &agent.AgentArgs{
    Instructions: "...",
    Description:  "...",
})
```

### Code Generation Impact

**Remove:**
- ❌ `gen.AgentOption` type
- ❌ `gen.AgentInstructions()` function
- ❌ `gen.AgentDescription()` function
- ❌ All generated option functions

**Add:**
- ✅ `AgentArgs` struct (in main package, not `gen/`)
- ✅ `HttpCallArgs`, `AgentCallArgs`, etc. (workflow tasks)
- ✅ SDK-level `ResourceOption` for Parent/DependsOn

## Why This Matters

### Developer Experience

**Struct Args (Pulumi Pattern):**
```go
agent.New(ctx, "reviewer", &agent.AgentArgs{
    Instructions: "Review code",  // ← IDE autocompletes "Instructions"
    Description: "Pro reviewer",  // ← Clear, readable
})
```

**Functional Options (What We Built):**
```go
agent.New(ctx, "reviewer",
    gen.AgentInstructions("Review code"),  // ← gen.Agent* is verbose
    gen.AgentDescription("Pro reviewer"),  // ← Less discoverable
)
```

### Consistency with Ecosystem

Pulumi users expect struct-based args. Our API should match their mental model:
- AWS provider: `&s3.BucketArgs{...}`
- GCP provider: `&storage.BucketArgs{...}`
- Stigmer: `&agent.AgentArgs{...}` ✅

## Decision

**Pivot to struct-based args following Pulumi's exact pattern.**

**Rationale:**
1. Matches Pulumi conventions (critical for adoption)
2. Better IDE support (autocomplete, type checking)
3. Cleaner, more readable code
4. Clear separation: config (structs) vs options (SDK-level)
5. Pre-launch, so breaking changes are acceptable

**Trade-offs:**
- Must rewrite all examples (worth it for correct pattern)
- Generator must produce structs, not functions (cleaner anyway)
- Existing code generation work needs refactoring (sunk cost, pivot now)

## Next Steps

1. Update generator to produce `Args` structs (not option functions)
2. Update SDK constructors to accept `*Args` + `...ResourceOption`
3. Implement SDK-level options (Parent, DependsOn, Protect)
4. Update all examples to struct-based pattern
5. Document migration guide (for future reference)

---

**Key Takeaway:** Always verify assumptions by checking actual Pulumi code. We assumed functional options based on secondary descriptions, but Pulumi's real API uses struct args. This pivot aligns us with the industry standard.
