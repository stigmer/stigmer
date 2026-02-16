# Simplify SDK-CLI Contract: Remove Manifest Protos

**Date**: 2026-01-22  
**Type**: Architecture Simplification  
**Impact**: Breaking Change (Pre-release)  
**Related**: SDK Code Generators Project

## What Changed

Eliminated manifest proto wrapper and SDK metadata proto in favor of direct proto writing with annotations.

## Before (Manifest Pattern)

SDKs wrapped resources in manifest protos with separate SDK metadata:

```protobuf
// manifest.proto
message AgentManifest {
  SdkMetadata sdk_metadata = 1;  // Separate metadata proto
  repeated AgentBlueprint agents = 2;  // Duplicated all AgentSpec fields
}

message SdkMetadata {
  string language = 1;
  string version = 2;
  string project_name = 3;
  int64 generated_at = 4;
  string sdk_path = 5;
  string host_environment = 6;
}

message AgentBlueprint {
  string name = 1;
  string instructions = 2;  // ← Duplicated from AgentSpec
  string description = 3;   // ← Duplicated from AgentSpec
  // ... 10+ more duplicated messages
}
```

**Problems**:
- ~400 lines of duplicated proto definitions
- Separate conversion logic in CLI (manifest → platform proto)
- Maintenance burden (two proto schemas to keep in sync)
- Cognitive overhead (developers must understand both schemas)

## After (Direct Proto Pattern)

SDKs write platform protos directly with SDK metadata in annotations:

```protobuf
// No manifest.proto needed!
Agent {
  api_version: "agentic.stigmer.ai/v1"
  kind: "Agent"
  metadata: {
    name: "my-agent"
    annotations: {
      "stigmer.ai/sdk.language": "go"
      "stigmer.ai/sdk.version": "0.1.0"
      "stigmer.ai/sdk.project-name": "my-project"
      "stigmer.ai/sdk.generated-at": "1706789123"
    }
  }
  spec: {
    instructions: "You are helpful"
  }
}
```

**Benefits**:
- ✅ Zero duplication (SDK and platform use same proto)
- ✅ No conversion logic (CLI reads what SDK writes)
- ✅ Standard Kubernetes annotation pattern
- ✅ ~400 lines of proto removed
- ✅ Simpler mental model (one schema, not two)

## Files Deleted

- ❌ `apis/ai/stigmer/agentic/agent/v1/manifest.proto` (308 lines)
- ❌ `apis/ai/stigmer/agentic/workflow/v1/manifest.proto` (43 lines)
- ❌ `apis/ai/stigmer/commons/sdk/metadata.proto` (91 lines)
- ❌ `apis/ai/stigmer/agentic/agent/v1/manifest-guide.md` (446 lines)

**Total**: ~888 lines removed, zero functionality lost.

## Files Created

- ✅ `apis/ai/stigmer/agentic/SDK-CONTRACT.md` - Comprehensive guide

## Architecture

### Old Flow (Manifest Pattern)

```
User Code → SDK → AgentManifest.pb → CLI Converts → Agent proto → Platform
                  ↑ Wrapper layer       ↑ Conversion logic
```

### New Flow (Direct Pattern)

```
User Code → SDK → Agent.pb → CLI Enriches → Platform
                  ↑ Platform proto (no conversion!)
```

CLI enrichment adds platform-managed fields:
- `metadata.id` (generated)
- `metadata.org` (from context)
- `metadata.owner_scope` (from context)
- `status.audit` (created/updated timestamps)

## SDK Metadata Mapping

| Old (SdkMetadata) | New (Annotations) |
|---|---|
| `language` | `stigmer.ai/sdk.language` |
| `version` | `stigmer.ai/sdk.version` |
| `project_name` | `stigmer.ai/sdk.project-name` |
| `generated_at` | `stigmer.ai/sdk.generated-at` |
| `sdk_path` | `stigmer.ai/sdk.path` |
| `host_environment` | `stigmer.ai/sdk.host-environment` |

## Resource Support

All SDK-creatable resources follow this pattern:

- ✅ **Agent** - `apis/ai/stigmer/agentic/agent/v1/api.proto`
- ✅ **Workflow** - `apis/ai/stigmer/agentic/workflow/v1/api.proto`
- ✅ **Skill** - `apis/ai/stigmer/agentic/skill/v1/api.proto`

Future resources (MCP servers, connectors, etc.) will follow the same pattern.

## Migration Guide

### For SDK Developers

**Before**:
```go
// Old: Write manifest wrapper
manifest := &agentv1.AgentManifest{
    SdkMetadata: &sdkpb.SdkMetadata{
        Language: "go",
        Version:  "0.1.0",
    },
    Agents: []*agentv1.AgentBlueprint{
        {
            Name:         "my-agent",
            Instructions: "...",
        },
    },
}
WriteManifest("agent-manifest.pb", manifest)
```

**After**:
```go
// New: Write Agent proto directly
agent := &agentv1.Agent{
    ApiVersion: "agentic.stigmer.ai/v1",
    Kind:       "Agent",
    Metadata: &apiresource.ApiResourceMetadata{
        Name: "my-agent",
        Annotations: map[string]string{
            "stigmer.ai/sdk.language": "go",
            "stigmer.ai/sdk.version":  "0.1.0",
        },
    },
    Spec: &agentv1.AgentSpec{
        Instructions: "...",
    },
}
WriteProto("agent.pb", agent)
```

### For CLI Developers

**Before**:
```go
// Old: Read manifest, convert to Agent
manifest := readManifest("agent-manifest.pb")
agent := convertManifestToAgent(manifest.Agents[0])  // Conversion logic!
platform.CreateAgent(agent)
```

**After**:
```go
// New: Read Agent directly, enrich, deploy
agent := readAgent("agent.pb")  // No conversion!
enrichMetadata(agent)           // Add platform fields
platform.CreateAgent(agent)
```

## Impact Assessment

### Breaking Changes

- ❌ Old manifest-based SDKs incompatible (pre-release, no users yet)
- ❌ Generated stubs will change (regenerate after proto deletion)

### Non-Breaking

- ✅ Platform protos unchanged (Agent, Workflow, Skill)
- ✅ CLI commands unchanged (user-facing CLI interface same)
- ✅ Platform backend unchanged (receives same Agent protos)

## Rationale

### Why Remove Manifest Layer?

1. **Duplication is Evil**
   - `AgentBlueprint` duplicated all `AgentSpec` fields
   - `ManifestMcpServer` duplicated `McpServerDefinition`
   - 10+ messages duplicated across manifest and platform protos
   - Two schemas to maintain, prone to drift

2. **Conversion is Overhead**
   - CLI had to convert manifest → platform proto
   - Conversion logic tested separately
   - Extra failure points in pipeline

3. **Cognitive Load**
   - Developers had to learn two schemas
   - "Which proto should I use?" confusion
   - Documentation duplication

4. **Annotations are Standard**
   - Kubernetes uses annotations for metadata
   - Well-understood pattern
   - No special proto needed

### Why Not Keep It?

**Original Justification**: "Separate SDK from platform proto schema"

**Reality**: If SDK writes platform protos anyway (as we agreed), there's no benefit to wrapping them. The manifest layer was pure overhead.

**Decision**: Use annotations for SDK metadata (Kubernetes-style) and write platform protos directly.

## Skills Handling

Skills are now **always separate API resources** (no inline definitions):

```go
// SDK creates Skill resource
skill := &skillv1.Skill{
    Metadata: &apiresource.ApiResourceMetadata{
        Name: "coding-standards",
        Annotations: map[string]string{
            "stigmer.ai/sdk.language": "go",
            "stigmer.ai/sdk.version":  "0.1.0",
        },
    },
    Spec: &skillv1.SkillSpec{
        Description:      "Company coding standards",
        MarkdownContent:  "# Standards\n...",
    },
}

// Agent references skill by name
agent := &agentv1.Agent{
    Spec: &agentv1.AgentSpec{
        SkillRefs: []*apiresource.ApiResourceReference{
            {Kind: 43, Name: "coding-standards"},  // Reference existing skill
        },
    },
}
```

No inline skill creation - skills are first-class resources.

## Testing

### Generated Stubs

After proto deletion, regenerate stubs:

```bash
cd apis
make protos
```

**Expected**:
- ❌ `manifest.pb.go` files removed
- ❌ `metadata.pb.go` removed
- ✅ Agent/Workflow/Skill protos unchanged

### SDK Integration

Update SDK to:
1. Create platform protos directly
2. Add SDK annotations to `metadata.annotations`
3. Write proto files without manifest wrapper

### CLI Integration

Update CLI to:
1. Read platform protos directly
2. Extract SDK metadata from annotations
3. Enrich with platform fields
4. Deploy without conversion

## Future Work

### Short Term

- Update Go SDK to use direct proto pattern
- Update Python SDK to use direct proto pattern
- Remove manifest conversion logic from CLI

### Long Term

- Create SDK helper libraries for annotation management
- Add CLI validation for SDK annotations
- Add SDK version compatibility checking

## Related Changes

- **SDK Code Generators Project**: Update to generate code for platform protos directly
- **CLI**: Remove manifest conversion logic
- **Documentation**: Update SDK guides to show direct proto usage

## References

- **New Contract**: `apis/ai/stigmer/agentic/SDK-CONTRACT.md`
- **Deleted Protos**: See git history for manifest.proto files
- **Kubernetes Annotations**: https://kubernetes.io/docs/concepts/overview/working-with-objects/annotations/

---

**Summary**: Eliminated ~400 lines of duplicated proto definitions by using platform protos directly with SDK metadata in annotations. Zero functionality lost, massive complexity reduction.
