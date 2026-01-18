# Synthesis Architecture: Behavior and Limitations

**Last Updated**: 2026-01-13  
**Related**: [synthesis-architecture.md](./synthesis-architecture.md)

## Overview

This document explains how the synthesis architecture behaves in different scenarios, including multiple agents, CLI session isolation, and testing strategies.

## How Synthesis Works (Verified with Tests)

### ✅ Test 1: Dry-Run Mode

**Scenario**: User runs code without `STIGMER_OUT_DIR` set

```go
func main() {
    defer synth.AutoSynth()
    
    agent, _ := agent.New(
        agent.WithName("reviewer"),
        agent.WithInstructions("Review code"),
    )
}
```

**Run**: `go run main.go`

**Behavior**:
- ✅ Agent is created and registered
- ✅ `defer synth.AutoSynth()` executes on exit
- ✅ Prints: "✓ Stigmer SDK: Dry-run complete. Run 'stigmer up' to deploy."
- ✅ No files written
- ✅ Useful for testing agent definitions

**Verification**: See `TestAutoSynth_DryRunMode` in `synth_integration_test.go`

### ✅ Test 2: Synthesis Mode

**Scenario**: CLI sets `STIGMER_OUT_DIR` and runs user code

```bash
STIGMER_OUT_DIR=/tmp/stigmer-12345 go run main.go
```

**Behavior**:
- ✅ Agent is created and registered
- ✅ `defer synth.AutoSynth()` executes on exit
- ✅ Converts agent → manifest proto
- ✅ Writes `/tmp/stigmer-12345/manifest.pb`
- ✅ Prints: "✓ Stigmer SDK: Manifest written to: /tmp/stigmer-12345/manifest.pb"

**Manifest Contents**:
```protobuf
AgentManifest {
  sdk_metadata: {
    language: "go"
    version: "0.1.0"
    generated_at: 1705172400
  }
  agent: {
    name: "reviewer"
    instructions: "Review code"
    skills: [...]
    mcp_servers: [...]
    sub_agents: [...]
    environment_variables: [...]
  }
}
```

**Verification**: See `TestAutoSynth_SynthesisMode` in `synth_integration_test.go`

## Current Limitation: Single Agent Per Execution

### ⚠️ Problem: Multiple Agents in One File

**Scenario**: User creates multiple agents in one file

```go
func main() {
    defer synth.AutoSynth()
    
    // Create agent 1
    agent1, _ := agent.New(
        agent.WithName("agent-1"),
        agent.WithInstructions("First agent"),
    )
    
    // Create agent 2
    agent2, _ := agent.New(
        agent.WithName("agent-2"),
        agent.WithInstructions("Second agent"),
    )
    
    // On exit: Only agent-2 is synthesized!
}
```

**Current Behavior**:
- ⚠️ `agent.New()` registers agent in **global singleton registry**
- ⚠️ Each call to `agent.New()` **replaces** the previous agent
- ⚠️ Only the **last agent** is synthesized
- ⚠️ First agent is lost (not synthesized)

**Verification**: See `TestMultipleAgents_LastOneWins` in `synth_integration_test.go`

```
Test output:
⚠️  LIMITATION: Only the last agent is synthesized
   Created agents: agent-1, agent-2
   Synthesized: agent-2 (last one)
```

### Why This Limitation Exists

The current implementation uses a **singleton pattern**:

```go
// internal/registry/registry.go
type Registry struct {
    agent interface{}  // Stores ONE agent
}

func (r *Registry) RegisterAgent(a interface{}) {
    r.agent = a  // Replaces previous agent
}
```

Each `agent.New()` call replaces the previous agent in the global registry.

### Solutions for Multiple Agents

#### Solution 1: Multiple Files (Recommended for Now)

**Pattern**: One agent per file, CLI runs each separately

```
project/
├── agent-reviewer.go     # Creates agent-1
├── agent-deployer.go     # Creates agent-2
└── agent-monitor.go      # Creates agent-3
```

**CLI Workflow**:
```bash
# CLI runs each file separately with unique output directories
STIGMER_OUT_DIR=/tmp/session-1 go run agent-reviewer.go   # → manifest.pb (agent-1)
STIGMER_OUT_DIR=/tmp/session-2 go run agent-deployer.go   # → manifest.pb (agent-2)
STIGMER_OUT_DIR=/tmp/session-3 go run agent-monitor.go    # → manifest.pb (agent-3)
```

**Pros**:
- ✅ Works with current implementation
- ✅ Clear separation of concerns
- ✅ Each agent is isolated

**Cons**:
- ❌ Cannot define multiple agents in one file
- ❌ Requires multiple CLI invocations

#### Solution 2: Registry Stores Multiple Agents (Future Enhancement)

**Proposed Change**: Store a list of agents instead of single agent

```go
// internal/registry/registry.go (proposed)
type Registry struct {
    agents []interface{}  // Store multiple agents
}

func (r *Registry) RegisterAgent(a interface{}) {
    r.agents = append(r.agents, a)  // Add, don't replace
}

func (r *Registry) GetAgents() []interface{} {
    return r.agents
}
```

**Manifest Change**: Support multiple agents in one manifest

```protobuf
// manifest.proto (proposed)
message AgentManifest {
  SdkMetadata sdk_metadata = 1;
  repeated AgentBlueprint agents = 2;  // Changed to repeated
}
```

**CLI Workflow**:
```bash
# CLI runs once, gets all agents
STIGMER_OUT_DIR=/tmp/session go run main.go
# → manifest.pb contains agent-1, agent-2, agent-3
```

**Pros**:
- ✅ Natural Go API (define multiple agents in one file)
- ✅ Single CLI invocation
- ✅ Batch deployment

**Cons**:
- ❌ Requires SDK changes (registry + converter)
- ❌ Requires manifest proto changes
- ❌ Requires CLI changes (read multiple agents)
- ❌ More complex error handling (what if one agent fails?)

#### Solution 3: Named Manifest Files (Alternative)

**Pattern**: Each agent writes to a separate file

```go
func main() {
    defer synth.AutoSynth()
    
    agent1, _ := agent.New(
        agent.WithName("agent-1"),
        // ...
    )
    
    agent2, _ := agent.New(
        agent.WithName("agent-2"),
        // ...
    )
    
    // On exit:
    // → $STIGMER_OUT_DIR/agent-1.pb
    // → $STIGMER_OUT_DIR/agent-2.pb
}
```

**Pros**:
- ✅ Supports multiple agents in one file
- ✅ Clear separation (one file per agent)
- ✅ CLI can read all *.pb files

**Cons**:
- ❌ More complex file management
- ❌ Potential naming conflicts
- ❌ Harder to debug (which file has which agent?)

## CLI Session Isolation

### ✅ How CLI Sessions Are Isolated

Each CLI session sets a **unique** `STIGMER_OUT_DIR`:

```bash
# Session 1 (terminal 1)
STIGMER_OUT_DIR=/tmp/stigmer-session-abc123 go run agent.go
# → /tmp/stigmer-session-abc123/manifest.pb

# Session 2 (terminal 2, concurrent)
STIGMER_OUT_DIR=/tmp/stigmer-session-xyz789 go run agent.go
# → /tmp/stigmer-session-xyz789/manifest.pb
```

**Isolation Guarantees**:
- ✅ Different output directories → no conflicts
- ✅ Each process has its own global registry (separate process memory)
- ✅ No shared state between CLI sessions
- ✅ Safe to run concurrently

**Verification**: See `TestConcurrentSynthesis_IsolatedDirectories` in `synth_integration_test.go`

```
Test output:
✅ Session 1 isolated: session-1-agent → /tmp/.../session-1
✅ Session 2 isolated: session-2-agent → /tmp/.../session-2
```

### CLI Implementation Pattern (Proposed)

```go
// CLI code (not in SDK)
func deployAgent(userCodePath string) error {
    // 1. Create unique temp directory
    sessionID := uuid.New().String()
    outputDir := filepath.Join(os.TempDir(), "stigmer-"+sessionID)
    os.MkdirAll(outputDir, 0755)
    defer os.RemoveAll(outputDir) // Cleanup
    
    // 2. Set environment variable
    cmd := exec.Command("go", "run", userCodePath)
    cmd.Env = append(os.Environ(), "STIGMER_OUT_DIR="+outputDir)
    
    // 3. Execute user code
    if err := cmd.Run(); err != nil {
        return err
    }
    
    // 4. Read manifest.pb
    manifestPath := filepath.Join(outputDir, "manifest.pb")
    data, err := os.ReadFile(manifestPath)
    if err != nil {
        return err
    }
    
    // 5. Deserialize and process
    var manifest agentv1.AgentManifest
    proto.Unmarshal(data, &manifest)
    
    // 6. Convert to platform proto and deploy
    // ... CLI-specific logic
    
    return nil
}
```

## Testing Strategies

### SDK Testing (This Repository)

**What We Test**:
- ✅ Agent registration in global registry
- ✅ Dry-run mode (no file written)
- ✅ Synthesis mode (manifest.pb written)
- ✅ Manifest proto correctness
- ✅ All agent components included (skills, MCP servers, etc.)
- ✅ Multiple agent behavior (last one wins)
- ✅ Session isolation (different directories)

**How to Run**:
```bash
# All synthesis tests
go test ./internal/synth/... -v

# Specific test
go test ./internal/synth/... -v -run TestAutoSynth_SynthesisMode

# With temp directory inspection
go test ./internal/synth/... -v -run TestAutoSynth_SynthesisMode
# Check test output for temp directory path
# Manually inspect: ls -lh /tmp/TestAutoSynth_SynthesisMode*/001/
```

### CLI Testing (Separate Repository)

**What CLI Should Test**:
- Reading manifest.pb from disk
- Deserializing manifest proto
- Converting manifest → platform protos
- Deployment via gRPC
- Error handling (invalid manifest, network failures, etc.)
- Multiple agents (if Solution 2 is implemented)

**CLI Test Pattern**:
```bash
# Integration test
1. Create test agent code (Go file)
2. Run CLI: stigmer up agent.go
3. Verify CLI reads manifest.pb correctly
4. Verify CLI deploys to platform
5. Verify platform receives correct AgentSpec
```

### End-to-End Testing

**Full Workflow**:
```bash
# 1. User writes agent code
cat > agent.go <<EOF
package main

import (
    "github.com/leftbin/stigmer-sdk/go/agent"
    "github.com/leftbin/stigmer-sdk/go/internal/synth"
)

func main() {
    defer synth.AutoSynth()
    
    agent.New(
        agent.WithName("test-agent"),
        agent.WithInstructions("Test instructions"),
    )
}
EOF

# 2. User runs CLI
stigmer up agent.go

# 3. Verify agent deployed
stigmer list agents
# Should show: test-agent

# 4. Verify agent works
stigmer run test-agent "Review this code: ..."
```

## Answers to Your Questions

### Q1: Where do we check the synthesis - SDK or CLI?

**Answer**: **Both, but different aspects**

**SDK Checks** (This Repository):
- ✅ Agent is registered in global registry
- ✅ `AutoSynth()` writes manifest.pb to correct location
- ✅ Manifest proto is valid and complete
- ✅ All agent components are serialized correctly

**CLI Checks** (Separate Repository):
- ✅ manifest.pb file exists at expected location
- ✅ manifest.pb can be read and deserialized
- ✅ Manifest contains valid agent configuration
- ✅ Conversion to platform proto succeeds
- ✅ Deployment to platform succeeds

**Our Integration Tests** prove synthesis works from SDK perspective:
```bash
go test ./internal/synth/... -v -run TestAutoSynth_SynthesisMode
# ✅ Verifies manifest.pb is written
# ✅ Verifies content is correct
# ✅ Verifies all components are present
```

### Q2: Single manifest.pb enough for multiple agents?

**Answer**: **Currently NO - only last agent is synthesized**

**Current Behavior**:
```go
// User code
agent1, _ := agent.New(agent.WithName("agent-1"))
agent2, _ := agent.New(agent.WithName("agent-2"))

// Result:
// ❌ Only agent-2 is in manifest.pb
// ❌ agent-1 is lost
```

**Workaround** (until Solution 2 is implemented):
```bash
# Separate files
agent-1.go  # Contains agent-1 definition
agent-2.go  # Contains agent-2 definition

# CLI runs each separately
stigmer up agent-1.go  # Deploys agent-1
stigmer up agent-2.go  # Deploys agent-2
```

**Future Solution**: Modify manifest proto to support `repeated AgentBlueprint`

### Q3: Multiple CLI sessions - what happens?

**Answer**: **Isolated by design - each session has unique output directory**

**How It Works**:
```bash
# Session 1
STIGMER_OUT_DIR=/tmp/stigmer-abc123 go run agent.go
# → /tmp/stigmer-abc123/manifest.pb

# Session 2 (concurrent)
STIGMER_OUT_DIR=/tmp/stigmer-xyz789 go run agent.go
# → /tmp/stigmer-xyz789/manifest.pb
```

**Guarantees**:
- ✅ No file conflicts (different directories)
- ✅ No memory conflicts (separate processes)
- ✅ No registry conflicts (each process has own registry)
- ✅ Safe to run 100 CLI sessions simultaneously

**Test Proof**: See `TestConcurrentSynthesis_IsolatedDirectories`

## Recommendations

### For Current Implementation (v0.1.0)

1. **Use one agent per file** if you need multiple agents
2. **Use `defer synth.AutoSynth()`** in every main function
3. **Test with dry-run first**: `go run agent.go` (no STIGMER_OUT_DIR)
4. **Let CLI manage STIGMER_OUT_DIR**: Don't set it manually

### For Future Enhancements

1. **Implement Solution 2**: Support multiple agents in one manifest
2. **Add validation**: Check for duplicate agent names
3. **Add debug mode**: Print detailed synthesis information
4. **Add incremental synthesis**: Only update if config changed
5. **Add rollback support**: Keep previous manifest for comparison

## Related Files

- **Integration Tests**: `internal/synth/synth_integration_test.go`
- **Architecture Doc**: `synthesis-architecture.md`
- **Registry Implementation**: `internal/registry/registry.go`
- **Synthesis Implementation**: `internal/synth/synth.go`
- **Converter Implementation**: `internal/synth/converter.go`

---

**Status**: Current implementation verified with comprehensive tests  
**Limitations**: Single agent per execution (documented and tested)  
**Next Steps**: CLI integration and potential multi-agent support
