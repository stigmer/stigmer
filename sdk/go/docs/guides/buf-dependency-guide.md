# Buf Schema Registry Dependency Guide

## Summary

The Stigmer SDK Go module has been updated to use Buf Schema Registry instead of GitHub for proto dependencies.

**Migration Date**: 2026-01-13  
**Buf Module**: `buf.build/leftbin/stigmer`  
**Go Module**: `buf.build/gen/go/leftbin/stigmer/protocolbuffers/go`  
**Version**: `v1.36.11-20260113100504-8218a0bea17c.1`  
**Commit**: `8218a0bea17c47e48f5236b3c5e277d3`

## Changes Made

### 1. Removed GitHub Dependency

**Before**:
```go
require github.com/leftbin/stigmer/apis/stubs/go v0.0.0-00010101000000-000000000000

replace github.com/leftbin/stigmer/apis/stubs/go => /Users/suresh/scm/github.com/leftbin/stigmer/apis/stubs/go/github.com/leftbin/stigmer/apis/stubs/go
```

**After**:
```go
require buf.build/gen/go/leftbin/stigmer/protocolbuffers/go v1.36.11-20260113100504-8218a0bea17c.1
```

### 2. Updated Test Files

Removed unused proto imports from `mcpserver/mcpserver_test.go` that were leftover from the proto-coupled design.

### 3. All Tests Passing

```bash
$ go test ./...
?   	github.com/leftbin/stigmer-sdk/go	[no test files]
ok  	github.com/leftbin/stigmer-sdk/go/agent	(cached)
ok  	github.com/leftbin/stigmer-sdk/go/environment	(cached)
ok  	github.com/leftbin/stigmer-sdk/go/mcpserver	0.756s
ok  	github.com/leftbin/stigmer-sdk/go/skill	(cached)
ok  	github.com/leftbin/stigmer-sdk/go/subagent	(cached)
```

## Import Path Reference for Task 3

When implementing Task 3 (Synthesis Architecture), use these import paths:

### Agent Manifest

```go
import agentv1 "buf.build/gen/go/leftbin/stigmer/protocolbuffers/go/ai/stigmer/agentic/agent/v1"

// Usage:
manifest := &agentv1.AgentManifest{
    SdkMetadata: &sdk.SdkMetadata{
        Language: "go",
        Version:  "0.1.0",
    },
    Agent: &agentv1.AgentBlueprint{
        Name:         "my-agent",
        Instructions: "You are a helpful assistant",
        // ... more fields
    },
}
```

### SDK Metadata (Commons)

```go
import sdk "buf.build/gen/go/leftbin/stigmer/protocolbuffers/go/ai/stigmer/commons/sdk"

// Usage:
metadata := &sdk.SdkMetadata{
    Language:        "go",
    Version:         "0.1.0",
    GeneratedAtUnix: time.Now().Unix(),
}
```

## Key Proto Messages for Task 3

From `manifest.proto`:

1. **`AgentManifest`** - Top-level SDK-CLI contract
   - `sdk_metadata`: Metadata about SDK that generated manifest
   - `agent`: The agent blueprint

2. **`AgentBlueprint`** - Agent configuration collected by SDK
   - `name`: Agent name
   - `instructions`: Agent instructions
   - `skills`: List of skills
   - `mcp_servers`: List of MCP servers
   - `sub_agents`: List of sub-agents
   - `environment_variables`: List of environment variables

3. **`SkillDefinition`** - Skill configuration
   - `name`: Skill name
   - `instructions`: Skill instructions
   - `markdown`: Skill markdown content
   - `owner_scope`: Owner scope (platform/repository/inline)

4. **`McpServerDefinition`** - MCP server configuration
   - Server type (stdio/http/docker)
   - Configuration fields per type
   - Enabled tools

5. **`SubAgentDefinition`** - Sub-agent configuration
   - `name`: Sub-agent name
   - `instructions`: Sub-agent instructions

6. **`EnvironmentVariableDefinition`** - Environment variable configuration
   - `key`: Variable key
   - `value`: Variable value
   - `value_from_secret`: Secret reference

## Updating to Latest Version

To get the latest version from Buf:

```bash
# Check latest commit in Buf registry
buf registry module commit list buf.build/leftbin/stigmer --format json | jq -r '.commits[0].commit'

# Update Go module to latest
go get buf.build/gen/go/leftbin/stigmer/protocolbuffers/go@latest
go mod tidy
```

## Verifying Installation

```bash
# List installed version
go list -m buf.build/gen/go/leftbin/stigmer/protocolbuffers/go

# Check module location
go list -m -f '{{.Dir}}' buf.build/gen/go/leftbin/stigmer/protocolbuffers/go
```

## Benefits of Buf Schema Registry

1. **Versioned Proto Definitions**: Each commit has a unique version
2. **Automatic Code Generation**: Go, Python, TypeScript stubs auto-generated
3. **Public Access**: Anyone can use `buf.build/leftbin/stigmer`
4. **No Build Required**: Pre-generated stubs, no need to run protoc
5. **Semantic Versioning**: Based on protobuf version + timestamp + commit hash

## Next Steps (Task 3)

With the Buf dependency in place, Task 3 can now proceed:

1. **Create `internal/registry`** - Global agent registry singleton
2. **Create `internal/synth`** - Auto-synthesis hook (defer pattern)
3. **Create `internal/synth/converter`** - SDK → Manifest proto converter
   - Use `buf.build/gen/go/leftbin/stigmer/protocolbuffers/go/ai/stigmer/agentic/agent/v1`
   - Convert SDK types to `AgentManifest` proto
   - Write `manifest.pb` file
4. **Update agent constructor** - Register agent with global registry
5. **Implement `defer synth.AutoSynth()`** - Auto-write manifest on exit

## Related Files

- **go.mod**: Updated dependency declaration
- **go.sum**: Checksum verification
- **mcpserver/mcpserver_test.go**: Cleaned up unused proto imports

## Troubleshooting

If you encounter module resolution issues:

```bash
# Clear module cache
go clean -modcache

# Re-download dependencies
go mod download
go mod tidy

# Verify all tests pass
go test ./...
```

---

**Status**: ✅ Task 2 Complete - Ready for Task 3 (Synthesis Architecture)
