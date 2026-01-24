# Comprehensive Args Codegen for All Proto Namespaces

**Date:** 2026-01-24  
**Type:** Enhancement  
**Scope:** SDK Codegen, Proto Schema Generation  
**Impact:** Major - Comprehensive automation of Args struct generation

## Summary

Implemented comprehensive Args struct generation for **all** proto message namespaces, not just manually selected ones. The codegen now automatically discovers and generates Args structs for every `Spec` message across all agentic namespaces (agent, skill, workflow, agentinstance, agentexecution, environment, executioncontext, etc.).

## Motivation

**Before:** 
- Manually created schema JSONs for each resource type
- Only Agent and Skill had Args structs
- Had to explicitly add new namespaces to the generator

**After:**
- Automatic discovery of all proto namespaces
- Args generated for **every** Spec message
- Zero manual maintenance - just define protos, run codegen

## What Changed

### 1. Enhanced `proto2schema` Tool

**Added comprehensive generation mode** (`--comprehensive` flag):

```bash
# Old way (manual, per-namespace)
go run proto2schema --proto-dir apis/.../agent/v1 --output-dir schemas/agent

# New way (automatic, all namespaces)
go run proto2schema --comprehensive --include-dir apis
```

**New functionality:**
- Scans `apis/ai/stigmer/agentic/` for all namespaces
- For each namespace directory:
  - Finds all proto files
  - Extracts messages ending in `Spec`
  - Generates schemas to `tools/codegen/schemas/<namespace>/`
  - Collects nested shared types
- Special handling for workflow tasks (still uses `TaskConfig` suffix)

**Files changed:**
- `tools/codegen/proto2schema/main.go`
  - Added `--comprehensive` flag
  - Added `runComprehensiveGeneration()` function
  - Added `generateNamespaceSchemas()` helper

### 2. Enhanced Generator Tool

**Automatic namespace discovery:**

```go
// Old: Hardcoded agent/ and skill/ directories
agentDir := filepath.Join(g.schemaDir, "agent")
skillDir := filepath.Join(g.schemaDir, "skill")

// New: Scan ALL namespace directories automatically
for _, schemaEntry := range os.ReadDir(g.schemaDir) {
    if schemaEntry.IsDir() && dirName != "tasks" && dirName != "types" {
        // Load specs from this namespace
    }
}
```

**Files changed:**
- `tools/codegen/generator/main.go`
  - Replaced hardcoded `agent/` and `skill/` loading with dynamic discovery
  - Now scans all subdirectories in schema directory
  - Automatically determines package and output directory from proto file paths

### 3. Updated Makefile

**Simplified codegen targets:**

```makefile
# Stage 1: Comprehensive schema generation
codegen-schemas:
    go run tools/codegen/proto2schema/main.go \
        --comprehensive \
        --include-dir apis \
        --output-dir tools/codegen/schemas

# Stage 2: Uses existing generator (now with auto-discovery)
codegen-go:
    go run tools/codegen/generator/main.go \
        --schema-dir tools/codegen/schemas \
        --output-dir sdk/go/gen/workflow \
        --package workflow
```

**Files changed:**
- `sdk/go/Makefile`
  - Updated `codegen-schemas` to use `--comprehensive` mode
  - Updated documentation to reflect all namespaces
  - Updated success message to list all generated packages

## Generated Output

### Schema Files (`tools/codegen/schemas/`)

```
schemas/
├── agent/
│   ├── agent.json                    # AgentSpec
│   ├── inlinesubagent.json           # InlineSubAgentSpec
│   └── types/                        # Shared types for agent
├── agentinstance/
│   ├── agentinstance.json            # AgentInstanceSpec
│   └── types/
├── agentexecution/
│   ├── agentexecution.json           # AgentExecutionSpec
│   └── types/
├── skill/
│   ├── skill.json                    # SkillSpec
│   └── types/
├── workflow/
│   ├── workflow.json                 # WorkflowSpec
│   ├── signal.json                   # SignalSpec
│   └── types/
├── workflowinstance/
│   ├── workflowinstance.json         # WorkflowInstanceSpec
│   └── types/
├── workflowexecution/
│   ├── workflowexecution.json        # WorkflowExecutionSpec
│   └── types/
├── environment/
│   ├── environment.json              # EnvironmentSpec
│   └── types/
├── executioncontext/
│   ├── executioncontext.json         # ExecutionContextSpec
│   └── types/
├── tasks/                            # Workflow task configs
│   ├── agentcall.json
│   ├── httpcall.json
│   ├── ...
│   └── types/
└── types/                            # Global shared types
    ├── agentic_types.go
    └── commons_types.go
```

### Generated Go Args (`sdk/go/gen/`)

```go
// sdk/go/gen/agent/agentspec_args.go
package agent

type AgentArgs struct {
    Description      string                      `json:"description,omitempty"`
    IconUrl          string                      `json:"iconUrl,omitempty"`
    Instructions     string                      `json:"instructions,omitempty"`
    McpServers       []*McpServerDefinition      `json:"mcpServers,omitempty"`
    SkillRefs        []*types.ApiResourceReference `json:"skillRefs,omitempty"`
    SubAgents        []*SubAgent                 `json:"subAgents,omitempty"`
    EnvSpec          *EnvironmentSpec            `json:"envSpec,omitempty"`
}

// sdk/go/gen/agentinstance/agentinstancespec_args.go
package agentinstance

type AgentInstanceArgs struct {
    AgentId         string                         `json:"agentId,omitempty"`
    Description     string                         `json:"description,omitempty"`
    EnvironmentRefs []*types.ApiResourceReference  `json:"environmentRefs,omitempty"`
}

// sdk/go/gen/agentexecution/agentexecutionspec_args.go
package agentexecution

type AgentExecutionArgs struct {
    SessionId       string                    `json:"sessionId,omitempty"`
    AgentId         string                    `json:"agentId,omitempty"`
    Message         string                    `json:"message,omitempty"`
    ExecutionConfig *ExecutionConfig          `json:"executionConfig,omitempty"`
    RuntimeEnv      map[string]*ExecutionValue `json:"runtimeEnv,omitempty"`
    CallbackToken   []byte                    `json:"callbackToken,omitempty"`
}

// ... and 8 more namespaces
```

### Full List of Generated Args

1. ✅ **agent/AgentArgs** - Agent template configuration
2. ✅ **agent/InlineSubAgentArgs** - Inline sub-agent definition
3. ✅ **agentinstance/AgentInstanceArgs** - Agent deployment instance
4. ✅ **agentexecution/AgentExecutionArgs** - Agent execution triggers
5. ✅ **skill/SkillArgs** - Skill resource configuration
6. ✅ **workflow/WorkflowArgs** - Workflow specification
7. ✅ **workflow/SignalArgs** - Workflow signal definition
8. ✅ **workflowinstance/WorkflowInstanceArgs** - Workflow instance
9. ✅ **workflowexecution/WorkflowExecutionArgs** - Workflow execution
10. ✅ **environment/EnvironmentArgs** - Environment configuration
11. ✅ **executioncontext/ExecutionContextArgs** - Execution context

Plus **21 shared types** in `sdk/go/gen/types/`:
- McpServerDefinition, HttpEndpoint, WorkflowTask, EnvironmentSpec, ExecutionConfig, etc.

## How It Works

### Discovery Process

1. **Proto2Schema** scans `apis/ai/stigmer/agentic/`:
   ```
   agentic/
   ├── agent/v1/spec.proto          → schemas/agent/agent.json
   ├── agentinstance/v1/spec.proto  → schemas/agentinstance/agentinstance.json
   ├── skill/v1/spec.proto          → schemas/skill/skill.json
   └── ...
   ```

2. **Generator** scans `tools/codegen/schemas/`:
   ```
   schemas/agent/agent.json        → sdk/go/gen/agent/agentspec_args.go
   schemas/skill/skill.json        → sdk/go/gen/skill/skillspec_args.go
   ...
   ```

3. **Output directory determined by proto path**:
   ```
   protoFile: "apis/ai/stigmer/agentic/agent/v1/spec.proto"
   → subdomain: "agent"
   → outputDir: "sdk/go/gen/agent/"
   → package: "agent"
   ```

### Data-Driven Architecture

The entire system is **data-driven**:
- No hardcoded namespace lists
- Proto file path determines output location
- New namespaces work automatically
- Zero configuration needed

**To add a new resource type:**
1. Create proto: `apis/ai/stigmer/agentic/newtype/v1/spec.proto`
2. Define message: `message NewTypeSpec { ... }`
3. Run: `make codegen`
4. Generated: `sdk/go/gen/newtype/newtypespec_args.go`

## Benefits

### 1. Zero Manual Maintenance
- No schema JSONs to hand-write
- No generator updates when adding new resources
- Proto is the single source of truth

### 2. Comprehensive Coverage
- **Every** Spec message gets Args
- No more "forgot to add Args for X"
- Consistent patterns across all resources

### 3. Always Up-to-Date
- Args reflect latest proto changes automatically
- Documentation preserved from proto comments
- Validation rules extracted from buf.validate

### 4. Future-Proof
- New proto namespaces work automatically
- No code changes needed for new resource types
- Extensible to other suffixes (Status, Config, etc.)

### 5. Clean Organization
- Each namespace in its own package
- Shared types in `types/` package
- Clear import paths

## Example Usage

### In Hand-Written SDK

```go
// sdk/go/agent/agent.go
package agent

import (
    "github.com/stigmer/stigmer/sdk/go/gen/agent"
)

// Agent creates a new agent resource
func Agent(name string, args *agent.AgentArgs) (*Agent, error) {
    return &Agent{
        Metadata: &Metadata{Name: name},
        Spec:     args.ToProto(), // Generated ToProto method
    }, nil
}
```

### In User Code

```go
import (
    "github.com/stigmer/stigmer/sdk/go/agent"
    genagent "github.com/stigmer/stigmer/sdk/go/gen/agent"
)

// Create agent with Args
myAgent, err := agent.Agent("my-agent", &genagent.AgentArgs{
    Description:  "My AI assistant",
    Instructions: "Help users with coding tasks",
    McpServers: []*genagent.McpServerDefinition{
        {Name: "github", Stdio: &genagent.StdioServer{Command: "github-mcp"}},
    },
})
```

## Testing

All existing tests pass:
```bash
cd sdk/go
make test      # ✅ All tests pass
make build     # ✅ Compiles successfully
```

## Migration Path

**For existing code using old Args:**
- Old Args structs still work (backward compatible)
- Can migrate incrementally to new generated Args
- No breaking changes

**For new code:**
- Use generated Args from `sdk/go/gen/<namespace>/`
- Import shared types from `sdk/go/gen/types/`

## Future Enhancements

Potential expansions:
1. Generate Args for other suffixes (`Status`, `Config`, `Input`, `Output`)
2. Generate FromProto methods for Args
3. Generate validation helpers
4. Generate OpenAPI/JSON schemas from proto

## Files Changed

**Modified:**
- `tools/codegen/proto2schema/main.go` (+ ~150 lines)
- `tools/codegen/generator/main.go` (+ ~30 lines, - ~50 lines)
- `sdk/go/Makefile` (updated targets)

**Generated (new directories):**
- `sdk/go/gen/agentinstance/`
- `sdk/go/gen/agentexecution/`
- `sdk/go/gen/environment/`
- `sdk/go/gen/executioncontext/`
- `sdk/go/gen/workflow/` (expanded)
- `sdk/go/gen/workflowinstance/`
- `sdk/go/gen/workflowexecution/`

**Generated (new files):**
- 11 new `*_args.go` files
- 21 shared type files in `types/`

## Technical Details

### Proto Message Discovery

```go
// Scan for messages ending in "Spec"
for _, msg := range fd.GetMessageTypes() {
    if strings.HasSuffix(msg.GetName(), "Spec") {
        schema := parseTaskConfig(msg, fd)
        taskConfigs[msg.GetName()] = schema
        collectNestedTypes(msg, fd, sharedTypes)
    }
}
```

### Output Directory Resolution

```go
// Extract subdomain from proto file path
// "apis/ai/stigmer/agentic/agent/v1/spec.proto" → "agent"
func extractSubdomainFromProtoFile(protoFile string) string {
    parts := strings.Split(protoFile, "/")
    if parts[3] == "agentic" {
        return parts[4] // subdomain
    }
    return ""
}

// Generate to sdk/go/gen/<subdomain>/
outputDir := filepath.Join("sdk", "go", "gen", subdomain)
```

## Conclusion

This enhancement transforms the SDK codegen from **manual and selective** to **automatic and comprehensive**. Every proto message now gets Args structs with zero manual work, making the SDK maintainable and future-proof.

**Key Achievement:** The proto structure itself drives everything - no configuration, no hardcoding, no manual maintenance.

---

**Related:**
- Proto definitions: `apis/ai/stigmer/agentic/*/v1/spec.proto`
- Generated schemas: `tools/codegen/schemas/*/`
- Generated Args: `sdk/go/gen/*/`
- Codegen tools: `tools/codegen/proto2schema/`, `tools/codegen/generator/`
