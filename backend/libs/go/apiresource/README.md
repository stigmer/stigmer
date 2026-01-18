# API Resource Metadata Utilities

This package provides utilities for working with API resource metadata extracted from proto enum options.

## Purpose

Instead of passing string literals like `"Agent"` or `"agt"` throughout the codebase, this package allows you to:

1. Use the strongly-typed `ApiResourceKind` enum
2. Extract metadata (ID prefix, name, display name) from proto enum options
3. Maintain a single source of truth (the proto definitions)

## Architecture Alignment

This aligns the Go backend with the Java implementation, which already uses proto options to extract metadata:

**Java:**
```java
ApiResourceRef agentRef = ApiResourceRef.newBuilder()
        .setKind(ApiResourceKind.agent.name())  // Uses enum
        .setId(agentId)
        .build();
```

**Go (now):**
```go
kind := apiresourcekind.ApiResourceKind_agent
meta, _ := apiresource.GetKindMeta(kind)
// meta.IdPrefix == "agt"
// meta.Name == "Agent"
```

## Usage

### Get Enum from Message

```go
agent := &agentv1.Agent{Kind: "Agent"}
kind, err := apiresource.GetKindEnum(agent)
// kind == apiresourcekind.ApiResourceKind_agent
```

### Get Metadata from Enum

```go
meta, err := apiresource.GetKindMeta(apiresourcekind.ApiResourceKind_agent)
// meta.IdPrefix == "agt"
// meta.Name == "Agent"
// meta.DisplayName == "Agent"
// meta.Group == apiresourcekind.ApiResourceGroup_agentic
```

### Convenience Methods

```go
// Get just the ID prefix
prefix, err := apiresource.GetIdPrefix(apiresourcekind.ApiResourceKind_agent)
// prefix == "agt"

// Get just the name
name, err := apiresource.GetKindName(apiresourcekind.ApiResourceKind_agent)
// name == "Agent"

// Get just the display name
displayName, err := apiresource.GetDisplayName(apiresourcekind.ApiResourceKind_agent)
// displayName == "Agent"
```

## Benefits

1. **Type Safety**: Use enums instead of strings
2. **Single Source of Truth**: Metadata comes from proto definitions
3. **No Manual Maintenance**: When proto metadata changes, code automatically picks it up
4. **Consistency**: Same pattern as Java implementation
5. **Future-Proof**: New kinds automatically supported

## Example: Before and After

### Before (Hard-coded strings)

```go
pipeline := pipeline.NewPipeline[*agentv1.Agent]("agent-create").
    AddStep(steps.NewCheckDuplicateStep[*agentv1.Agent](c.store, "Agent")).
    AddStep(steps.NewSetDefaultsStep[*agentv1.Agent]("agt")).
    AddStep(steps.NewPersistStep[*agentv1.Agent](c.store, "Agent")).
    Build()
```

### After (Enum-based)

```go
kind := apiresourcekind.ApiResourceKind_agent

pipeline := pipeline.NewPipeline[*agentv1.Agent]("agent-create").
    AddStep(steps.NewCheckDuplicateStep[*agentv1.Agent](c.store, kind)).
    AddStep(steps.NewSetDefaultsStep[*agentv1.Agent](kind)).
    AddStep(steps.NewPersistStep[*agentv1.Agent](c.store, kind)).
    Build()
```

The steps internally use `apiresource.GetIdPrefix(kind)` and `apiresource.GetKindName(kind)` to extract the needed values.

## Proto Options

The metadata is defined in the proto file with enum value options:

```protobuf
enum ApiResourceKind {
  agent = 40 [(kind_meta) = {
    group: agentic
    version: v1
    name: "Agent"
    display_name: "Agent"
    id_prefix: "agt"
    is_versioned: false
    not_search_indexed: false
    tier: TIER_OPEN_SOURCE
  }];
}
```

This metadata is automatically accessible in Go via proto reflection and the `E_KindMeta` extension.
