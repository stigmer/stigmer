# Stigmer SDK Templates

This package provides canonical code templates for the Stigmer SDK. These templates serve as the **single source of truth** for generated code used by the CLI and documentation.

## Purpose

The templates package solves the "dual source of truth" problem:

**Before** (Problematic):
```
SDK Examples → (manual sync) → CLI Hardcoded Strings → User Code
```
Problems: drift, breakage, maintenance burden

**After** (Template Package):
```
SDK Templates Package → (import) → CLI → User Code
```
Benefits: automatic sync, compile-time validation, zero drift

## Templates

### BasicAgent()

Minimal agent example with only required fields.

**Used by**: `stigmer init --template=agent`

**Demonstrates**:
- `agent.New()` with required fields
- `stigmer.Run()` pattern
- Simple joke-telling agent

### BasicWorkflow()

Simple HTTP workflow with implicit task dependencies.

**Used by**: `stigmer init --template=workflow`

**Demonstrates**:
- `workflow.New()` with context
- HTTP GET task
- Implicit dependencies via field references
- Context variables (`ctx.SetString()`)

### AgentAndWorkflow()

Combined example showing agent-workflow integration with GitHub repository analysis.

**Used by**: `stigmer init` (default)

**Demonstrates**:
- Creating specialized agents (repository analyzer)
- Building workflows that call agents (`workflow.CallAgent()`)
- Real-world API integration (GitHub API)
- Context variables for configuration (`ctx.SetString()`)
- Task chaining with field references
- Passing API data to AI agent for analysis
- Environment variables in agent execution
- Professional data processing pattern

## Usage

### From CLI

The Stigmer CLI imports templates directly:

```go
import "github.com/leftbin/stigmer-sdk/go/templates"

func generateMainGoContent() string {
    return templates.AgentAndWorkflow()
}
```

### From Documentation

Documentation can reference these templates as canonical examples:

```markdown
The following example is exported as `templates.BasicAgent()`:

[insert template code here]
```

### From Examples

SDK examples should reference templates when applicable:

```go
// File: examples/01_basic_agent.go
//
// This example is the canonical BasicAgent template.
// See: github.com/leftbin/stigmer-sdk/go/templates.BasicAgent()
```

## Testing

Templates have comprehensive tests to ensure:

1. **Valid syntax** - Go parser validates code structure
2. **Compilation** - Templates compile with `go build`
3. **Correct APIs** - Only existing SDK functions are called
4. **No deprecated APIs** - Guards against bugs like `NewWithContext()`

Run tests:

```bash
go test ./templates
```

Run with compilation checks (slower):

```bash
go test ./templates -v
```

## Architecture Benefits

### 1. Compile-Time Validation

Templates are Go code checked when the CLI builds. If a template breaks, the CLI build fails immediately.

### 2. Single Source of Truth

Templates live in the SDK. CLI imports them. No duplication, no drift.

### 3. Automatic Sync

SDK changes flow through imports. No manual synchronization needed.

### 4. Type Safety

Templates use actual SDK functions. Compiler catches breaking changes.

### 5. Testability

Templates can be parsed, compiled, and executed in tests. Broken templates fail CI.

## Maintenance

### Adding New Templates

1. Add function to `templates.go`:

```go
func MyNewTemplate() string {
    return `package main
    // ... your template code ...
    `
}
```

2. Add tests in `templates_test.go`:

```go
func TestMyNewTemplate(t *testing.T) {
    code := templates.MyNewTemplate()
    verifyValidGoCode(t, "MyNewTemplate", code)
    // ... more assertions ...
}
```

3. Document in this README

4. Update CLI if needed to use new template

### Updating Existing Templates

When SDK APIs change:

1. Update template function in `templates.go`
2. Tests will catch syntax errors
3. CLI build will catch import errors
4. No manual CLI updates needed (import handles it)

### Deprecating Templates

To remove a template:

1. Mark as deprecated with comment
2. Update CLI to stop using it
3. Wait one release cycle
4. Remove template and tests

## Examples

### CLI Integration

```go
// cli/cmd/stigmer/root/init.go

import (
    "github.com/leftbin/stigmer-sdk/go/templates"
)

func generateMainGoContent() string {
    // ✅ Import from SDK - automatic sync!
    return templates.AgentAndWorkflow()
}
```

### Documentation Integration

```markdown
## Quick Start

Run `stigmer init` to create a new project:

```bash
stigmer init my-project
```

This generates a project using the `AgentAndWorkflow` template,
which demonstrates both agent and workflow creation.

See the [template source](https://github.com/leftbin/stigmer-sdk/blob/main/go/templates/templates.go)
for the complete code.
```

## Design Philosophy

### Why Template-as-Code?

**Alternatives considered**:

1. **String templates in CLI** ❌
   - Pro: Simple
   - Con: No validation, drift, maintenance burden

2. **Separate template files** ❌
   - Pro: Easier to edit
   - Con: No compile-time checking, requires asset embedding

3. **Code generation from examples** ❌
   - Pro: Examples are templates
   - Con: Complex tooling, examples may not be ideal templates

4. **Template-as-Code** ✅
   - Pro: Compile-time validation, automatic sync, testable
   - Con: Templates are Go strings (less readable than files)

We chose **template-as-code** because:
- Compile-time safety is critical
- Import-based sync is bulletproof
- Tests verify templates actually work
- Trade-off of string formatting is acceptable

### Why in SDK?

Templates belong in the SDK because:

1. **SDK owns the API** - Templates demonstrate SDK usage
2. **SDK evolves first** - Templates update with SDK changes
3. **CLI is a consumer** - CLI uses SDK, shouldn't define how
4. **Documentation alignment** - Docs reference SDK, not CLI

## Troubleshooting

### Template doesn't compile

Run tests to identify the issue:

```bash
cd go/templates
go test -v
```

Check:
- Syntax errors (parser test will catch)
- Import paths (compilation test will catch)
- Function signatures (API test will catch)

### CLI generates broken code

This shouldn't happen if tests pass. If it does:

1. Verify CLI is using latest SDK version
2. Check go.mod replace directives
3. Run `go mod tidy` in CLI
4. Rebuild CLI binary

### Template out of sync with examples

Update the example to reference the template:

```go
// File: examples/01_basic_agent.go
//
// ⚠️ This example matches templates.BasicAgent() - keep in sync!
// See: go/templates/templates.go
```

Or better, add a test that compares them:

```go
func TestExampleMatchesTemplate(t *testing.T) {
    exampleCode := readExampleFile("01_basic_agent.go")
    templateCode := templates.BasicAgent()
    // Compare or assert similarity
}
```

## Future Enhancements

Potential improvements:

1. **Parameterization** - Allow customizing agent names, endpoints, etc.
2. **Template variants** - Advanced versions with MCP servers, subagents
3. **Language-specific** - Python templates for Python SDK
4. **Interactive selection** - CLI prompts which template to use
5. **Template composition** - Mix and match features

## Related

- **SDK Examples**: `stigmer-sdk/go/examples/` - More comprehensive examples
- **CLI Init**: `stigmer/client-apps/cli/cmd/stigmer/root/init.go` - Uses templates
- **Documentation**: `stigmer-sdk/docs/` - References templates

---

**Maintained by**: Stigmer SDK Team  
**Questions**: See main [SDK README](../README.md)
