# Stigmer CLI Learning Log

This document captures lessons learned during Stigmer CLI development, organized by topic for quick reference.

## Purpose

Before solving a problem, check here first:
- Has this issue been solved before?
- Is there a documented pattern?
- What was the root cause last time?

After solving a new problem, add it here to help future work.

---

## Module & Dependencies

### 2026-01-20 - Go Module Distribution with Generated Protobuf Code

**Problem**: `stigmer new` command was failing during dependency installation with module resolution errors:
```
unknown revision apis/stubs/go/v0.0.0
missing github.com/stigmer/stigmer/apis/stubs/go/go.mod at revision ...
```

External users couldn't use the `stigmer new` command because Go couldn't resolve the SDK's dependency on generated protobuf stubs.

**Root Cause**: 
1. Generated protobuf stubs (`apis/stubs/`) were in `.gitignore`, so they didn't exist in GitHub repository
2. SDK's `go.mod` required `github.com/stigmer/stigmer/apis/stubs/go v0.0.0` with a replace directive pointing to relative path
3. Replace directive (`replace ... => ../../apis/stubs/go`) only worked for local development, not external users
4. When external users ran `go get @latest`, Go tried to fetch stubs from GitHub but couldn't find them

**Solution**: Track generated stubs in git and use proper pseudo-versions:

**1. Track Generated Code**:
```bash
# Remove stubs/ from .gitignore
# Commit ~495 generated protobuf files to repository
git add apis/stubs/
```

**Why**: Go module dependencies must be resolvable externally. Tracking generated code is standard practice for Go projects with protobuf dependencies (similar to grpc-go, protobuf-go).

**2. Use Pseudo-Versions**:
```go
// sdk/go/go.mod - Before
require (
    github.com/stigmer/stigmer/apis/stubs/go v0.0.0
)

// sdk/go/go.mod - After  
require (
    github.com/stigmer/stigmer/apis/stubs/go v0.0.0-20260120004624-4578a34f018e
)
```

**Pseudo-version format**: `v0.0.0-YYYYMMDDHHMMSS-commithash12chars`

This tells Go exactly where to find the module in the git repository history.

**3. Generate go.mod with Replace Directives**:
```go
// client-apps/cli/cmd/stigmer/root/new.go
func generateGoMod(projectName string) string {
    return fmt.Sprintf(`module %s

go 1.24

require (
    github.com/stigmer/stigmer/sdk/go v0.0.0-00010101000000-000000000000
)

replace github.com/stigmer/stigmer/sdk/go => github.com/stigmer/stigmer/sdk/go v0.0.0-20260120005545-fc443b1640d1

replace github.com/stigmer/stigmer/apis/stubs/go => github.com/stigmer/stigmer/apis/stubs/go v0.0.0-20260120005545-fc443b1640d1
`, moduleName)
}
```

This ensures generated projects use a version that has the stubs tracked in git.

**Prevention**:
- **Test external usage**: Run `go get github.com/yourmodule@latest` from outside the repository to verify external users can resolve dependencies
- **Avoid relative path replace directives** in published modules - they only work for local development
- **Consider semantic versioning**: For production SDKs, use proper releases with semantic versions (v1.0.0, v1.1.0, etc.)
- **Document distribution strategy**: Explain to contributors how the SDK is distributed and why generated code is tracked

**Alternative Solutions Considered**:
1. **Separate stubs repository**: More complex, requires CI/CD to publish stubs automatically
2. **Bundle stubs into SDK**: Code duplication, larger SDK module
3. **User-generated stubs**: Poor UX, requires users to run code generation tools
4. **Current solution (track generated code)**: Pragmatic, follows industry standards

**Key Takeaways**:
- Replace directives with relative paths (`=> ../some/path`) only work inside the repository
- External users need all dependencies available in the repository or published separately
- Pseudo-versions work for unversioned modules: `v0.0.0-timestamp-commit`
- Generated code distribution requires architectural decisions upfront

**Related Docs**: 
- Changelog: `_changelog/2026-01/2026-01-20-063010-fix-stigmer-new-module-dependencies.md`
- Fix summary: `_cursor/fix-summary.md`
- Branch: `fix/stigmer-new-command`

**Example Testing External Usage**:
```bash
# Create test outside repository
cd /tmp
mkdir test-sdk-external
cd test-sdk-external

# Try to use SDK
go mod init test
go get github.com/stigmer/stigmer/sdk/go@latest

# Should succeed with proper pseudo-versions and tracked stubs
```

---

## CLI Commands


### 2026-01-20 - Auto-Initialization Pattern for First-Run Setup

**Problem**: Requiring separate `stigmer init` and `stigmer server` commands creates friction:
- Users confused about which command to run first
- Documentation needs to explain two-step process
- Error messages when users skip init are unhelpful
- Mental overhead: "Did I run init? Do I need to?"

**Root Cause**: Treating initialization as separate user action instead of internal implementation detail. Users don't care about "initialization" - they just want to start the server.

**Solution**: Auto-detect first run and initialize automatically within `stigmer server`:

```go
func handleServerStart() {
    // Auto-initialize config if needed
    if !config.IsInitialized() {
        cliprint.PrintInfo("First-time setup: Initializing Stigmer...")
        cfg := config.GetDefault()
        if err := config.Save(cfg); err != nil {
            // Handle error
            return
        }
        cliprint.PrintSuccess("Created configuration...")
    }
    
    // Proceed with server start
    startServer(dataDir)
}
```

**Prevention**: 
- For any CLI that needs setup, check and auto-initialize in the main command
- Don't expose initialization as separate user-facing command
- Make it an implementation detail, not a user requirement

**Example**:
- ❌ Bad: `myapp init` then `myapp start`
- ✅ Good: `myapp start` (auto-initializes)

**Related Docs**: 
- CLI refactoring changelog (_changelog/2026-01/2026-01-20-043947-simplify-cli-commands-server-pattern.md)
- COMMANDS.md (updated quick start)

---

### 2026-01-20 - Command Consolidation Strategy

**Problem**: Too many commands with overlapping functionality:
- `stigmer init` and `stigmer local` both start the daemon
- `stigmer local` vs `stigmer local start` ambiguity
- Users unsure which command to use
- Maintenance burden of multiple command paths

**Root Cause**: Creating separate commands for conceptually related actions instead of using command hierarchies with sensible defaults.

**Solution**: Consolidate related commands with implicit default action:

```go
// Before: Two separate commands
rootCmd.AddCommand(newInitCommand())      // Creates config + starts
rootCmd.AddCommand(newLocalCommand())     // Manages daemon

// After: One command with subcommands
rootCmd.AddCommand(newServerCommand())    // Default: start (with auto-init)
  serverCmd.AddCommand(newStopCommand())
  serverCmd.AddCommand(newStatusCommand())
  serverCmd.AddCommand(newRestartCommand())
```

**Key Pattern**:
- Main command does the most common action (implicit start)
- Subcommands for less common actions (stop, status, restart)
- Auto-initialization happens transparently

**Prevention**:
- Before adding a command, check if it can be a subcommand or flag
- Default action should be the most common use case
- Avoid commands that differ only in setup vs execution

**Example**:
- ❌ Bad: Multiple top-level commands for same resource
- ✅ Good: One resource command with subcommands

**Related Docs**: 
- CLI refactoring changelog
- COMMANDS.md (new structure)

---

### 2026-01-20 - Industry-Standard Naming for Clarity

**Problem**: Generic/vague command names confuse users:
- `stigmer local` - local what? local mode? local file?
- Users compare to similar tools and expect familiar patterns
- Generic names don't communicate intent clearly

**Root Cause**: Choosing names based on internal concepts rather than user mental models and industry conventions.

**Solution**: Use industry-standard naming that matches user expectations:

**Research industry patterns**:
- Temporal: `temporal server start-dev`
- Redis: `redis-server`
- PostgreSQL: `postgres` 
- Minikube: `minikube start`

**Choose familiar name**:
- ❌ `stigmer local` (vague)
- ✅ `stigmer server` (clear - you're starting a server)

**Prevention**:
- Research how similar tools name their commands
- Use nouns that match user mental models (server, daemon, etc.)
- Avoid internal terminology (local, remote, backend) as command names
- Test name with someone unfamiliar - if they can guess what it does, it's good

**Example Patterns**:
- Server management: `server`, `daemon`, `service`
- Resource management: `create`, `get`, `list`, `delete`
- Execution: `run`, `exec`, `execute`

**Related Docs**: 
- CLI refactoring changelog (design rationale section)
- README.md (industry comparisons)

---

### 2026-01-20 - CLI Focus: Lifecycle vs CRUD

**Problem**: CLI had CRUD commands for agents/workflows using flags:
```bash
stigmer agent create --name X --instructions Y --model Z ...
stigmer workflow create --name X --description Y ...
```
This is cumbersome:
- Too many flags to remember
- Can't version-control resource definitions
- Can't review changes in PRs
- Hard to create complex configurations

**Root Cause**: Trying to do resource management via CLI flags instead of declarative configuration files.

**Solution**: Focus CLI on lifecycle management, use declarative files for CRUD:

**CLI Purpose** (Lifecycle):
```bash
stigmer server              # Start/stop server
stigmer server status       # Check status
stigmer backend set local   # Configure backend
```

**Not CLI Purpose** (Resource CRUD):
- ❌ Creating agents/workflows via CLI flags
- ✅ Use Temporal UI during development
- ✅ Use YAML files for production: `stigmer apply -f agent.yaml` (future)

**Prevention**:
- CLI should manage daemon/server lifecycle, not resource CRUD
- Resource definitions belong in version-controlled YAML files
- Use UI for interactive development, YAML for production
- Only add CLI CRUD as convenience layer on top of YAML (not flags)

**Example**:
```yaml
# agents/support-bot.yaml
apiVersion: stigmer.ai/v1
kind: Agent
metadata:
  name: support-bot
spec:
  instructions: "You are a helpful support agent"
  model: claude-3-sonnet
```

```bash
stigmer apply -f agents/support-bot.yaml  # Future
```

**Related Docs**: 
- COMMANDS.md (future roadmap)
- README.md (resource management section)

