# Stigmer Go SDK Documentation

**Version**: 0.1.0  
**Status**: ✅ Production Ready

Complete documentation for the Stigmer Go SDK.

## Quick Navigation

### 🚀 New to Stigmer?

**Start here**: [Getting Started Guide](GETTING_STARTED.md)

Learn how to:
- Install the SDK and CLI
- Create your first agent (5 minutes)
- Create your first workflow (5 minutes)
- Deploy to Stigmer Cloud

### 📖 Building with Stigmer

**Comprehensive guide**: [Usage Guide](USAGE.md)

Covers:
- Workflow SDK (HTTP tasks, conditionals, loops, error handling, parallel execution)
- Agent SDK (skills, MCP servers, sub-agents, environment variables)
- Skill SDK (inline and referenced skills)
- Advanced features (Switch, ForEach, Try/Catch, Fork)
- Helper functions (string ops, JSON, temporal, arrays)
- Best practices

### 📚 API Reference

**Complete API docs**: [API Reference](API_REFERENCE.md)

Detailed documentation for:
- `stigmer` - Context and resource management
- `agent` - Agent builder
- `skill` - Skill definitions
- `workflow` - Workflow orchestration
- `mcpserver` - MCP server configurations
- `subagent` - Sub-agent delegation
- `environment` - Environment variables

### 💡 Examples

**19 working examples**: [examples/](../examples/)

**Agent Examples**:
1. Basic Agent
2. Agent with Skills
3. Agent with MCP Servers
4. Agent with Sub-Agents
5. Agent with Environment Variables
6. Agent with Instructions from Files ⭐

**Workflow Examples (Basic)**:
7. Basic Workflow ⭐
8. Workflow with Conditionals ✅
9. Workflow with Loops
10. Workflow with Error Handling
11. Workflow with Parallel Execution

**Workflow Examples (Advanced)**:
12. Agent with Typed Context
13. Workflow and Agent Shared Context
14. Workflow with Runtime Secrets
15. Workflow Calling Simple Agent
16. Workflow Calling Agent by Slug
17. Workflow Agent with Runtime Secrets
18. Workflow Multi-Agent Orchestration ⭐
19. Workflow Agent Execution Config

⭐ = Recommended starting points  
✅ = Test passing

---

## Documentation Structure

```
docs/
├── README.md (this file)          # Documentation index
├── GETTING_STARTED.md             # Beginner's guide
├── USAGE.md                       # Comprehensive usage guide
└── API_REFERENCE.md               # Complete API reference
```

---

## Learning Path

### 1. Absolute Beginner

Never used Stigmer before?

1. **Read**: [Getting Started Guide](GETTING_STARTED.md) (10 minutes)
2. **Try**: Example 01 (Basic Agent) and Example 07 (Basic Workflow)
3. **Build**: Your first agent or workflow
4. **Deploy**: `stigmer apply main.go`

### 2. Building Production Systems

Ready to build real applications?

1. **Read**: [Usage Guide](USAGE.md) - Focus on your needs:
   - Building agents → Agent SDK section
   - Building workflows → Workflow SDK section
   - Advanced workflows → Advanced Features section
2. **Study**: Examples 06 (file-based agent) and 18 (multi-agent orchestration)
3. **Reference**: [API Reference](API_REFERENCE.md) as needed
4. **Build**: Your production system

### 3. Advanced User

Need specific APIs or patterns?

1. **Jump to**: [API Reference](API_REFERENCE.md)
2. **Search**: Package-specific documentation
3. **Check**: [pkg.go.dev](https://pkg.go.dev/github.com/stigmer/stigmer/sdk/go)

---

## Key Concepts

### The stigmer.Run() Pattern

Everything starts here:

```go
stigmer.Run(func(ctx *stigmer.Context) error {
    // Create resources
    agent, _ := agent.New(ctx, ...)
    wf, _ := workflow.New(ctx, ...)
    
    return nil
})
```

**What it does**:
- Creates context for resource management
- Tracks dependencies automatically
- Synthesizes resources to proto
- Handles cleanup

### Automatic Dependency Tracking

Dependencies are tracked through references:

```go
// Create skill
skill, _ := skill.New(skill.WithName("coding"))

// Agent automatically depends on skill
agent, _ := agent.New(ctx,
    agent.WithName("reviewer"),
    agent.WithSkills(skill),
)
// → Dependency tracked: "agent:reviewer" → "skill:coding"
```

### File-Based Content (Best Practice)

Load content from files, not inline strings:

```go
// ✅ Recommended
agent, _ := agent.New(ctx,
    agent.WithName("reviewer"),
    agent.WithInstructionsFromFile("instructions/reviewer.md"),
)

skill, _ := skill.New(
    skill.WithName("guidelines"),
    skill.WithMarkdownFromFile("skills/guidelines.md"),
)
```

**Why**:
- Version control friendly
- Easy to edit
- Separate concerns
- Better collaboration

### Type-Safe Task References

Reference task outputs with compile-time safety:

```go
fetchTask := wf.HttpGet("fetch", endpoint)

// Type-safe field reference
processTask := wf.SetVars("process",
    "title", fetchTask.Field("title"),  // Compile-time checked!
)
```

---

## Common Use Cases

### Use Case 1: Code Review Agent

**Goal**: AI agent that reviews code with specific guidelines

**Solution**:
- Create skill with coding guidelines from file
- Create agent with instructions from file
- Add GitHub MCP server for code access

**Example**: See [examples/06_agent_with_instructions_from_files.go](../examples/06_agent_with_instructions_from_files.go)

**Documentation**: [Agent SDK in Usage Guide](USAGE.md#agent-sdk)

### Use Case 2: API Data Pipeline

**Goal**: Workflow that fetches, processes, and stores data

**Solution**:
- HTTP GET task to fetch data
- SET task to process/transform
- HTTP POST task to store results
- Automatic dependency tracking

**Example**: See [examples/07_workflow_with_runtime_secrets.go](../examples/07_workflow_with_runtime_secrets.go)

**Documentation**: [Workflow SDK in Usage Guide](USAGE.md#workflow-sdk)

### Use Case 3: Multi-Agent CI/CD

**Goal**: Complex pipeline with specialized agents

**Solution**:
- Multiple agents with different skills
- Workflow orchestrating agent calls
- Error handling and parallel execution
- Runtime secrets for credentials

**Example**: See [examples/18_workflow_multi_agent_orchestration.go](../examples/18_workflow_multi_agent_orchestration.go)

**Documentation**: [Advanced Features in Usage Guide](USAGE.md#advanced-features)

---

## Quick Reference

### Agent Creation

```go
agent, err := agent.New(ctx,
    agent.WithName("my-agent"),
    agent.WithInstructionsFromFile("instructions/agent.md"),
    agent.WithSkills(skill),
)
```

### Workflow Creation

```go
wf, err := workflow.New(ctx,
    workflow.WithNamespace("my-namespace"),
    workflow.WithName("my-workflow"),
    workflow.WithVersion("1.0.0"),
)
```

### HTTP Task

```go
task := wf.HttpGet("fetch", "https://api.example.com/data",
    workflow.Header("Content-Type", "application/json"),
    workflow.Timeout(30),
)
```

### SET Task

```go
wf.SetVars("process",
    "key1", "value1",
    "key2", fetchTask.Field("output"),
)
```

### Conditionals (Switch)

```go
wf.Switch("check",
    workflow.SwitchCase(
        workflow.ConditionEquals("status", "success"),
        workflow.Then(successTask),
    ),
    workflow.SwitchDefault(defaultTask),
)
```

### Loops (ForEach)

```go
wf.ForEach("process-items",
    workflow.ForEachOver(fetchTask.Field("items")),
    workflow.ForEachItem("item"),
    workflow.ForEachDo(processTask),
)
```

### Error Handling (Try/Catch)

```go
wf.Try("safe-operation",
    workflow.TryDo(riskyTask),
    workflow.CatchError(
        workflow.ErrorMatcher(workflow.ErrorAny()),
        workflow.CatchDo(handleErrorTask),
    ),
)
```

### Parallel Execution (Fork)

```go
wf.Fork("parallel",
    workflow.ForkBranch("branch1", task1),
    workflow.ForkBranch("branch2", task2),
)
```

---

## Documentation Conventions

### Code Examples

All code examples are:
- ✅ Tested and working
- ✅ Copy-paste ready
- ✅ Include imports and error handling
- ✅ Follow best practices

### Validation Rules

Documented for all options:
- Format requirements
- Length limits
- Allowed characters
- Examples of valid/invalid values

### Error Messages

Examples include:
- What went wrong
- Why it's wrong
- How to fix it

---

## External Resources

### Official Links

- **Website**: [stigmer.ai](https://stigmer.ai)
- **Documentation**: [docs.stigmer.ai](https://docs.stigmer.ai)
- **GitHub**: [github.com/stigmer/stigmer](https://github.com/stigmer/stigmer)
- **pkg.go.dev**: [pkg.go.dev/github.com/stigmer/stigmer/sdk/go](https://pkg.go.dev/github.com/stigmer/stigmer/sdk/go)

### Community

- **Discord**: [stigmer.ai/discord](https://stigmer.ai/discord)
- **GitHub Issues**: [github.com/stigmer/stigmer/issues](https://github.com/stigmer/stigmer/issues)
- **GitHub Discussions**: [github.com/stigmer/stigmer/discussions](https://github.com/stigmer/stigmer/discussions)

### Related Documentation

- **CLI Documentation**: [CLI README](../../../client-apps/cli/README.md)
- **API Protos**: [apis/](../../../apis/)
- **Platform Docs**: [docs.stigmer.ai](https://docs.stigmer.ai)

---

## Contributing

Contributions to documentation are welcome!

**How to contribute**:
1. Fix typos or improve clarity
2. Add missing examples
3. Improve explanations
4. Add common use cases

**Guidelines**:
- Keep examples simple and focused
- Test all code examples
- Follow existing style
- Update all related docs

---

## Version History

### v0.1.0 (2026-01-22)

**Initial Release**:
- ✅ Complete Getting Started Guide
- ✅ Comprehensive Usage Guide
- ✅ Full API Reference
- ✅ 19 Working Examples
- ✅ Production Ready

---

## Need Help?

**Can't find what you need?**

1. **Search this documentation** - Use your browser's search (Cmd/Ctrl+F)
2. **Check examples** - 19 examples covering all features
3. **Ask in Discord** - [stigmer.ai/discord](https://stigmer.ai/discord)
4. **Open an issue** - [GitHub Issues](https://github.com/stigmer/stigmer/issues)

**Found a bug in documentation?**

Please [open an issue](https://github.com/stigmer/stigmer/issues/new) with:
- Which document (file name)
- What's wrong or unclear
- Suggestion for improvement (optional)

---

## Summary

You have access to:

- ✅ **3 comprehensive guides** (Getting Started, Usage, API Reference)
- ✅ **19 working examples** (agents, workflows, advanced features)
- ✅ **Complete API documentation** (all packages and functions)
- ✅ **Best practices** (file-based content, error handling, organization)
- ✅ **Production-ready SDK** (tested, validated, deployed)

**Ready to build?** Start with the [Getting Started Guide](GETTING_STARTED.md)!

---

**Version**: 0.1.0  
**Last Updated**: 2026-01-22  
**Status**: ✅ Complete
