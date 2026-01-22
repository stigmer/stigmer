# Stigmer Go SDK - API Reference

**Version**: 0.1.0  
**Package**: `github.com/stigmer/stigmer/sdk/go`

Complete API reference for the Stigmer Go SDK.

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
func New(ctx *stigmer.Context, opts ...Option) (*Agent, error)
```

Creates a new Agent.

**Parameters**:
- `ctx` - Stigmer context (required)
- `opts` - Configuration options

**Returns**:
- `*Agent` - Created agent
- `error` - Validation errors

**Example**:
```go
agent, err := agent.New(ctx,
    agent.WithName("code-reviewer"),
    agent.WithInstructionsFromFile("instructions/reviewer.md"),
)
```

#### func (*Agent) AddSkill

```go
func (a *Agent) AddSkill(skill skill.Skill) *Agent
```

Adds a skill to the agent.

**Parameters**:
- `skill` - Skill to add (inline, platform, or organization)

**Returns**:
- `*Agent` - Agent (for chaining)

**Example**:
```go
agent.AddSkill(*codingSkill).
      AddSkill(skill.Platform("security"))
```

#### func (*Agent) AddMCPServer

```go
func (a *Agent) AddMCPServer(server *mcpserver.MCPServer) *Agent
```

Adds an MCP server to the agent.

**Parameters**:
- `server` - MCP server configuration

**Returns**:
- `*Agent` - Agent (for chaining)

#### func (*Agent) AddSubAgent

```go
func (a *Agent) AddSubAgent(sub *subagent.SubAgent) *Agent
```

Adds a sub-agent for delegation.

**Parameters**:
- `sub` - Sub-agent configuration

**Returns**:
- `*Agent` - Agent (for chaining)

#### func (*Agent) AddEnvironmentVariable

```go
func (a *Agent) AddEnvironmentVariable(env *environment.Variable) *Agent
```

Adds an environment variable requirement.

**Parameters**:
- `env` - Environment variable configuration

**Returns**:
- `*Agent` - Agent (for chaining)

### type Option

Configuration option for Agent.

#### func WithName

```go
func WithName(name string) Option
```

Sets the agent name (required).

**Validation**:
- Lowercase alphanumeric + hyphens
- Max 63 characters
- Must match: `^[a-z0-9-]+$`

#### func WithInstructions

```go
func WithInstructions(instructions string) Option
```

Sets agent instructions from string (required).

**Validation**:
- Min 10 characters
- Max 10,000 characters

#### func WithInstructionsFromFile

```go
func WithInstructionsFromFile(path string) Option
```

Loads agent instructions from file (required, recommended).

**Parameters**:
- `path` - Path to Markdown file (relative to project root)

#### func WithDescription

```go
func WithDescription(desc string) Option
```

Sets agent description (optional).

**Validation**:
- Max 500 characters

#### func WithIconURL

```go
func WithIconURL(url string) Option
```

Sets agent icon URL (optional).

**Validation**:
- Must be valid URL

#### func WithSkills

```go
func WithSkills(skills ...skill.Skill) Option
```

Sets initial skills (optional).

**Parameters**:
- `skills` - One or more skills

---

## Package: skill

**Import**: `github.com/stigmer/stigmer/sdk/go/skill`

Skill definitions and references.

### type Skill

```go
type Skill struct {
    // contains filtered or unexported fields
}
```

Represents knowledge that can be attached to agents.

#### func New

```go
func New(opts ...Option) (*Skill, error)
```

Creates a new inline skill.

**Parameters**:
- `opts` - Configuration options

**Returns**:
- `*Skill` - Created skill
- `error` - Validation errors

**Example**:
```go
skill, err := skill.New(
    skill.WithName("coding-standards"),
    skill.WithMarkdownFromFile("skills/coding.md"),
)
```

#### func Platform

```go
func Platform(slug string) Skill
```

References a platform-wide skill.

**Parameters**:
- `slug` - Skill slug (e.g., "coding-best-practices")

**Returns**:
- `Skill` - Skill reference

**Example**:
```go
agent.AddSkill(skill.Platform("coding-best-practices"))
```

#### func Organization

```go
func Organization(orgSlug, skillSlug string) Skill
```

References an organization-private skill.

**Parameters**:
- `orgSlug` - Organization slug
- `skillSlug` - Skill slug

**Returns**:
- `Skill` - Skill reference

**Example**:
```go
agent.AddSkill(skill.Organization("my-org", "internal-standards"))
```

### type Option

Configuration option for Skill.

#### func WithName

```go
func WithName(name string) Option
```

Sets skill name (required).

**Validation**: Same as agent name

#### func WithMarkdown

```go
func WithMarkdown(content string) Option
```

Sets skill content from string (required).

**Validation**:
- Min 10 characters
- Max 50,000 characters

#### func WithMarkdownFromFile

```go
func WithMarkdownFromFile(path string) Option
```

Loads skill content from file (required, recommended).

**Parameters**:
- `path` - Path to Markdown file

#### func WithDescription

```go
func WithDescription(desc string) Option
```

Sets skill description (optional).

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

#### func (*Workflow) HttpGet

```go
func (w *Workflow) HttpGet(name, uri string, opts ...TaskOption) *Task
```

Creates an HTTP GET task.

**Parameters**:
- `name` - Task name
- `uri` - Request URI
- `opts` - HTTP options

**Returns**:
- `*Task` - Created task

**Example**:
```go
task := wf.HttpGet("fetch", "https://api.example.com/data",
    workflow.Header("Content-Type", "application/json"),
    workflow.Timeout(30),
)
```

#### func (*Workflow) HttpPost

```go
func (w *Workflow) HttpPost(name, uri string, opts ...TaskOption) *Task
```

Creates an HTTP POST task.

#### func (*Workflow) HttpPut

```go
func (w *Workflow) HttpPut(name, uri string, opts ...TaskOption) *Task
```

Creates an HTTP PUT task.

#### func (*Workflow) HttpDelete

```go
func (w *Workflow) HttpDelete(name, uri string, opts ...TaskOption) *Task
```

Creates an HTTP DELETE task.

#### func (*Workflow) Set

```go
func (w *Workflow) Set(name, key string, value interface{}) *Task
```

Creates a SET task for single variable.

**Parameters**:
- `name` - Task name
- `key` - Variable name
- `value` - Variable value

**Returns**:
- `*Task` - Created task

#### func (*Workflow) SetVars

```go
func (w *Workflow) SetVars(name string, pairs ...interface{}) *Task
```

Creates a SET task for multiple variables.

**Parameters**:
- `name` - Task name
- `pairs` - Key-value pairs (alternating)

**Returns**:
- `*Task` - Created task

**Example**:
```go
wf.SetVars("process",
    "title", fetchTask.Field("title"),
    "body", fetchTask.Field("body"),
    "status", "complete",
)
```

#### func (*Workflow) AgentCall

```go
func (w *Workflow) AgentCall(name string, agent *agent.Agent, opts ...TaskOption) *Task
```

Creates an AGENT_CALL task.

**Parameters**:
- `name` - Task name
- `agent` - Agent to call
- `opts` - Agent call options

**Returns**:
- `*Task` - Created task

#### func (*Workflow) AgentCallBySlug

```go
func (w *Workflow) AgentCallBySlug(name, slug string, opts ...TaskOption) *Task
```

Creates an AGENT_CALL task by slug.

#### func (*Workflow) Wait

```go
func (w *Workflow) Wait(name string, opts ...TaskOption) *Task
```

Creates a WAIT task.

**Parameters**:
- `name` - Task name
- `opts` - Wait options (duration or until)

**Returns**:
- `*Task` - Created task

#### func (*Workflow) Listen

```go
func (w *Workflow) Listen(name string, opts ...TaskOption) *Task
```

Creates a LISTEN task.

#### func (*Workflow) Raise

```go
func (w *Workflow) Raise(name string, opts ...TaskOption) *Task
```

Creates a RAISE task.

#### func (*Workflow) Switch

```go
func (w *Workflow) Switch(name string, opts ...TaskOption) *Task
```

Creates a SWITCH task for conditional logic.

**Example**:
```go
wf.Switch("check-status",
    workflow.SwitchCase(
        workflow.ConditionEquals("status", "success"),
        workflow.Then(successTask),
    ),
    workflow.SwitchDefault(defaultTask),
)
```

#### func (*Workflow) ForEach

```go
func (w *Workflow) ForEach(name string, opts ...TaskOption) *Task
```

Creates a FOR task for iteration.

**Example**:
```go
wf.ForEach("process-items",
    workflow.ForEachOver(fetchTask.Field("items")),
    workflow.ForEachItem("item"),
    workflow.ForEachDo(processTask),
)
```

#### func (*Workflow) Try

```go
func (w *Workflow) Try(name string, opts ...TaskOption) *Task
```

Creates a TRY task for error handling.

**Example**:
```go
wf.Try("safe-operation",
    workflow.TryDo(riskyTask),
    workflow.CatchError(
        workflow.ErrorMatcher(workflow.ErrorCode("TIMEOUT")),
        workflow.CatchDo(handleTimeoutTask),
    ),
)
```

#### func (*Workflow) Fork

```go
func (w *Workflow) Fork(name string, opts ...TaskOption) *Task
```

Creates a FORK task for parallel execution.

**Example**:
```go
wf.Fork("parallel-fetch",
    workflow.ForkBranch("branch1", task1),
    workflow.ForkBranch("branch2", task2),
    workflow.ForkBranch("branch3", task3),
)
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

### Workflow Options

#### func WithNamespace

```go
func WithNamespace(ns string) Option
```

Sets workflow namespace (required).

#### func WithName

```go
func WithName(name string) Option
```

Sets workflow name (required).

#### func WithVersion

```go
func WithVersion(version string) Option
```

Sets workflow version (required, semantic version).

#### func WithDescription

```go
func WithDescription(desc string) Option
```

Sets workflow description (optional).

### HTTP Task Options

#### func Header

```go
func Header(key, value string) TaskOption
```

Adds HTTP header.

#### func Body

```go
func Body(data interface{}) TaskOption
```

Sets HTTP request body.

#### func Timeout

```go
func Timeout(seconds int) TaskOption
```

Sets request timeout.

#### func Query

```go
func Query(key, value string) TaskOption
```

Adds query parameter.

### Agent Call Options

#### func AgentInput

```go
func AgentInput(key string, value interface{}) TaskOption
```

Sets agent input variable.

#### func AgentModel

```go
func AgentModel(model string) TaskOption
```

Overrides agent LLM model.

#### func AgentTemperature

```go
func AgentTemperature(temp float64) TaskOption
```

Sets agent temperature (0.0-1.0).

#### func AgentMaxTokens

```go
func AgentMaxTokens(tokens int) TaskOption
```

Limits agent response tokens.

#### func AgentTimeout

```go
func AgentTimeout(seconds int) TaskOption
```

Sets agent execution timeout.

### Wait Task Options

#### func WaitDuration

```go
func WaitDuration(duration string) TaskOption
```

Waits for duration (e.g., "30s", "5m", "1h").

#### func WaitUntil

```go
func WaitUntil(timestamp string) TaskOption
```

Waits until timestamp (ISO 8601 format).

### Signal Task Options

#### func SignalName

```go
func SignalName(name string) TaskOption
```

Sets signal name for LISTEN/RAISE tasks.

#### func SignalPayload

```go
func SignalPayload(data interface{}) TaskOption
```

Sets signal payload for RAISE tasks.

#### func ListenTimeout

```go
func ListenTimeout(seconds int) TaskOption
```

Sets timeout for LISTEN tasks.

### Switch Task Options

#### func SwitchCase

```go
func SwitchCase(condition Condition, opts ...TaskOption) TaskOption
```

Adds conditional case to SWITCH task.

#### func SwitchDefault

```go
func SwitchDefault(tasks ...*Task) TaskOption
```

Sets default case for SWITCH task.

#### func Then

```go
func Then(tasks ...*Task) TaskOption
```

Sets tasks to execute when condition matches.

### Condition Helpers

#### func ConditionEquals

```go
func ConditionEquals(key string, value interface{}) Condition
```

Creates equality condition.

#### func ConditionNotEquals

```go
func ConditionNotEquals(key string, value interface{}) Condition
```

Creates inequality condition.

#### func ConditionGreaterThan

```go
func ConditionGreaterThan(key string, value interface{}) Condition
```

Creates greater-than condition.

#### func ConditionLessThan

```go
func ConditionLessThan(key string, value interface{}) Condition
```

Creates less-than condition.

#### func ConditionContains

```go
func ConditionContains(key, substring string) Condition
```

Creates string-contains condition.

### ForEach Task Options

#### func ForEachOver

```go
func ForEachOver(array interface{}) TaskOption
```

Sets array to iterate over.

#### func ForEachItem

```go
func ForEachItem(varName string) TaskOption
```

Sets loop item variable name.

#### func ForEachIndex

```go
func ForEachIndex(varName string) TaskOption
```

Sets loop index variable name.

#### func ForEachDo

```go
func ForEachDo(tasks ...*Task) TaskOption
```

Sets tasks to execute per iteration.

### Try Task Options

#### func TryDo

```go
func TryDo(tasks ...*Task) TaskOption
```

Sets tasks for try block.

#### func CatchError

```go
func CatchError(matcher ErrorMatcher, opts ...TaskOption) TaskOption
```

Adds error catch handler.

#### func CatchDo

```go
func CatchDo(tasks ...*Task) TaskOption
```

Sets tasks for catch block.

### Error Matchers

#### func ErrorMatcher

```go
func ErrorMatcher(match ErrorMatch) ErrorMatcher
```

Creates error matcher.

#### func ErrorCode

```go
func ErrorCode(code string) ErrorMatch
```

Matches specific error code.

#### func ErrorType

```go
func ErrorType(errorType string) ErrorMatch
```

Matches error type.

#### func ErrorAny

```go
func ErrorAny() ErrorMatch
```

Matches any error.

### Fork Task Options

#### func ForkBranch

```go
func ForkBranch(name string, tasks ...*Task) TaskOption
```

Adds parallel branch to FORK task.

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

### Loop Variables

```go
func LoopVar(path string) interface{}
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

**Version**: 0.1.0  
**Last Updated**: 2026-01-22
