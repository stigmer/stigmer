---
name: SDK Foundation Tasks
overview: "Complete three SDK foundation tasks: eliminate duplicate VolumeMount/PortMapping types, migrate subagent from functional options to struct args pattern, and fix codegen to emit complete FromProto implementations for arrays, maps, and floats."
todos:
  - id: codegen-fromproto
    content: "Task 3: Fix genFromProtoField in tools/codegen/generator/main.go to handle arrays, maps, and floats"
    status: completed
  - id: codegen-regenerate
    content: "Task 3: Regenerate SDK code with fixed generator"
    status: completed
  - id: volumemount-types
    content: "Task 1.2: Delete internal VolumeMount/PortMapping from mcpserver/mcpserver.go"
    status: completed
  - id: docker-update
    content: "Task 1.2: Update DockerServer to use generated types directly"
    status: completed
  - id: proto-update-docker
    content: "Task 1.2: Update agent/proto.go for pointer slice handling"
    status: completed
  - id: subagent-refactor
    content: "Task 2: Refactor subagent.go - add InlineArgs type alias, new Inline() constructor"
    status: completed
  - id: subagent-delete-opts
    content: "Task 2: Delete all functional options from subagent.go"
    status: completed
  - id: subagent-proto-update
    content: "Task 2: Update agent/proto.go convertSubAgents for new format"
    status: completed
  - id: verify-build
    content: "Final: Verify go build ./... and go vet ./... pass"
    status: completed
isProject: false
---

# SDK Foundation Tasks (1.2, 2, 3)

## Task 1.2: Eliminate VolumeMount/PortMapping Duplication

**Problem**: Internal types in [mcpserver/mcpserver.go](sdk/go/mcpserver/mcpserver.go) duplicate generated types in [gen/types/agentic_types.go](sdk/go/gen/types/agentic_types.go). The conversion code in `docker.go` is unnecessary.

**Current State**:

- Internal `VolumeMount` (lines 58-62) and `PortMapping` (lines 65-69) are field-identical to generated types
- `docker.go` lines 91-111 convert `[]*types.VolumeMount` to `[]VolumeMount` (pointless copying)
- `agent/proto.go` lines 129-147 convert back to proto (more pointless copying)

**Solution**:

1. **Delete internal types** from `mcpserver/mcpserver.go` (lines 57-69)

2. **Update DockerServer struct** in `docker.go` (line 26-35):
```go
type DockerServer struct {
    baseServer
    image           string
    args            []string
    envPlaceholders map[string]string
    volumes         []*types.VolumeMount  // was []VolumeMount
    network         string
    ports           []*types.PortMapping  // was []PortMapping
    containerName   string
}
```

3. **Simplify Docker() constructor** - remove conversion loops (lines 91-111), assign directly:
```go
server := &DockerServer{
    // ...
    volumes: args.Volumes,  // Direct assignment, no conversion
    ports:   args.Ports,    // Direct assignment, no conversion
}
```

4. **Update accessor methods** in `docker.go`:
```go
func (d *DockerServer) Volumes() []*types.VolumeMount { return d.volumes }
func (d *DockerServer) Ports() []*types.PortMapping { return d.ports }
```

5. **Update Validate()** in `docker.go` to handle pointer slices (check for nil before accessing fields)

6. **Update agent/proto.go** (lines 129-147) - conversion is simpler since we already have the right types:
```go
// Convert volume mounts - types.VolumeMount has same fields as agentv1.VolumeMount
volumes := make([]*agentv1.VolumeMount, 0, len(dockerServer.Volumes()))
for _, vol := range dockerServer.Volumes() {
    if vol != nil {
        volumes = append(volumes, &agentv1.VolumeMount{
            HostPath:      vol.HostPath,
            ContainerPath: vol.ContainerPath,
            ReadOnly:      vol.ReadOnly,
        })
    }
}
```


**Files**: `mcpserver/mcpserver.go`, `mcpserver/docker.go`, `agent/proto.go`

---

## Task 2: Migrate Subagent to Struct Args Pattern

**Problem**: `subagent` package uses functional options (`WithName`, `WithInstructions`, etc.) while rest of SDK uses struct args pattern (Pulumi-aligned).

**Current State** ([subagent/subagent.go](sdk/go/subagent/subagent.go)):

- 9 functional options (lines 39-138)
- `Inline(opts ...InlineOption)` constructor
- Generated args exist at [gen/agent/inlinesubagentspec_args.go](sdk/go/gen/agent/inlinesubagentspec_args.go) but unused

**Solution**:

1. **Add type alias** at top of `subagent.go`:
```go
import (
    genAgent "github.com/stigmer/stigmer/sdk/go/gen/agent"
    "github.com/stigmer/stigmer/sdk/go/gen/types"
)

// InlineArgs contains configuration for an inline sub-agent (Pulumi Args pattern).
type InlineArgs = genAgent.InlineSubAgentArgs
```

2. **Change SubAgent struct** - update internal field type:
```go
type SubAgent struct {
    subAgentType subAgentType
    // For inline sub-agents
    name              string
    description       string
    instructions      string
    mcpServers        []string
    mcpToolSelections map[string]*types.McpToolSelection  // was map[string][]string
    skillRefs         []*apiresource.ApiResourceReference
    // For referenced sub-agents
    agentInstanceRef string
}
```

3. **Replace Inline() constructor**:
```go
// Inline creates an inline sub-agent definition with struct args (Pulumi pattern).
//
// Example:
//
//    sub, err := subagent.Inline("code-analyzer", &subagent.InlineArgs{
//        Instructions: "Analyze code for bugs and security issues",
//        Description:  "Static code analyzer",
//        McpServers:   []string{"github"},
//    })
func Inline(name string, args *InlineArgs) (SubAgent, error) {
    if args == nil {
        args = &InlineArgs{}
    }
    
    s := SubAgent{
        subAgentType:      subAgentTypeInline,
        name:              name,
        description:       args.Description,
        instructions:      args.Instructions,
        mcpServers:        args.McpServers,
        mcpToolSelections: args.McpToolSelections,
        skillRefs:         convertSkillRefs(args.SkillRefs),
    }
    
    if err := s.Validate(); err != nil {
        return SubAgent{}, err
    }
    return s, nil
}
```

4. **Delete all functional options** (lines 35-138):

   - `InlineOption` type
   - `WithName`, `WithDescription`, `WithInstructions`
   - `WithInstructionsFromFile` (users read files themselves)
   - `WithMCPServer`, `WithMCPServers`
   - `WithToolSelection`
   - `WithSkillRef`, `WithSkillRefs`

5. **Update ToolSelections() accessor**:
```go
func (s SubAgent) ToolSelections() map[string]*types.McpToolSelection {
    return s.mcpToolSelections
}
```

6. **Add helper for skill ref conversion** (generated uses `types.ApiResourceReference`, we use `apiresource.ApiResourceReference`):
```go
func convertSkillRefs(refs []*types.ApiResourceReference) []*apiresource.ApiResourceReference {
    if refs == nil {
        return nil
    }
    result := make([]*apiresource.ApiResourceReference, len(refs))
    for i, ref := range refs {
        if ref != nil {
            result[i] = &apiresource.ApiResourceReference{
                Slug:    ref.Slug,
                Version: ref.Version,
                // Map other fields as needed
            }
        }
    }
    return result
}
```

7. **Update agent/proto.go** `convertSubAgents()` (lines 180-186) - simplified since format matches:
```go
// Tool selections already in correct format
protoSubAgents = append(protoSubAgents, &agentv1.SubAgent{
    AgentReference: &agentv1.SubAgent_InlineSpec{
        InlineSpec: &agentv1.InlineSubAgentSpec{
            Name:              sa.Name(),
            Description:       sa.Description(),
            Instructions:      sa.Instructions(),
            McpServers:        sa.MCPServerNames(),
            McpToolSelections: convertToolSelectionsToProto(sa.ToolSelections()),
            SkillRefs:         sa.SkillRefs(),
        },
    },
})
```


**Files**: `subagent/subagent.go`, `agent/proto.go`

---

## Task 3: Fix Codegen FromProto for Arrays/Maps/Floats

**Problem**: Code generator at [tools/codegen/generator/main.go](tools/codegen/generator/main.go) emits TODO placeholders for arrays, complex maps, and floats in `FromProto()` methods.

**Current State** (`genFromProtoField` function, lines 1167-1223):

- `case "array"`: emits TODO comment (line 1211-1214)
- `case "map"`: only handles `map[string]string` (line 1185-1194)
- Float types: not handled, fall through to default

**Impact**: 18 TODOs in generated code ([gen/types/agentic_types.go](sdk/go/gen/types/agentic_types.go), [gen/workflow/*.go](sdk/go/gen/workflow/))

**Solution** - Update `genFromProtoField` in `main.go`:

1. **Add float cases** (after line 1182):
```go
case "float":
    fmt.Fprintf(w, "\t\tc.%s = float32(val.GetNumberValue())\n", field.Name)

case "double":
    fmt.Fprintf(w, "\t\tc.%s = val.GetNumberValue()\n", field.Name)
```

2. **Replace array case** (lines 1210-1214) with complete implementation:
```go
case "array":
    elementType := field.Type.ElementType
    if elementType == nil {
        fmt.Fprintf(w, "\t\t// TODO: Array with unknown element type\n")
        fmt.Fprintf(w, "\t\t_ = val\n")
        break
    }
    
    switch elementType.Kind {
    case "string":
        fmt.Fprintf(w, "\t\tc.%s = make([]string, 0)\n", field.Name)
        fmt.Fprintf(w, "\t\tfor _, v := range val.GetListValue().GetValues() {\n")
        fmt.Fprintf(w, "\t\t\tc.%s = append(c.%s, v.GetStringValue())\n", field.Name, field.Name)
        fmt.Fprintf(w, "\t\t}\n")
    case "int32":
        fmt.Fprintf(w, "\t\tc.%s = make([]int32, 0)\n", field.Name)
        fmt.Fprintf(w, "\t\tfor _, v := range val.GetListValue().GetValues() {\n")
        fmt.Fprintf(w, "\t\t\tc.%s = append(c.%s, int32(v.GetNumberValue()))\n", field.Name, field.Name)
        fmt.Fprintf(w, "\t\t}\n")
    case "message":
        typeName := elementType.MessageType
        if _, isShared := c.sharedTypes[typeName]; isShared && c.packageName != "types" {
            typeName = "types." + typeName
            c.addImport("github.com/stigmer/stigmer/sdk/go/gen/types")
        }
        fmt.Fprintf(w, "\t\tc.%s = make([]*%s, 0)\n", field.Name, typeName)
        fmt.Fprintf(w, "\t\tfor _, v := range val.GetListValue().GetValues() {\n")
        fmt.Fprintf(w, "\t\t\titem := &%s{}\n", typeName)
        fmt.Fprintf(w, "\t\t\tif err := item.FromProto(v.GetStructValue()); err != nil {\n")
        fmt.Fprintf(w, "\t\t\t\treturn err\n")
        fmt.Fprintf(w, "\t\t\t}\n")
        fmt.Fprintf(w, "\t\t\tc.%s = append(c.%s, item)\n", field.Name, field.Name)
        fmt.Fprintf(w, "\t\t}\n")
    default:
        fmt.Fprintf(w, "\t\t// TODO: Array of %s type\n", elementType.Kind)
        fmt.Fprintf(w, "\t\t_ = val\n")
    }
```

3. **Enhance map case** (replace lines 1184-1194) to handle complex maps:
```go
case "map":
    if field.Type.KeyType == nil || field.Type.ValueType == nil {
        fmt.Fprintf(w, "\t\t// TODO: Map with unknown key/value type\n")
        fmt.Fprintf(w, "\t\t_ = val\n")
        break
    }
    
    if field.Type.KeyType.Kind == "string" && field.Type.ValueType.Kind == "string" {
        // Simple string-to-string map
        fmt.Fprintf(w, "\t\tc.%s = make(map[string]string)\n", field.Name)
        fmt.Fprintf(w, "\t\tfor k, v := range val.GetStructValue().GetFields() {\n")
        fmt.Fprintf(w, "\t\t\tc.%s[k] = v.GetStringValue()\n", field.Name)
        fmt.Fprintf(w, "\t\t}\n")
    } else if field.Type.KeyType.Kind == "string" && field.Type.ValueType.Kind == "message" {
        // Complex map: map[string]*MessageType
        typeName := field.Type.ValueType.MessageType
        if _, isShared := c.sharedTypes[typeName]; isShared && c.packageName != "types" {
            typeName = "types." + typeName
            c.addImport("github.com/stigmer/stigmer/sdk/go/gen/types")
        }
        fmt.Fprintf(w, "\t\tc.%s = make(map[string]*%s)\n", field.Name, typeName)
        fmt.Fprintf(w, "\t\tfor k, v := range val.GetStructValue().GetFields() {\n")
        fmt.Fprintf(w, "\t\t\titem := &%s{}\n", typeName)
        fmt.Fprintf(w, "\t\t\tif err := item.FromProto(v.GetStructValue()); err != nil {\n")
        fmt.Fprintf(w, "\t\t\t\treturn err\n")
        fmt.Fprintf(w, "\t\t\t}\n")
        fmt.Fprintf(w, "\t\t\tc.%s[k] = item\n", field.Name)
        fmt.Fprintf(w, "\t\t}\n")
    } else {
        fmt.Fprintf(w, "\t\t// TODO: Map with key=%s value=%s\n", field.Type.KeyType.Kind, field.Type.ValueType.Kind)
        fmt.Fprintf(w, "\t\t_ = val\n")
    }
```

4. **Regenerate code** after fixing generator:
```bash
cd tools/codegen && go run ./generator/...
```


**Files**: `tools/codegen/generator/main.go`, then regenerate `sdk/go/gen/**/*.go`

---

## Execution Order

1. **Task 3 first** - Fix codegen, regenerate files (provides clean foundation)
2. **Task 1.2 second** - Use generated types directly (quick win, clean up)
3. **Task 2 last** - Migrate subagent (largest change, builds on clean foundation)

## Verification

After each task:

- `go build ./...` must pass
- `go vet ./...` must pass
- Review generated code for correctness (Task 3)