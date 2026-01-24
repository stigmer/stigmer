# Stigmer Go SDK - API Reference

**Version**: 0.2.0  
**Package**: `github.com/stigmer/stigmer/sdk/go`

Complete API reference for the Stigmer Go SDK using struct-based args (Pulumi pattern).

> **Migration Notice**: Version 0.2.0+ uses struct-based args instead of functional options.  
> See [Migration Guide](migration-from-functional-options.md) for upgrading from v0.1.0.

## Table of Contents

- [stigmer](#package-stigmer)
- [agent](#package-agent)
- [skill](#package-skill)
- [workflow](#package-workflow)
- [mcpserver](#package-mcpserver)
- [subagent](#package-subagent)
- [environment](#package-environment)

---

## Package: stigmer

**Import**: `github.com/stigmer/stigmer/sdk/go/stigmer`

Core package for resource management and synthesis.

### type Context

```go
type Context struct {
    // contains filtered or unexported fields
}
```

Central coordination point for all Stigmer resources.

**Thread Safety**: All methods are thread-safe.

#### func Run

```go
func Run(fn func(*Context) error) error
```

Executes the provided function with a new Context and handles resource synthesis.

**Parameters**:
- `fn` - Function that creates and configures resources

**Returns**:
- `error` - Any error from resource creation or synthesis

**Example**:
```go
err := stigmer.Run(func(ctx *stigmer.Context) error {
    agent, _ := agent.New(ctx, agent.WithName("my-agent"))
    return nil
})
```

#### func (*Context) SetString

```go
func (c *Context) SetString(key, value string) StringValue
```

Stores a string configuration value.

**Parameters**:
- `key` - Configuration key
- `value` - String value

**Returns**:
- `StringValue` - Typed value that can be used in resources

**Example**:
```go
apiBase := ctx.SetString("apiBase", "https://api.example.com")
```

#### func (*Context) SetInt

```go
func (c *Context) SetInt(key string, value int) IntValue
```

Stores an integer configuration value.

#### func (*Context) SetBool

```go
func (c *Context) SetBool(key string, value bool) BoolValue
```

Stores a boolean configuration value.

#### func (*Context) Dependencies

```go
func (c *Context) Dependencies() map[string][]string
```

Returns the complete dependency graph.

**Returns**:
- `map[string][]string` - Map of resource ID to its dependencies

**Example**:
```go
deps := ctx.Dependencies()
// deps["agent:reviewer"] = ["skill:coding"]
```

#### func (*Context) GetDependencies

```go
func (c *Context) GetDependencies(resourceID string) []string
```

Returns dependencies for a specific resource.

**Parameters**:
- `resourceID` - Resource identifier (e.g., "agent:my-agent")

**Returns**:
- `[]string` - List of dependency resource IDs

---

## Package: agent

**Import**: `github.com/stigmer/stigmer/sdk/go/agent`

Agent creation and configuration.

### type Agent

```go
type Agent struct {
    Name         string
    Instructions string
    Description  string
    IconURL      string
    // contains filtered or unexported fields
}
```

Represents an AI agent with instructions, skills, tools, and configuration.

#### func New

```go
func New(ctx *stigmer.Context, name string, args *AgentArgs) (*Agent, error)
```

Creates a new Agent using struct-based args (Pulumi pattern).

**Parameters**:
- `ctx` - Stigmer context (required)
- `name` - Agent identifier (lowercase alphanumeric + hyphens)
- `args` - Configuration struct (required)

**Returns**:
- `*Agent` - Created agent
- `error` - Validation errors

**Example**:
```go
agent, err := agent.New(ctx, "code-reviewer", &agent.AgentArgs{
    Instructions: "Review code and suggest improvements",
    Description:  "AI code reviewer",
    IconUrl:      "https://example.com/icon.png",
})
```

### type AgentArgs

```go
type AgentArgs struct {
    Description  string                        // Human-readable description
    IconUrl      string                        // Icon URL for UI display
    Instructions string                        // Agent behavior definition (min 10 chars)
    McpServers   []*types.McpServerDefinition  // MCP server definitions
    SkillRefs    []*types.ApiResourceReference // Skill references
    SubAgents    []*types.SubAgent             // Sub-agent definitions
    EnvSpec      *types.EnvironmentSpec        // Environment variables
}
```

Configuration struct for agent creation (Pulumi Args pattern).

**Required Fields**:
- `Instructions` - Agent instructions (10-10,000 characters)

**Optional Fields**:
- `Description` - Human-readable description (max 500 chars)
- `IconUrl` - Display icon URL
- Complex fields (use builder methods instead):
  - `McpServers` - Use `agent.AddMCPServer()`
  - `SkillRefs` - Use `agent.AddSkill()`
  - `SubAgents` - Use `agent.AddSubAgent()`
  - `EnvSpec` - Use `agent.AddEnvironmentVariable()`

#### func (*Agent) AddSkill

```go
func (a *Agent) AddSkill(s *skill.Skill) *Agent
```

Adds a skill to the agent (builder method for complex fields).

**Parameters**:
- `s` - Skill to add (inline, platform, or organization)

**Returns**:
- `*Agent` - Agent (for chaining)

**Example**:
```go
agent.AddSkill(codingSkill).
      AddSkill(skill.Platform("security"))
```

#### func (*Agent) AddSkills

```go
func (a *Agent) AddSkills(skills ...*skill.Skill) *Agent
```

Adds multiple skills to the agent.

**Parameters**:
- `skills` - One or more skills

**Returns**:
- `*Agent` - Agent (for chaining)

#### func (*Agent) AddMCPServer

```go
func (a *Agent) AddMCPServer(server *mcpserver.MCPServer) *Agent
```

Adds an MCP server to the agent (builder method).

**Parameters**:
- `server` - MCP server configuration

**Returns**:
- `*Agent` - Agent (for chaining)

#### func (*Agent) AddMCPServers

```go
func (a *Agent) AddMCPServers(servers ...*mcpserver.MCPServer) *Agent
```

Adds multiple MCP servers to the agent.

#### func (*Agent) AddSubAgent

```go
func (a *Agent) AddSubAgent(sub *subagent.SubAgent) *Agent
```

Adds a sub-agent for delegation (builder method).

**Parameters**:
- `sub` - Sub-agent configuration

**Returns**:
- `*Agent` - Agent (for chaining)

#### func (*Agent) AddSubAgents

```go
func (a *Agent) AddSubAgents(subs ...*subagent.SubAgent) *Agent
```

Adds multiple sub-agents to the agent.

#### func (*Agent) AddEnvironmentVariable

```go
func (a *Agent) AddEnvironmentVariable(env *environment.Variable) *Agent
```

Adds an environment variable requirement (builder method).

**Parameters**:
- `env` - Environment variable configuration

**Returns**:
- `*Agent` - Agent (for chaining)

#### func (*Agent) AddEnvironmentVariables

```go
func (a *Agent) AddEnvironmentVariables(vars ...*environment.Variable) *Agent
```

Adds multiple environment variables to the agent.

---

## Package: skill

**Import**: `github.com/stigmer/stigmer/sdk/go/skill`

Skill definitions and references.

### type Skill

```go
type Skill struct {
    Name        string
    Description string
    Content     string
    // contains filtered or unexported fields
}
```

Represents knowledge that can be attached to agents.

#### func New

```go
func New(name string, args *SkillArgs) (*Skill, error)
```

Creates a new inline skill using struct-based args (Pulumi pattern).

**Parameters**:
- `name` - Skill identifier (lowercase alphanumeric + hyphens)
- `args` - Configuration struct (required)

**Returns**:
- `*Skill` - Created skill
- `error` - Validation errors

**Example**:
```go
skill, err := skill.New("coding-standards", &skill.SkillArgs{
    MarkdownContent: "# Coding Standards\n\n...",
    Description:     "Company coding guidelines",
})
```

### type SkillArgs

```go
type SkillArgs struct {
    Description     string // Brief description for UI display
    MarkdownContent string // Markdown content (skill knowledge)
}
```

Configuration struct for skill creation (Pulumi Args pattern).

**Required Fields**:
- `MarkdownContent` - Skill content (10-50,000 characters)

**Optional Fields**:
- `Description` - Human-readable description (max 500 chars)

**Note**: For file-based content, read the file and pass to `MarkdownContent`:

```go
content, _ := os.ReadFile("skills/coding.md")
skill, _ := skill.New("coding-standards", &skill.SkillArgs{
    MarkdownContent: string(content),
})
```

#### func Platform

```go
func Platform(slug string) *Skill
```

References a platform-wide skill.

**Parameters**:
- `slug` - Skill slug (e.g., "coding-best-practices")

**Returns**:
- `*Skill` - Skill reference

**Example**:
```go
agent.AddSkill(skill.Platform("coding-best-practices"))
```

#### func Organization

```go
func Organization(orgSlug, skillSlug string) *Skill
```

References an organization-private skill.

**Parameters**:
- `orgSlug` - Organization slug
- `skillSlug` - Skill slug

**Returns**:
- `*Skill` - Skill reference

**Example**:
```go
agent.AddSkill(skill.Organization("my-org", "internal-standards"))
```

---

## Package: workflow

**Import**: `github.com/stigmer/stigmer/sdk/go/workflow`

Workflow orchestration and task builders.

### type Workflow

```go
type Workflow struct {
    Namespace string
    Name      string
    Version   string
    Tasks     []*Task
    // contains filtered or unexported fields
}
```

Represents a workflow with multiple orchestrated tasks.

#### func New

```go
func New(ctx *stigmer.Context, opts ...Option) (*Workflow, error)
```

Creates a new Workflow.

**Parameters**:
- `ctx` - Stigmer context (required)
- `opts` - Configuration options

**Returns**:
- `*Workflow` - Created workflow
- `error` - Validation errors

**Example**:
```go
wf, err := workflow.New(ctx,
    workflow.WithNamespace("data-processing"),
    workflow.WithName("daily-sync"),
    workflow.WithVersion("1.0.0"),
)
```

#### func (*Workflow) HttpCall

```go
func (w *Workflow) HttpCall(name string, args *HttpCallArgs) *Task
```

Creates an HTTP_CALL task using struct-based args.

**Parameters**:
- `name` - Task name
- `args` - HTTP configuration struct

**Returns**:
- `*Task` - Created task

**Example**:
```go
task := wf.HttpCall("fetch", &workflow.HttpCallArgs{
    Method:  "GET",
    URI:     "https://api.example.com/data",
    Headers: map[string]string{
        "Authorization": "Bearer ${.token}",
    },
    TimeoutSeconds: 30,
})
```

#### func (*Workflow) HttpGet

```go
func (w *Workflow) HttpGet(name string, uri interface{}, headers map[string]string) *Task
```

Creates an HTTP GET task (convenience method).

**Parameters**:
- `name` - Task name
- `uri` - Request URI (supports smart conversion)
  - Accepts: `string`, `TaskFieldRef`, `StringRef`
  - No `.Expression()` needed in v0.2.1+
- `headers` - HTTP headers (optional, can be nil)

**Returns**:
- `*Task` - Created task

**Example (with smart conversion)**:
```go
// String literal
task := wf.HttpGet("fetch", "https://api.example.com/data", map[string]string{
    "Content-Type": "application/json",
})

// TaskFieldRef - auto-converted!
task := wf.HttpGet("fetch", configTask.Field("endpoint"), nil)

// StringRef - auto-converted!
task := wf.HttpGet("fetch", apiBase.Concat("/users"), nil)
```

#### func (*Workflow) HttpPost

```go
func (w *Workflow) HttpPost(name string, uri interface{}, headers map[string]string, body map[string]interface{}) *Task
```

Creates an HTTP POST task (convenience method).

**Parameters**:
- `name` - Task name
- `uri` - Request URI (supports smart conversion: `string`, `TaskFieldRef`, `StringRef`)
- `headers` - HTTP headers (can be nil)
- `body` - Request body (can be nil)

**Example**:
```go
// String literal
task := wf.HttpPost("create", "https://api.example.com/users",
    map[string]string{"Content-Type": "application/json"},
    map[string]interface{}{"name": "John", "email": "john@example.com"},
)

// With smart conversion
task := wf.HttpPost("create", 
    apiBase.Concat("/users"),  // StringRef - auto-converted!
    nil,
    map[string]interface{}{
        "name": userTask.Field("name").Expression(),  // Map value - needs .Expression()
    },
)
```

#### func (*Workflow) HttpPut

```go
func (w *Workflow) HttpPut(name string, uri interface{}, headers map[string]string, body map[string]interface{}) *Task
```

Creates an HTTP PUT task (convenience method).

**Parameters**: Same as HttpPost (uri supports smart conversion)

#### func (*Workflow) HttpPatch

```go
func (w *Workflow) HttpPatch(name string, uri interface{}, headers map[string]string, body map[string]interface{}) *Task
```

Creates an HTTP PATCH task (convenience method).

**Parameters**: Same as HttpPost (uri supports smart conversion)

#### func (*Workflow) HttpDelete

```go
func (w *Workflow) HttpDelete(name string, uri interface{}, headers map[string]string) *Task
```

Creates an HTTP DELETE task (convenience method).

**Parameters**:
- `name` - Task name
- `uri` - Request URI (supports smart conversion: `string`, `TaskFieldRef`, `StringRef`)
- `headers` - HTTP headers (can be nil)

#### func (*Workflow) Set

```go
func (w *Workflow) Set(name string, args *SetArgs) *Task
```

Creates a SET task using struct-based args.

**Parameters**:
- `name` - Task name
- `args` - Variable configuration struct

**Returns**:
- `*Task` - Created task

**Example**:
```go
task := wf.Set("process", &workflow.SetArgs{
    Variables: map[string]string{
        "title":  fetchTask.Field("title").Expression(),
        "body":   fetchTask.Field("body").Expression(),
        "status": "complete",
    },
})
```

#### func (*Workflow) AgentCall

```go
func (w *Workflow) AgentCall(name string, args *AgentCallArgs) *Task
```

Creates an AGENT_CALL task using struct-based args.

**Parameters**:
- `name` - Task name
- `args` - Agent call configuration struct

**Returns**:
- `*Task` - Created task

**Example**:
```go
task := wf.AgentCall("review", &workflow.AgentCallArgs{
    Agent:   "code-reviewer",
    Message: "Review this code: ${.input.code}",
    Env: map[string]string{
        "GITHUB_TOKEN": "${.secrets.GITHUB_TOKEN}",
    },
})
```

#### func (*Workflow) Wait

```go
func (w *Workflow) Wait(name string, args *WaitArgs) *Task
```

Creates a WAIT task using struct-based args.

**Parameters**:
- `name` - Task name
- `args` - Wait configuration struct

**Returns**:
- `*Task` - Created task

**Example**:
```go
// Wait for duration
task := wf.Wait("pause", &workflow.WaitArgs{
    Duration: "30s",
})

// Wait until timestamp
task := wf.Wait("schedule", &workflow.WaitArgs{
    Until: "2024-12-31T23:59:59Z",
})
```

#### func (*Workflow) Listen

```go
func (w *Workflow) Listen(name string, args *ListenArgs) *Task
```

Creates a LISTEN task using struct-based args.

**Example**:
```go
task := wf.Listen("wait-approval", &workflow.ListenArgs{
    SignalName:     "approval-signal",
    TimeoutSeconds: 3600,
})
```

#### func (*Workflow) Raise

```go
func (w *Workflow) Raise(name string, args *RaiseArgs) *Task
```

Creates a RAISE task using struct-based args.

**Example**:
```go
task := wf.Raise("notify", &workflow.RaiseArgs{
    SignalName: "workflow-complete",
    Payload: map[string]interface{}{
        "status":   "success",
        "duration": "45s",
    },
})
```

#### func (*Workflow) Switch

```go
func (w *Workflow) Switch(name string, args *SwitchArgs) *Task
```

Creates a SWITCH task for conditional logic using struct-based args.

**Example**:
```go
task := wf.Switch("check-status", &workflow.SwitchArgs{
    Cases: []*workflow.SwitchCase{
        {
            Condition: &workflow.Condition{
                Operator: "equals",
                Key:      "status",
                Value:    "success",
            },
            Tasks: []*workflow.Task{successTask},
        },
    },
    Default: []*workflow.Task{defaultTask},
})
```

#### func (*Workflow) ForEach

```go
func (w *Workflow) ForEach(name string, args *ForArgs) *Task
```

Creates a FOR task for iteration using struct-based args.

**Recommended**: Use with `workflow.LoopBody()` for type-safe loop variables.

**Example (Modern - Recommended)**:
```go
task := wf.ForEach("process-items", &workflow.ForArgs{
    In: fetchTask.Field("items"),  // Smart conversion - no .Expression() needed
    Do: workflow.LoopBody(func(item workflow.LoopVar) []*workflow.Task {
        return []*workflow.Task{
            wf.HttpPost("process", apiEndpoint, nil, map[string]interface{}{
                "id":   item.Field("id"),    // Type-safe field access
                "data": item.Field("data"),  // No magic strings!
            }),
        }
    }),
})
```

**Example (Legacy - Still Supported)**:
```go
task := wf.ForEach("process-items", &workflow.ForArgs{
    In: fetchTask.Field("items").Expression(),  // Old style with .Expression()
    Do: []*types.WorkflowTask{/* manual task definitions */},
})
```

#### func (*Workflow) Try

```go
func (w *Workflow) Try(name string, args *TryArgs) *Task
```

Creates a TRY task for error handling using struct-based args.

**Example**:
```go
task := wf.Try("safe-operation", &workflow.TryArgs{
    Tasks: []*workflow.Task{riskyTask},
    Catches: []*workflow.CatchBlock{
        {
            ErrorMatcher: &workflow.ErrorMatcher{
                Code: "TIMEOUT",
            },
            Tasks: []*workflow.Task{handleTimeoutTask},
        },
    },
})
```

#### func (*Workflow) Fork

```go
func (w *Workflow) Fork(name string, args *ForkArgs) *Task
```

Creates a FORK task for parallel execution using struct-based args.

**Example**:
```go
task := wf.Fork("parallel-fetch", &workflow.ForkArgs{
    Branches: []*workflow.ForkBranch{
        {Name: "branch1", Tasks: []*workflow.Task{task1}},
        {Name: "branch2", Tasks: []*workflow.Task{task2}},
        {Name: "branch3", Tasks: []*workflow.Task{task3}},
    },
})
```

### type Task

```go
type Task struct {
    Name string
    Kind string
    // contains filtered or unexported fields
}
```

Represents a single workflow task.

#### func (*Task) Field

```go
func (t *Task) Field(fieldName string) TaskFieldRef
```

Creates a reference to a task output field.

**Parameters**:
- `fieldName` - Field name in task output

**Returns**:
- `TaskFieldRef` - Typed field reference

**Example**:
```go
title := fetchTask.Field("title")
```

### Workflow Task Args Types

All workflow tasks use struct-based args for configuration (Pulumi Args pattern).

#### type HttpCallArgs

```go
type HttpCallArgs struct {
    Method         string                 // HTTP method (GET, POST, PUT, PATCH, DELETE)
    Uri            interface{}            // Request URI (supports smart conversion)
    Headers        map[string]string      // HTTP headers
    Body           map[string]interface{} // Request body (for POST/PUT/PATCH)
    TimeoutSeconds int                    // Request timeout (default: 30)
    QueryParams    map[string]string      // Query parameters
}
```

**Fields**:
- `Method` - HTTP method (required)
- `Uri` - Request URI (required, supports smart conversion in v0.2.1+)
  - Accepts: `string`, `TaskFieldRef`, `StringRef`
  - No `.Expression()` needed
- `Headers` - HTTP headers (optional)
- `Body` - Request body (optional, for POST/PUT/PATCH)
- `TimeoutSeconds` - Request timeout (optional, default: 30)
- `QueryParams` - Query parameters (optional)

**Example**:
```go
task := wf.HttpCall("fetch", &workflow.HttpCallArgs{
    Method: "GET",
    Uri:    apiBase.Concat("/users"),  // Smart conversion - no .Expression()!
    Headers: map[string]string{
        "Authorization": "Bearer ${.token}",
    },
    TimeoutSeconds: 30,
})
```

#### type AgentCallArgs

```go
type AgentCallArgs struct {
    Agent   string                      // Agent slug or reference
    Message interface{}                 // Message to agent (supports smart conversion)
    Env     map[string]string           // Environment variables
    Config  *types.AgentExecutionConfig // Agent execution configuration
}
```

**Fields**:
- `Agent` - Agent slug or reference (required)
- `Message` - Message/prompt to agent (required, supports smart conversion in v0.2.1+)
  - Accepts: `string`, `TaskFieldRef`, `StringRef`
  - No `.Expression()` needed
- `Env` - Environment variables (optional)
- `Config` - Agent execution config (optional)
  - Model, temperature, timeout, etc.

**Example**:
```go
// With string literal
task := wf.AgentCall("review", &workflow.AgentCallArgs{
    Agent:   "code-reviewer",
    Message: "Review this code: ${.input.code}",
})

// With smart conversion
task := wf.AgentCall("review", &workflow.AgentCallArgs{
    Agent:   "code-reviewer",
    Message: fetchCode.Field("content"),  // TaskFieldRef - auto-converted!
    Config: &types.AgentExecutionConfig{
        Model:   "claude-3-5-sonnet",
        Timeout: 300,
    },
})
```

#### type SetArgs

```go
type SetArgs struct {
    Variables map[string]string // Variable key-value pairs
}
```

#### type WaitArgs

```go
type WaitArgs struct {
    Duration string // Wait duration (e.g., "30s", "5m", "1h")
    Until    string // Wait until timestamp (ISO 8601)
}
```

#### type ListenArgs

```go
type ListenArgs struct {
    SignalName     string // Signal name to listen for
    TimeoutSeconds int    // Timeout in seconds
}
```

#### type RaiseArgs

```go
type RaiseArgs struct {
    SignalName string                 // Signal name to emit
    Error      interface{}            // Error type (supports smart conversion)
    Message    interface{}            // Error message (supports smart conversion)
    Payload    map[string]interface{} // Signal payload data
}
```

**Fields**:
- `SignalName` - Signal name (required for signal events)
- `Error` - Error type (optional, supports smart conversion in v0.2.1+)
  - Accepts: `string`, `TaskFieldRef`, `StringRef`
- `Message` - Error message (optional, supports smart conversion in v0.2.1+)
  - Accepts: `string`, `TaskFieldRef`, `StringRef`
- `Payload` - Signal payload (optional)

**Example**:
```go
// Emit signal
task := wf.Raise("notify", &workflow.RaiseArgs{
    SignalName: "workflow-complete",
    Payload: map[string]interface{}{
        "status": "success",
    },
})

// Raise error with smart conversion
task := wf.Raise("error", &workflow.RaiseArgs{
    Error:   errorTask.Field("type"),     // TaskFieldRef - auto-converted!
    Message: errorTask.Field("message"),  // TaskFieldRef - auto-converted!
})
```

#### type SwitchArgs

```go
type SwitchArgs struct {
    Cases   []*SwitchCase // Conditional cases
    Default []*Task       // Default case tasks
}

type SwitchCase struct {
    Condition *Condition // Condition to match
    Tasks     []*Task    // Tasks to execute when matched
}

type Condition struct {
    Operator string      // Comparison operator (equals, notEquals, greaterThan, etc.)
    Key      string      // Variable key
    Value    interface{} // Comparison value
}
```

#### type ForArgs

```go
type ForArgs struct {
    In   interface{}             // Collection to iterate over (string or TaskFieldRef)
    Each string                  // Loop variable name (optional, default: "item")
    Do   []*types.WorkflowTask   // Tasks to execute per iteration
}
```

**Fields**:
- `In` - Collection expression to iterate over (required)
  - Accepts: `string`, `TaskFieldRef`, `StringRef` (smart conversion)
  - No `.Expression()` needed in v0.2.1+
- `Each` - Custom loop variable name (optional)
  - Default: `"item"`
  - Example: `"user"`, `"order"`, `"record"`
- `Do` - Tasks to execute for each iteration (required)
  - Recommended: Use `workflow.LoopBody()` for type safety
  - Legacy: Manual `[]*types.WorkflowTask` definitions

**Example**:
```go
wf.ForEach("process-users", &workflow.ForArgs{
    In: fetchTask.Field("users"),  // Smart conversion
    Each: "user",                  // Custom variable name
    Do: workflow.LoopBody(func(user workflow.LoopVar) []*workflow.Task {
        return []*workflow.Task{
            wf.Set("processUser", &workflow.SetArgs{
                Variables: map[string]string{
                    "userId": user.Field("id"),
                },
            }),
        }
    }),
})
```

#### func LoopBody

```go
func LoopBody(fn func(LoopVar) []*Task) []*types.WorkflowTask
```

Creates a type-safe loop body using a closure that receives the loop variable.
This eliminates magic strings and provides compile-time field reference checking.

**Parameters**:
- `fn` - Closure that receives a `LoopVar` and returns tasks to execute

**Returns**:
- `[]*types.WorkflowTask` - Tasks for the loop body

**Benefits**:
- ✅ Type-safe field access via `LoopVar`
- ✅ No magic strings like `"${.item.id}"`
- ✅ IDE autocomplete and refactoring support
- ✅ Compile-time checking of task definitions
- ✅ Clear, readable code structure

**Example**:
```go
wf.ForEach("processItems", &workflow.ForArgs{
    In: fetchTask.Field("items"),
    Do: workflow.LoopBody(func(item workflow.LoopVar) []*workflow.Task {
        return []*workflow.Task{
            wf.HttpPost("processItem", 
                apiBase.Concat("/process"),
                nil,
                map[string]interface{}{
                    "itemId": item.Field("id"),      // Type-safe!
                    "data":   item.Field("data"),    // No magic strings!
                    "status": item.Field("status"),
                },
            ),
        }
    }),
})
```

**With custom variable name**:
```go
wf.ForEach("processOrders", &workflow.ForArgs{
    Each: "order",  // Custom variable name
    In: fetchTask.Field("orders"),
    Do: workflow.LoopBody(func(order workflow.LoopVar) []*workflow.Task {
        return []*workflow.Task{
            wf.Set("processOrder", &workflow.SetArgs{
                Variables: map[string]string{
                    "orderId": order.Field("id"),        // References ${.order.id}
                    "total":   order.Field("total"),     // References ${.order.total}
                },
            }),
        }
    }),
})
```

**Nested loops**:
```go
wf.ForEach("processDepartments", &workflow.ForArgs{
    In: fetchDepts.Field("departments"),
    Do: workflow.LoopBody(func(dept workflow.LoopVar) []*workflow.Task {
        return []*workflow.Task{
            wf.ForEach("processEmployees", &workflow.ForArgs{
                In: dept.Field("employees"),
                Do: workflow.LoopBody(func(emp workflow.LoopVar) []*workflow.Task {
                    return []*workflow.Task{
                        wf.Set("processEmployee", &workflow.SetArgs{
                            Variables: map[string]string{
                                "deptId": dept.Field("id"),
                                "empId":  emp.Field("id"),
                            },
                        }),
                    }
                }),
            }),
        }
    }),
})
```

#### type LoopVar

```go
type LoopVar struct {
    // contains filtered or unexported fields
}
```

Represents the current iteration item in a loop body.
Provides type-safe methods for accessing item fields and values.

**Methods**:

##### func (LoopVar) Field

```go
func (v LoopVar) Field(fieldName string) string
```

Returns a reference to a field of the current loop item.

**Parameters**:
- `fieldName` - Name of the field to access

**Returns**:
- `string` - Expression string for the field (e.g., `"${.item.id}"`)

**Example**:
```go
Do: workflow.LoopBody(func(item workflow.LoopVar) []*workflow.Task {
    // Access fields of the current item
    id := item.Field("id")          // → "${.item.id}"
    name := item.Field("name")      // → "${.item.name}"
    email := item.Field("email")    // → "${.item.email}"
    
    return []*workflow.Task{
        wf.Set("process", &workflow.SetArgs{
            Variables: map[string]string{
                "userId":    id,
                "userName":  name,
                "userEmail": email,
            },
        }),
    }
}),
```

**With custom variable name**:
```go
wf.ForEach("processUsers", &workflow.ForArgs{
    Each: "user",
    In: fetchTask.Field("users"),
    Do: workflow.LoopBody(func(user workflow.LoopVar) []*workflow.Task {
        id := user.Field("id")  // → "${.user.id}"
        // ...
    }),
})
```

##### func (LoopVar) Value

```go
func (v LoopVar) Value() string
```

Returns a reference to the entire current item.

**Returns**:
- `string` - Expression string for the entire item (e.g., `"${.item}"`)

**Example**:
```go
Do: workflow.LoopBody(func(item workflow.LoopVar) []*workflow.Task {
    // Access the entire item
    itemValue := item.Value()  // → "${.item}"
    
    return []*workflow.Task{
        wf.HttpPost("process", endpoint, nil, map[string]interface{}{
            "data": itemValue,  // Pass entire item to API
        }),
    }
}),
```

#### type TryArgs

```go
type TryArgs struct {
    Tasks   []*Task       // Tasks in try block
    Catches []*CatchBlock // Error catch handlers
}

type CatchBlock struct {
    ErrorMatcher *ErrorMatcher // Error matcher configuration
    Tasks        []*Task       // Tasks to execute on error
}

type ErrorMatcher struct {
    Code      string // Error code to match (e.g., "TIMEOUT")
    Type      string // Error type to match
    MatchAny  bool   // Match any error
}
```

#### type ForkArgs

```go
type ForkArgs struct {
    Branches []*ForkBranch // Parallel branches
}

type ForkBranch struct {
    Name  string  // Branch name
    Tasks []*Task // Tasks to execute in parallel
}
```

---

## Package: mcpserver

**Import**: `github.com/stigmer/stigmer/sdk/go/mcpserver`

MCP (Model Context Protocol) server configurations.

### type MCPServer

```go
type MCPServer struct {
    // contains filtered or unexported fields
}
```

Represents an MCP server that provides tools to agents.

#### func Stdio

```go
func Stdio(opts ...Option) (*MCPServer, error)
```

Creates stdio-based MCP server.

**Example**:
```go
server, _ := mcpserver.Stdio(
    mcpserver.WithName("github"),
    mcpserver.WithCommand("npx"),
    mcpserver.WithArgs("-y", "@modelcontextprotocol/server-github"),
)
```

#### func HTTP

```go
func HTTP(opts ...Option) (*MCPServer, error)
```

Creates HTTP+SSE MCP server.

**Example**:
```go
server, _ := mcpserver.HTTP(
    mcpserver.WithName("remote"),
    mcpserver.WithURL("https://mcp.example.com"),
)
```

#### func Docker

```go
func Docker(opts ...Option) (*MCPServer, error)
```

Creates Docker-based MCP server.

**Example**:
```go
server, _ := mcpserver.Docker(
    mcpserver.WithName("custom"),
    mcpserver.WithImage("ghcr.io/org/mcp:latest"),
)
```

### Options (Stdio)

#### func WithCommand

```go
func WithCommand(cmd string) Option
```

Sets command to execute.

#### func WithArgs

```go
func WithArgs(args ...string) Option
```

Sets command arguments.

### Options (HTTP)

#### func WithURL

```go
func WithURL(url string) Option
```

Sets HTTP server URL.

#### func WithHeader

```go
func WithHeader(key, value string) Option
```

Adds HTTP header.

### Options (Docker)

#### func WithImage

```go
func WithImage(image string) Option
```

Sets Docker image.

#### func WithVolumeMount

```go
func WithVolumeMount(hostPath, containerPath string, readonly bool) Option
```

Adds volume mount.

#### func WithPortMapping

```go
func WithPortMapping(hostPort, containerPort int, protocol string) Option
```

Adds port mapping.

### Options (Common)

#### func WithName

```go
func WithName(name string) Option
```

Sets server name (required).

#### func WithEnvPlaceholder

```go
func WithEnvPlaceholder(name, placeholder string) Option
```

Adds environment variable placeholder.

#### func WithTimeout

```go
func WithTimeout(seconds int) Option
```

Sets connection timeout.

---

## Package: subagent

**Import**: `github.com/stigmer/stigmer/sdk/go/subagent`

Sub-agent configurations for delegation.

### type SubAgent

```go
type SubAgent struct {
    // contains filtered or unexported fields
}
```

Represents a sub-agent for delegation.

#### func Inline

```go
func Inline(opts ...Option) *SubAgent
```

Creates inline sub-agent definition.

**Example**:
```go
sub := subagent.Inline(
    subagent.WithName("analyzer"),
    subagent.WithInstructions("Analyze code quality"),
)
```

#### func Reference

```go
func Reference(agentID string) *SubAgent
```

References existing agent by ID.

**Example**:
```go
sub := subagent.Reference("agent-instance-id")
```

### Options

#### func WithName

```go
func WithName(name string) Option
```

Sets sub-agent name (required for inline).

#### func WithInstructions

```go
func WithInstructions(instructions string) Option
```

Sets sub-agent instructions (required for inline).

#### func WithMCPServer

```go
func WithMCPServer(serverName string) Option
```

Adds MCP server by name.

#### func WithSkill

```go
func WithSkill(skill skill.Skill) Option
```

Adds skill to sub-agent.

---

## Package: environment

**Import**: `github.com/stigmer/stigmer/sdk/go/environment`

Environment variable configurations.

### type Variable

```go
type Variable struct {
    Name         string
    DefaultValue string
    IsSecret     bool
    Description  string
}
```

Represents an environment variable requirement.

#### func New

```go
func New(opts ...Option) (*Variable, error)
```

Creates environment variable.

**Example**:
```go
apiKey, _ := environment.New(
    environment.WithName("API_KEY"),
    environment.WithSecret(true),
    environment.WithDescription("API key for service"),
)
```

### Options

#### func WithName

```go
func WithName(name string) Option
```

Sets variable name (required, uppercase with underscores).

#### func WithDefaultValue

```go
func WithDefaultValue(value string) Option
```

Sets default value (makes variable optional).

#### func WithSecret

```go
func WithSecret(isSecret bool) Option
```

Marks variable as secret (encrypted at rest).

#### func WithDescription

```go
func WithDescription(desc string) Option
```

Sets variable description.

---

## Helper Functions

### String Operations

```go
func Concat(parts ...interface{}) string
func ToUpper(s string) string
func ToLower(s string) string
func Trim(s string) string
func Substring(s string, start, end int) string
func Replace(s, old, new string) string
```

### Runtime Values

```go
func RuntimeSecret(name string) string
func RuntimeEnv(name string) string
func Interpolate(template string) string
```

### JSON Operations

```go
func ParseJSON(jsonStr string) interface{}
func ToJSON(data interface{}) string
func JSONPath(data interface{}, path string) interface{}
```

### Numeric Operations

```go
func Add(a, b interface{}) interface{}
func Subtract(a, b interface{}) interface{}
func Multiply(a, b interface{}) interface{}
func Divide(a, b interface{}) interface{}
func Modulo(a, b interface{}) interface{}
```

### Temporal Operations

```go
func Now() string
func FormatTime(timestamp, format string) string
func ParseTime(timestamp, format string) string
func AddDuration(timestamp, duration string) string
```

### Array Operations

```go
func Length(array interface{}) int
func At(array interface{}, index int) interface{}
func Contains(array interface{}, value interface{}) bool
func Join(array interface{}, separator string) string
func Map(array interface{}, varName string, fn interface{}) interface{}
func Filter(array interface{}, varName string, condition Condition) interface{}
```

### Loop Variables (v0.2.1+)

#### func LoopBody

```go
func LoopBody(fn func(LoopVar) []*Task) []*types.WorkflowTask
```

Creates a type-safe loop body for ForEach tasks. See detailed documentation in the [workflow package section](#func-loopbody).

**Quick Example**:
```go
wf.ForEach("processItems", &workflow.ForArgs{
    In: fetchTask.Field("items"),
    Do: workflow.LoopBody(func(item workflow.LoopVar) []*workflow.Task {
        return []*workflow.Task{
            wf.Set("process", &workflow.SetArgs{
                Variables: map[string]string{
                    "id": item.Field("id"),  // Type-safe!
                },
            }),
        }
    }),
})
```

#### type LoopVar

Represents the current iteration item in a loop. See detailed documentation in the [workflow package section](#type-loopvar).

**Methods**:
- `.Field(name)` - Access item field: `item.Field("id")` → `"${.item.id}"`
- `.Value()` - Access entire item: `item.Value()` → `"${.item}"`

---

## Smart Expression Conversion (v0.2.1+)

Certain fields automatically convert TaskFieldRef and StringRef to expression strings, eliminating the need for manual `.Expression()` calls.

### Fields with Smart Conversion

**Expression fields** (marked with `is_expression` proto option):

| Field | Type | Example |
|-------|------|---------|
| `ForTaskConfig.In` | `interface{}` | `In: fetchTask.Field("items")` |
| `HttpCallTaskConfig.Uri` | `interface{}` | `Uri: apiBase.Concat("/api")` |
| `AgentCallTaskConfig.Message` | `interface{}` | `Message: codeTask.Field("content")` |
| `RaiseTaskConfig.Error` | `interface{}` | `Error: errorTask.Field("type")` |
| `RaiseTaskConfig.Message` | `interface{}` | `Message: errorTask.Field("msg")` |

### How It Works

1. **Field is declared as `interface{}`** instead of `string`
2. **Runtime type checking** determines if value is string, TaskFieldRef, or StringRef
3. **Automatic conversion** calls `.Expression()` on TaskFieldRef/StringRef
4. **Backward compatible** - string literals still work

### Examples

**Before (v0.2.0 and earlier)**:
```go
wf.ForEach("process", &workflow.ForArgs{
    In: fetchTask.Field("items").Expression(),  // ❌ Manual conversion
})

wf.HttpGet("fetch", 
    apiBase.Concat("/users").Expression(),  // ❌ Manual conversion
    nil,
)

wf.AgentCall("review", &workflow.AgentCallArgs{
    Agent:   "reviewer",
    Message: codeTask.Field("content").Expression(),  // ❌ Manual conversion
})
```

**After (v0.2.1+)**:
```go
wf.ForEach("process", &workflow.ForArgs{
    In: fetchTask.Field("items"),  // ✅ Auto-converted!
})

wf.HttpGet("fetch", 
    apiBase.Concat("/users"),  // ✅ Auto-converted!
    nil,
)

wf.AgentCall("review", &workflow.AgentCallArgs{
    Agent:   "reviewer",
    Message: codeTask.Field("content"),  // ✅ Auto-converted!
})
```

### Where .Expression() Is Still Needed

Smart conversion ONLY applies to direct expression fields. You still need `.Expression()` for:

1. **Map values**:
   ```go
   Body: map[string]interface{}{
       "userId": userTask.Field("id").Expression(),  // ✅ Required
   }
   ```

2. **SetArgs.Variables values**:
   ```go
   wf.Set("vars", &workflow.SetArgs{
       Variables: map[string]string{
           "title": fetchTask.Field("title").Expression(),  // ✅ Required
       },
   })
   ```

3. **Array elements**:
   ```go
   items := []string{
       fetchTask.Field("name").Expression(),  // ✅ Required
   }
   ```

### LoopVar Exception

`LoopVar` methods (`.Field()`, `.Value()`) already return strings, so they never need `.Expression()`:

```go
Do: workflow.LoopBody(func(item workflow.LoopVar) []*workflow.Task {
    return []*workflow.Task{
        wf.Set("process", &workflow.SetArgs{
            Variables: map[string]string{
                "id": item.Field("id"),  // ✅ Already a string!
            },
        }),
    }
}),
```

---

## Error Handling

All SDK functions that can fail return `error`:

```go
agent, err := agent.New(ctx, agent.WithName("my-agent"))
if err != nil {
    return fmt.Errorf("failed to create agent: %w", err)
}
```

**Error Types**:
- **Validation errors**: Invalid input (name format, required fields, etc.)
- **File errors**: File not found, read errors
- **Synthesis errors**: Proto conversion failures

---

## Thread Safety

- ✅ **Context**: All methods are thread-safe
- ✅ **Resource Creation**: Thread-safe when using context
- ⚠️ **Resource Modification**: Not thread-safe after creation

**Recommendation**: Create all resources in single goroutine within `stigmer.Run()`.

---

## Validation Rules

### Names

- Format: `^[a-z0-9-]+$`
- Max length: 63 characters
- Examples: `my-agent`, `code-reviewer`, `api-v1`

### Instructions

- Min length: 10 characters
- Max length: 10,000 characters
- Format: Plain text or Markdown

### Descriptions

- Max length: 500 characters

### Versions

- Format: Semantic versioning (`1.0.0`, `2.1.3-beta`)

### URLs

- Must be valid HTTP/HTTPS URLs
- Examples: `https://example.com`, `http://localhost:8080`

---

## Full Documentation

- **Getting Started**: [GETTING_STARTED.md](GETTING_STARTED.md)
- **Usage Guide**: [USAGE.md](USAGE.md)
- **Examples**: `sdk/go/examples/`
- **pkg.go.dev**: [https://pkg.go.dev/github.com/stigmer/stigmer/sdk/go](https://pkg.go.dev/github.com/stigmer/stigmer/sdk/go)

---

**Version**: 0.2.0  
**Last Updated**: 2026-01-24  
**Migration**: See [Migration Guide](migration-from-functional-options.md) for upgrading from v0.1.0
