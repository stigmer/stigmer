---
name: T08 Workflow Codegen
overview: Generate workflow MCP input types, add enum and struct support to the codegen pipeline, make all toProto() methods return errors, add Makefile target, and clean up dead code.
todos:
  - id: p1-proto2schema-enum
    content: Add EnumType to TypeSpec in proto2schema, extract enum FQN, re-run for workflow schemas
    status: completed
  - id: p2-generator-struct-enum
    content: Add struct (map[string]any) and enum field handling to MCP generator resolveField + genFieldAssignment
    status: completed
  - id: p3-generator-error-toproto
    content: Change all genTopLevelToProto, genNestedToProto, genRefToProto, genFieldAssignment to emit error-returning toProto()
    status: completed
  - id: p4-regenerate-all
    content: Regenerate agent, mcpserver, and workflow (new) input types; verify compilation
    status: completed
  - id: p5-update-handlers
    content: Update agents, mcpservers, workflows handlers to handle ToProto() errors; rewrite workflow Apply signature
    status: completed
  - id: p6-update-tests
    content: Update convert_test.go, apply_tool_test.go for all three domains to handle (proto, error) returns
    status: completed
  - id: p7-makefile
    content: Add codegen-mcp target to mcp-server/Makefile
    status: completed
  - id: p8-cleanup
    content: Remove CallApply/ApplyFunc, ResourceIdentity (input.go), dead CallApply tests; check UnmarshalJSON
    status: completed
  - id: p9-validate
    content: Run go test -race ./... and go vet ./... across all packages
    status: completed
isProject: false
---

# T08: Workflow Codegen + toProto Error Propagation + Makefile

## Context

Agents and McpServers already use generated input types with `ToProto()` (from T07). Workflows still use the old raw-JSON pattern (`ApplyWorkflowInput{Resource string}`). This task migrates workflows to the generated pattern, but also fixes two foundational gaps discovered during investigation:

- **Enum fields**: `WorkflowTask.kind` is a proto enum (`WorkflowTaskKind`), but `proto2schema` loses the enum type info (maps to `"string"`). The MCP generator has no way to emit enum conversion code.
- **Error propagation**: All `toProto()` methods currently return only the proto (no error). `structpb.NewStruct()` for the `task_config` field can fail. Rather than hack around it, we fix the pattern: all `toProto()` return `(proto, error)`.

## Ripple Analysis

Changing `toProto()` to return errors affects:

- Generator output for all 3 domains (agent, mcpserver, workflow)
- `agents/tools.go` ApplyHandler (calls `input.ToProto()`)
- `mcpservers/tools.go` ApplyHandler (calls `input.ToProto()`)
- `workflows/tools.go` ApplyHandler (new, calls `input.ToProto()`)
- `agents/convert_test.go` (12+ call sites of `input.ToProto()`)
- `agents/apply_tool_test.go`, `mcpservers/apply_tool_test.go`, `workflows/apply_tool_test.go`

---

## Part 1: proto2schema — Enum Type Extraction

**File**: [tools/codegen/proto2schema/main.go](tools/codegen/proto2schema/main.go)

Add an `EnumType` field to the `TypeSpec` struct:

```go
type TypeSpec struct {
    Kind        string    `json:"kind"`
    // ... existing fields ...
    EnumType    string    `json:"enumType,omitempty"` // fully-qualified proto enum type
}
```

Update `extractScalarTypeSpec` (currently line 673):

```go
case descriptorpb.FieldDescriptorProto_TYPE_ENUM:
    enumType := field.GetEnumType()
    fqn := fmt.Sprintf("%s.%s", enumType.GetFile().GetPackage(), enumType.GetName())
    return TypeSpec{Kind: "string", EnumType: fqn}
```

Then re-run proto2schema for workflow to regenerate `workflowtask.json` with the `enumType` annotation on the `kind` field. The resulting schema should have:

```json
"type": {"kind": "string", "enumType": "ai.stigmer.agentic.workflow.v1.WorkflowTaskKind"}
```

Mirror the `EnumType` field addition in `generator/main.go`'s `TypeSpec` struct so the generator can read it.

---

## Part 2: Generator — Struct + Enum Field Support

**File**: [tools/codegen/generator/mcp.go](tools/codegen/generator/mcp.go)

### 2a: Struct type in resolveField

Add a case before the default in `resolveField` (around line 195):

```go
case f.Type.Kind == "struct":
    field.goType = "map[string]any"
```

No `inputTypeName` — struct fields are leaf values (no nested `toProto()`).

### 2b: Enum type tracking

Add `enumType` field to `mcpInputField` struct. In `resolveField`, after building the field, propagate it:

```go
field.enumType = f.Type.EnumType
```

### 2c: Struct field assignment in genFieldAssignment

When a field has `goType == "map[string]any"` (struct), emit:

```go
if len(input.TaskConfig) > 0 {
    v, err := structpb.NewStruct(input.TaskConfig)
    if err != nil {
        return nil, fmt.Errorf("marshal %s: %%w", err)
    }
    result.TaskConfig = v
}
```

This requires adding the `structpb` import.

### 2d: Enum field assignment in genFieldAssignment

When a field has `enumType != ""`, emit:

```go
result.Kind = workflowv1.WorkflowTaskKind(workflowv1.WorkflowTaskKind_value[input.Kind])
```

The generator derives the Go package alias and enum type name from the fully-qualified `enumType` string using the existing `protoTypeToGoImportPath` / `protoTypeToPackageAlias` helpers. It also needs to import the enum's package.

---

## Part 3: Generator — Error-Returning toProto()

**File**: [tools/codegen/generator/mcp.go](tools/codegen/generator/mcp.go)

### 3a: Top-level ToProto

Change `genTopLevelToProto` to emit:

```go
func (input *WorkflowInput) ToProto() (*workflowv1.Workflow, error) {
    // ...
    spec, err := input.specToProto()
    if err != nil {
        return nil, err
    }
    return &workflowv1.Workflow{..., Spec: spec}, nil
}

func (input *WorkflowInput) specToProto() (*workflowv1.WorkflowSpec, error) {
    spec := &workflowv1.WorkflowSpec{}
    // field assignments with error handling...
    return spec, nil
}
```

### 3b: Nested toProto

Change `genNestedToProto` to emit:

```go
func (input *WorkflowTaskInput) toProto() (*workflowv1.WorkflowTask, error) {
    result := &workflowv1.WorkflowTask{}
    // ...
    return result, nil
}
```

### 3c: Reference toProto

Change `genRefToProto` to emit error returns too (even though refs can't fail today — consistency matters):

```go
func (input *SkillRefInput) toProto() (*apiresource.ApiResourceReference, error) {
    return &apiresource.ApiResourceReference{...}, nil
}
```

### 3d: Field assignment error propagation

In `genFieldAssignment`, when calling a nested `toProto()`:

- **Pointer field**: `if input.EnvSpec != nil { v, err := input.EnvSpec.toProto(); if err != nil { return nil, err }; result.EnvSpec = v }`
- **Slice field**: `for _, item := range input.Tasks { v, err := item.toProto(); if err != nil { return nil, err }; result.Tasks = append(result.Tasks, v) }`
- **Map field**: Same pattern with error check per entry
- **Value struct** (e.g., required ref): `v, err := input.McpServerRef.toProto(); if err != nil { return nil, err }; result.McpServerRef = v`

Also add `"fmt"` import for the `fmt.Errorf` in struct field conversion.

---

## Part 4: Regenerate All Domains

Run the generator for all three domains to get consistent error-returning code:

```bash
# Agent
go run ./tools/codegen/generator/ --schema-dir=tools/codegen/schemas/agentic/agent \
  --output-dir=mcp-server/gen/agent --package=agent --target=mcp

# McpServer
go run ./tools/codegen/generator/ --schema-dir=tools/codegen/schemas/agentic/mcpserver \
  --output-dir=mcp-server/gen/mcpserver --package=mcpserver --target=mcp

# Workflow (new)
go run ./tools/codegen/generator/ --schema-dir=tools/codegen/schemas/agentic/workflow \
  --output-dir=mcp-server/gen/workflow --package=workflow --target=mcp
```

After generation, verify all three compile: `cd mcp-server && go build ./...`

---

## Part 5: Update Domain Handlers

### 5a: agents/tools.go — ApplyHandler

```go
agent, err := input.ToProto()
if err != nil {
    return nil, nil, err
}
```

### 5b: mcpservers/tools.go — ApplyHandler

Same pattern as agents.

### 5c: workflows/apply.go — Change signature

Change from `Apply(ctx, serverAddress, resourceJSON string)` to `Apply(ctx, serverAddress string, workflow *workflowv1.Workflow)` — matching the agent/mcpserver pattern. Remove `domains.UnmarshalJSON` call.

### 5d: workflows/tools.go — ApplyHandler

Replace `ApplyWorkflowInput{Resource string}` + `domains.CallApply` with the generated `WorkflowInput` + `ToProto()` pattern (matching agents/mcpservers).

---

## Part 6: Update Tests

- **agents/convert_test.go**: All `input.ToProto()` calls need `agent, err := input.ToProto()` with error check
- **agents/apply_tool_test.go**: Same
- **mcpservers/apply_tool_test.go**: Same (if it exists, check)
- **workflows/apply_tool_test.go**: Rewrite to use generated input type

---

## Part 7: Makefile Target

**File**: [mcp-server/Makefile](mcp-server/Makefile)

Add a `codegen-mcp` target:

```makefile
codegen-mcp:
	go run ../tools/codegen/generator/ --schema-dir=../tools/codegen/schemas/agentic/agent --output-dir=gen/agent --package=agent --target=mcp
	go run ../tools/codegen/generator/ --schema-dir=../tools/codegen/schemas/agentic/mcpserver --output-dir=gen/mcpserver --package=mcpserver --target=mcp
	go run ../tools/codegen/generator/ --schema-dir=../tools/codegen/schemas/agentic/workflow --output-dir=gen/workflow --package=workflow --target=mcp
```

---

## Part 8: Dead Code Cleanup

- `**mcp-server/internal/domains/toolresult.go**`: Remove `ApplyFunc` type and `CallApply` function (only workflow used them)
- `**mcp-server/internal/domains/toolresult_test.go**`: Remove `TestCallApply_*` tests
- `**mcp-server/internal/domains/input.go**`: Delete entirely — `ResourceIdentity` is confirmed dead code (not referenced by any package)
- Check if `domains.UnmarshalJSON` becomes dead code after workflow migration; if so, remove it too

---

## Part 9: Final Validation

```bash
cd mcp-server && go test -race ./...
```

All 12+ packages must pass. Then `go vet ./...` for cleanliness.

---

## Key Files Changed


| Area              | Files                                                                                                                              |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| proto2schema      | `tools/codegen/proto2schema/main.go`                                                                                               |
| Generator         | `tools/codegen/generator/mcp.go`, `tools/codegen/generator/main.go` (TypeSpec)                                                     |
| Generated         | `mcp-server/gen/agent/agent_gen.go`, `mcp-server/gen/mcpserver/mcp_server_gen.go`, `mcp-server/gen/workflow/workflow_gen.go` (new) |
| Agents domain     | `agents/tools.go`, `agents/convert_test.go`, `agents/apply_tool_test.go`                                                           |
| McpServers domain | `mcpservers/tools.go`, `mcpservers/apply_tool_test.go`                                                                             |
| Workflows domain  | `workflows/tools.go`, `workflows/apply.go`, `workflows/apply_tool_test.go`                                                         |
| Shared            | `domains/toolresult.go`, `domains/toolresult_test.go`, `domains/input.go` (delete)                                                 |
| Makefile          | `mcp-server/Makefile`                                                                                                              |


