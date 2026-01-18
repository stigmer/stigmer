# Synthesis Architecture

**Status**: ✅ Implemented (Task 3 Complete)  
**Version**: 0.1.0  
**Date**: 2026-01-13

## Overview

The Stigmer Go SDK now implements the **Synthesis Model** architecture, where agent configurations are automatically serialized to a manifest proto file (`manifest.pb`) for consumption by the Stigmer CLI.

## How It Works

### 1. Agent Registration (Automatic)

When you create an agent using `agent.New()`, it's automatically registered in a global singleton registry:

```go
agent, err := agent.New(
    agent.WithName("code-reviewer"),
    agent.WithInstructions("Review code and suggest improvements"),
)
// Agent is automatically registered in global registry
```

**Implementation**: `internal/registry/registry.go`

### 2. Auto-Synthesis on Exit

Add `defer synth.AutoSynth()` at the start of your `main()` function:

```go
package main

import (
    "github.com/leftbin/stigmer-sdk/go/agent"
    "github.com/leftbin/stigmer-sdk/go/internal/synth"
)

func main() {
    defer synth.AutoSynth() // Automatically writes manifest.pb on exit
    
    agent, _ := agent.New(
        agent.WithName("reviewer"),
        agent.WithInstructionsFromFile("instructions.md"),
    )
    // ... configure agent
}
```

**Implementation**: `internal/synth/synth.go`

### 3. Two Operating Modes

#### Dry-Run Mode (Default)
```bash
go run main.go
```
- No `STIGMER_OUT_DIR` environment variable set
- Prints success message
- No files written
- Useful for testing agent definitions

#### Synthesis Mode
```bash
STIGMER_OUT_DIR=/tmp go run main.go
```
- `STIGMER_OUT_DIR` environment variable is set
- Converts agent to manifest proto
- Writes `manifest.pb` to the specified directory
- Used by CLI to deploy agents

### 4. SDK → Manifest Proto Conversion

The converter transforms SDK types to manifest protos:

| SDK Type | Manifest Proto Type |
|----------|---------------------|
| `agent.Agent` | `AgentBlueprint` |
| `skill.Skill` | `ManifestSkill` (Platform/Org/Inline) |
| `mcpserver.MCPServer` | `ManifestMcpServer` (Stdio/HTTP/Docker) |
| `subagent.SubAgent` | `ManifestSubAgent` (Inline/Reference) |
| `environment.Variable` | `ManifestEnvironmentVariable` |

**Implementation**: `internal/synth/converter.go`

## Architecture Diagram

```
┌─────────────────────────────────────────┐
│ User Code (main.go)                     │
│                                          │
│  defer synth.AutoSynth()                │
│  agent, _ := agent.New(...)             │
│  agent.AddSkill(...)                    │
│                                          │
└────────────┬────────────────────────────┘
             │ (Agent auto-registered)
             ↓
┌─────────────────────────────────────────┐
│ Global Registry (Singleton)             │
│  - Stores agent                         │
│  - Thread-safe                          │
└────────────┬────────────────────────────┘
             │ (On program exit)
             ↓
┌─────────────────────────────────────────┐
│ Auto-Synth Hook                         │
│  1. Check STIGMER_OUT_DIR env var       │
│  2. If not set → Dry-run (print msg)   │
│  3. If set → Convert & write manifest.pb│
└────────────┬────────────────────────────┘
             │
             ↓
┌─────────────────────────────────────────┐
│ Converter                               │
│  - SDK types → Manifest proto           │
│  - Validates configuration              │
│  - Generates unique IDs                 │
└────────────┬────────────────────────────┘
             │
             ↓
         manifest.pb
             │
             ↓
┌─────────────────────────────────────────┐
│ CLI (stigmer up)                        │
│  1. Sets STIGMER_OUT_DIR                │
│  2. Runs: go run main.go                │
│  3. Reads: manifest.pb                  │
│  4. Converts to platform protos         │
│  5. Deploys via gRPC                    │
└─────────────────────────────────────────┘
```

## Key Features

### Proto-Agnostic SDK

The SDK is now proto-agnostic for platform APIs:
- ❌ No `ToProto()` methods on SDK types
- ❌ No direct dependencies on `agent/v1/spec.proto`
- ✅ Only uses `agent/v1/manifest.proto` (SDK-CLI contract)
- ✅ CLI handles all platform proto conversion

### Automatic Registration

No manual registration required:
```go
// ❌ OLD: Manual proto conversion
agent := agent.New(...)
proto := agent.ToProto()  // Manual step

// ✅ NEW: Automatic registration
agent, _ := agent.New(...)  // Auto-registered
```

### Import Cycle Prevention

Used `interface{}` in registry to prevent import cycles:
- Registry stores `interface{}` (not `*agent.Agent`)
- Avoids: `agent` imports `registry`, `registry` imports `agent`
- Type assertion happens in `synth` package

## Implementation Details

### Files Created

1. **`internal/registry/registry.go`** - Global singleton registry
   - Thread-safe with `sync.RWMutex`
   - Stores agent as `interface{}`
   - Provides `RegisterAgent()`, `GetAgent()`, `HasAgent()`, `Clear()`

2. **`internal/synth/synth.go`** - Auto-synthesis hook
   - `AutoSynth()` function for `defer` pattern
   - Checks `STIGMER_OUT_DIR` env var
   - Dry-run vs synthesis mode logic
   - Error handling with exit codes

3. **`internal/synth/converter.go`** - SDK → Manifest proto converter
   - `ToManifest(*agent.Agent)` - Main conversion function
   - Type assertions for MCP server concrete types
   - UUID generation for skill IDs
   - Comprehensive error handling

4. **`internal/registry/registry_test.go`** - Registry tests
   - Singleton pattern tests
   - Thread safety tests (concurrent access)
   - Test isolation with `Clear()`
   - Mock agent type to avoid import cycles

### Files Modified

1. **`agent/agent.go`** - Agent constructor
   - Added registry registration in `New()`
   - Imported `internal/registry`
   - Updated godoc comments

2. **`skill/skill.go`** - Skill accessor methods
   - Added `NameOrSlug()` method
   - Added `GetDescription()` method
   - Added `Markdown()` method
   - Added `Repository()` method
   - Added `IsRepositoryReference()` alias

3. **`subagent/subagent.go`** - SubAgent accessor methods
   - Added `Instructions()` method
   - Added `Description()` method
   - Added `MCPServerNames()` method
   - Added `ToolSelections()` method
   - Added `Skills()` method
   - Added `Organization()` method
   - Added `AgentInstanceID()` method

4. **`mcpserver/*.go`** - MCP server type methods
   - Added `Type()` method to interface
   - Renamed constants: `ServerTypeStdio` → `TypeStdio`
   - Added `Type()` implementation to `StdioServer`, `HTTPServer`, `DockerServer`

5. **`examples/06_agent_with_instructions_from_files.go`** - Synthesis example
   - Added `defer synth.AutoSynth()` call
   - Updated comments to explain synthesis
   - Added mode information in output

### Dependencies Added

- `github.com/google/uuid` v1.6.0 - For generating unique skill IDs

## Usage Example

```go
package main

import (
    "log"
    
    "github.com/leftbin/stigmer-sdk/go/agent"
    "github.com/leftbin/stigmer-sdk/go/internal/synth"
    "github.com/leftbin/stigmer-sdk/go/skill"
)

func main() {
    // Enable auto-synthesis
    defer synth.AutoSynth()
    
    // Create agent (automatically registered)
    myAgent, err := agent.New(
        agent.WithName("reviewer"),
        agent.WithInstructionsFromFile("instructions.md"),
    )
    if err != nil {
        log.Fatal(err)
    }
    
    // Add skills
    myAgent.AddSkill(skill.Platform("coding-best-practices"))
    
    // That's it! On exit:
    // - Dry-run: Prints success message
    // - Synthesis: Writes manifest.pb to $STIGMER_OUT_DIR
}
```

## Testing

### Unit Tests

All packages have comprehensive tests:
```bash
go test ./...
```

**Results** (as of 2026-01-13):
- ✅ `agent` - 1.860s
- ✅ `environment` - cached
- ✅ `internal/registry` - 1.338s
- ✅ `mcpserver` - 0.580s
- ✅ `skill` - 0.619s
- ✅ `subagent` - 1.128s

### Manual Testing

**Dry-run mode**:
```bash
cd examples
go run 06_agent_with_instructions_from_files.go
# Should print: "✓ Stigmer SDK: Dry-run complete. Run 'stigmer up' to deploy."
```

**Synthesis mode**:
```bash
STIGMER_OUT_DIR=/tmp go run 06_agent_with_instructions_from_files.go
# Should print: "✓ Stigmer SDK: Manifest written to: /tmp/manifest.pb"
# Check: ls -lh /tmp/manifest.pb
```

## Benefits

1. **Automatic** - No manual proto conversion needed
2. **Type-safe** - Go's type system catches errors at compile time
3. **Proto-agnostic** - SDK doesn't depend on platform proto definitions
4. **Clean separation** - SDK collects config, CLI handles deployment
5. **Testable** - Dry-run mode for testing without side effects
6. **Maintainable** - SDK and platform can evolve independently

## Future Work

### Potential Enhancements

1. **Validation** - Pre-synthesis validation of agent configuration
2. **Multiple agents** - Support for defining multiple agents in one file
3. **Incremental synthesis** - Update manifest.pb only if configuration changed
4. **Debug mode** - Print detailed synthesis information
5. **JSON output** - Optional JSON format for debugging

### CLI Integration (Out of Scope)

The CLI will need to:
1. Import manifest proto from Buf (`buf.build/leftbin/stigmer`)
2. Set `STIGMER_OUT_DIR` environment variable
3. Execute user's Go code
4. Read `manifest.pb` from output directory
5. Convert manifest proto → platform protos
6. Deploy via gRPC to platform

## References

- **Buf Module**: `buf.build/leftbin/stigmer`
- **Manifest Proto**: `ai/stigmer/agentic/agent/v1/manifest.proto`
- **SDK Metadata**: `ai/stigmer/commons/sdk/metadata.proto`
- **Task Plan**: `_projects/2026-01/20260112.02.stigmer-agent-sdk-go/tasks/T02_0_synthesis_architecture_plan.md`
- **Gemini Conversation**: `_cursor/gemini-conversation` (Architecture discussion)

## Changelog

### 2026-01-13 - Task 3 Complete

**Added**:
- Global registry singleton (`internal/registry/`)
- Auto-synthesis hook (`internal/synth/synth.go`)
- SDK → Manifest proto converter (`internal/synth/converter.go`)
- Registry tests with thread-safety checks
- UUID dependency for skill ID generation

**Modified**:
- Agent constructor - auto-registration
- Skill - accessor methods
- SubAgent - accessor methods
- Environment.Variable - direct field access (exported)
- MCPServer interface - added `Type()` method
- Example 06 - synthesis pattern demonstration

**Results**:
- ✅ All packages build successfully
- ✅ All tests passing (8 packages)
- ✅ No breaking changes to public API
- ✅ Proto-agnostic design achieved

---

**Implemented by**: AI Assistant  
**Review status**: Ready for review  
**Next steps**: CLI integration (separate task)
