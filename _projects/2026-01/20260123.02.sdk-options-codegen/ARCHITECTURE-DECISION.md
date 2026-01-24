# Architecture Decision: Pulumi-Style Args Without gen/ Package

**Date**: 2026-01-24
**Status**: IN PROGRESS - Paused for Next Conversation
**Context Length**: ~116K tokens

---

## Problem Statement

We want `agent.AgentArgs` (Pulumi pattern) instead of `gen.AgentArgs` (current).

**Blocker:** Circular imports
```
agent → skill → workflow → agent
```

---

## Discovered Issue: Wrong Approach Taken

In conversation, I started **manually copying types** from `workflow/types.go` to a new `types/types.go`.

**This was WRONG because:**

1. ❌ These types are **generated from proto**, not hand-written
2. ❌ Domain ownership is mixed - `McpServerDefinition` belongs to **agent**, not workflow
3. ❌ The generator should determine type placement, not manual copying

---

## Root Cause Analysis

### Current Generator Behavior

```bash
# Generator outputs ALL shared types to workflow/types.go
tools/codegen/generator/main.go → generateSharedTypes()
  ↓
sdk/go/workflow/types.go  # Contains EVERYTHING (wrong!)
```

**Problem:** Generator doesn't respect domain boundaries.

### Proto Schema Organization

```
tools/codegen/schemas/
├── agent/
│   ├── agent.json                    # AgentSpec schema
│   └── types/
│       ├── mcp_server.json           # McpServerDefinition (AGENT domain)
│       ├── environment_spec.json     # EnvironmentSpec (AGENT domain)
│       └── subagent.json             # SubAgent (AGENT domain)
├── skill/
│   └── skill.json
└── tasks/
    └── types/
        └── api_resource.json         # ApiResourceReference (SHARED)
```

**Key Insight:** Types have domain ownership in proto schemas!

---

## Correct Solution (To Implement Next Conversation)

### Phase 1: Audit Type Ownership (30 min)

```bash
# Analyze proto schemas to determine ownership
find tools/codegen/schemas -name "*.json" -path "*/types/*"

# Expected outcome:
# - agent/types/* → sdk/go/types/agent_*.go
# - skill/types/* → sdk/go/types/skill_*.go  
# - tasks/types/* → sdk/go/types/shared_*.go (truly shared)
```

**Output:** Create `TYPE_OWNERSHIP.md` mapping proto → Go package

### Phase 2: Update Generator (2-3 hours)

**Option A: Domain-Owned Generated Types**
```go
// Generator change:
func (g *Generator) generateSharedTypes() error {
    // Instead of dumping to workflow/types.go
    // Group by domain and generate:
    // - sdk/go/types/agent_types.go
    // - sdk/go/types/skill_types.go
    // - sdk/go/types/shared_types.go
}
```

**Option B: Types Stay In Domain Packages**
```go
// Generate types in their domain packages:
sdk/go/agent/mcp_types.go       // McpServerDefinition, etc.
sdk/go/skill/skill_types.go     // Skill-specific types
sdk/go/types/api_resource.go    // Only ApiResourceReference
```

**Recommendation:** Option A (cleaner, all generated types in one place)

### Phase 3: Update Args Generation (1 hour)

```go
// genArgsStruct should reference types package:
func (c *genContext) goType(typeSpec TypeSpec) string {
    switch typeSpec.Kind {
    case "message":
        // Check if type is in types package
        if isSharedType(typeSpec.MessageType) {
            return "*types." + typeSpec.MessageType
        }
        // Otherwise use local type
        return "*" + typeSpec.MessageType
    }
}
```

### Phase 4: Generate Args in Main Packages (30 min)

```go
// Update getOutputDir to output to main package:
func (g *Generator) getOutputDir(schema *TaskConfigSchema) string {
    if strings.Contains(schema.ProtoFile, "/agent/") {
        return "sdk/go/agent"  // NOT agent/gen
    }
    // ...
}
```

### Phase 5: Update All Imports (1 hour)

```bash
# Replace workflow.McpServerDefinition with types.McpServerDefinition
find sdk/go -name "*.go" -exec sed -i '' 's/workflow\.McpServerDefinition/types.McpServerDefinition/g' {} \;
```

### Phase 6: Test & Verify (30 min)

```bash
# Verify no circular imports
cd sdk/go && go build ./...

# Run example
go run sdk/go/examples/01_basic_agent.go
```

---

## Files Created This Conversation (Need Review)

1. **sdk/go/types/types.go** - ⚠️ HAND-WRITTEN, SHOULD BE GENERATED
   - Delete this file and regenerate properly

2. **sdk/go/workflow/types.go** - ✅ UPDATED to re-export from types
   - Keep this approach (type aliases for backward compat)

---

## Next Conversation Checklist

- [ ] Delete hand-written `sdk/go/types/types.go`
- [ ] Audit proto schemas for type ownership
- [ ] Create `TYPE_OWNERSHIP.md` mapping
- [ ] Update generator to respect domain boundaries
- [ ] Generate types in `sdk/go/types/` package (domain-organized)
- [ ] Update Args generation to reference `types.X` 
- [ ] Regenerate all Args in main packages
- [ ] Update agent.go to use `AgentArgs` (not `gen.AgentArgs`)
- [ ] Update examples to import single package
- [ ] Test compilation and run examples

---

## Key Learning

**Don't manually write generated code!** 

The generator should:
1. Parse proto schemas
2. Respect domain ownership
3. Generate types in appropriate packages
4. Handle imports automatically

---

## Conversation Stats

- **Token Usage:** ~116K / 1M tokens
- **Files Modified:** 8+
- **Approach:** Started wrong (manual), corrected mid-conversation
- **Status:** Need fresh start with proper proto-driven generation

---

## Questions for Next Session

1. Should types be in `sdk/go/types/` or stay in domain packages?
2. How does generator determine "shared" vs "domain-specific" types?
3. Do we need backward compatibility for `workflow.McpServerDefinition`?

---

**Action:** Start next conversation by reading this file and proto schemas first!
