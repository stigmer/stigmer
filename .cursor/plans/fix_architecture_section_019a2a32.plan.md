---
name: Fix Architecture Section
overview: Fix empty space in "You Write" column, correct Go SDK code to match real patterns, and update integration examples to show streaming RPC instead of polling.
todos:
  - id: add_you_write_content
    content: Add content below YAML/SDK tabs in 'You Write' column for visual balance
    status: completed
  - id: fix_go_sdk_code
    content: Update Go SDK example to use real Stigmer SDK types and patterns
    status: completed
  - id: replace_polling_streaming
    content: Replace polling loop with streaming Subscribe RPC pattern in integration example
    status: completed
  - id: verify_accuracy
    content: Verify all code examples match real SDK patterns from codebase
    status: completed
isProject: false
---

# Fix Architecture Section - Code Accuracy & Content Balance

## Problems Identified

1. **Empty space in "You Write" column**: After the YAML/SDK code tabs, there's no additional content, while the other two columns have rich content below their main examples
2. **Incorrect Go SDK code**: Current code doesn't match actual Stigmer SDK patterns
3. **Polling pattern shown**: Integration example shows polling loop instead of streaming Subscribe RPC
4. **Code style clarity needed**: Determine appropriate level of code realism for website

## Research Findings

### Real Stigmer SDK Patterns

From `[client-apps/cli/cmd/stigmer/root/run_create.go](client-apps/cli/cmd/stigmer/root/run_create.go)` and `[client-apps/cli/cmd/stigmer/root/run_stream.go](client-apps/cli/cmd/stigmer/root/run_stream.go)`:

**Agent Creation Pattern:**

```go
execution := &agentexecutionv1.AgentExecution{
    ApiVersion: "agentic.stigmer.ai/v1",
    Kind:       "AgentExecution",
    Metadata:   &apiresource.ApiResourceMetadata{...},
    Spec:       &agentexecutionv1.AgentExecutionSpec{...},
}
client := agentexecutionv1.NewAgentExecutionCommandControllerClient(conn)
result, err := client.Create(ctx, execution)
```

**Streaming Pattern:**

```go
client := agentexecutionv1.NewAgentExecutionQueryControllerClient(conn)
stream, err := client.Subscribe(ctx, &agentexecutionv1.AgentExecutionId{Value: executionID})
for {
    execution, err := stream.Recv()
    // Handle updates
}
```

### Website Code Example Philosophy

**Decision: Real SDK patterns, pedagogically simplified**

This is the industry standard for developer tool websites (Temporal, Hasura, Pulumi). It means:

- Use actual function/type names from the SDK
- Show the real pattern/structure
- Remove error handling for clarity (unless teaching errors)
- Use `...` for "more code here" 
- Focus on "happy path"
- Make it scannable at a glance

**Why not pseudo-code**: Pseudo-code can confuse developers who will copy-paste and wonder why it doesn't work. Better to show real patterns they can adapt.

**Why not complete code**: Website space is limited, readers scan quickly. Complete code with full error handling obscures the core pattern.

## Changes Required

### 1. Fill "You Write" Column Empty Space

Add content below the YAML/SDK tabs similar to other columns:

**Content to add:**

- File creation info (e.g., "Save as `agents/code-reviewer.yaml`")
- Development flow badges (e.g., "Local first", "Type safe", "Git-versionable")
- Quick context about when to use YAML vs SDK

**Location**: After `<CodeTabViewer>` component in `ArchitectureDiagram` function

### 2. Fix Go SDK Code Example

**Current (wrong):**

```go
agent := &agentic.Agent{
    Metadata: &agentic.Metadata{
        Name: "code-reviewer",
    },
    Spec: &agentic.AgentSpec{
        Instructions: "Review code for security",
        McpServers: []string{"github"},
    },
}
```

**Corrected (matches real SDK):**

```go
agent := &agentv1.Agent{
    ApiVersion: "agentic.stigmer.ai/v1",
    Kind:       "Agent",
    Metadata: &apiresource.ApiResourceMetadata{
        Name: "code-reviewer",
    },
    Spec: &agentv1.AgentSpec{
        Instructions: "Review code for security",
        McpServers:   []string{"github"},
    },
}

// Create via command client
client := agentv1.NewAgentCommandControllerClient(conn)
result, err := client.Create(ctx, agent)
```

**Simplified for website (pedagogical):**

```go
agent := &agentv1.Agent{
    ApiVersion: "agentic.stigmer.ai/v1",
    Kind:       "Agent",
    Metadata: &apiresource.ApiResourceMetadata{
        Name: "code-reviewer",
    },
    Spec: &agentv1.AgentSpec{
        Instructions: "Review code for security",
        McpServers:   []string{"github"},
    },
}

client.Create(ctx, agent)
```

### 3. Replace Polling with Streaming RPC

**Current (polling - incorrect):**

```go
// Poll for completion
for {
    status, _ := client.GetStatus(ctx, execution.Id)
    if status.Phase == "COMPLETED" { break }
    time.Sleep(2 * time.Second)
}

// Retrieve result
result, _ := client.GetResult(ctx, execution.Id)
```

**Corrected (streaming):**

```go
// Subscribe to execution stream
stream, err := client.Subscribe(ctx, &agentexecutionv1.AgentExecutionId{
    Value: execution.Id,
})

// Receive updates in real-time
for {
    execution, err := stream.Recv()
    if err != nil {
        break // Stream ended
    }
    
    // Display messages as they arrive
    for _, msg := range execution.Status.Messages {
        fmt.Println(msg.Content)
    }
    
    if execution.Status.Phase == "COMPLETED" {
        break
    }
}
```

**Simplified for website:**

```go
// Subscribe to real-time updates
stream, _ := client.Subscribe(ctx, &AgentExecutionId{
    Value: execution.Id,
})

for {
    execution, _ := stream.Recv()
    
    // Process streaming messages
    for _, msg := range execution.Status.Messages {
        handleMessage(msg)
    }
    
    if execution.Status.Phase == "COMPLETED" {
        break
    }
}
```

## Implementation Steps

### Step 1: Add Content to "You Write" Column

**File**: `[site/src/components/sections/Architecture.tsx](site/src/components/sections/Architecture.tsx)`

After `<CodeTabViewer>`, add a new component showing:

- Development context (file location, workflow)
- When to use YAML vs SDK decision guidance
- Visual badges for key benefits

### Step 2: Fix Go SDK Code Example

**File**: `[site/src/components/sections/Architecture.tsx](site/src/components/sections/Architecture.tsx)`

Update `CodeTabViewer` component:

- Replace `goCode` constant with accurate SDK pattern
- Use real type names: `agentv1.Agent`, `apiresource.ApiResourceMetadata`
- Show simplified but real pattern (pedagogically appropriate)

### Step 3: Update Integration Example to Streaming

**File**: `[site/src/components/sections/Architecture.tsx](site/src/components/sections/Architecture.tsx)`

Update `IntegrationCard` component:

- Replace polling loop with Subscribe pattern
- Show `stream.Recv()` in loop
- Emphasize real-time streaming nature
- Keep simplified (no exhaustive error handling)

## Validation

After changes:

1. Visual balance: All three columns should have similar content density
2. Code accuracy: Examples should use real SDK types/functions (simplified but real)
3. Technical correctness: Streaming RPC pattern, not polling
4. Pedagogical clarity: Easy to understand core pattern at a glance

## Design Rationale

**Why simplified real code over pseudo-code:**

- Developers will copy-paste examples
- Real type names help with IDE autocomplete
- Builds correct mental model of the SDK
- Standard practice for developer tools (Temporal, Stripe, Twilio all do this)

**Why streaming matters:**

- Stigmer's core value is real-time agent execution
- Polling misrepresents the product's capabilities
- Streaming is more impressive and accurate

