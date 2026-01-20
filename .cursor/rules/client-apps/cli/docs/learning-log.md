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

### 2026-01-20 - Pulumi-Inspired Validation Philosophy: Trust Compiler, Validate Outcomes

**Problem**: String-based import validation was brittle and maintenance-heavy:
```go
// Brittle: Checking for specific import paths
hasAgentImport := strings.Contains(contentStr, "github.com/stigmer/stigmer-sdk/go/agent")
if !hasAgentImport && !hasWorkflowImport && !hasStigmerImport {
    return errors.New("file must import Stigmer SDK")
}
```

**Issues**:
1. Broke when import paths changed (monorepo vs separate repo)
2. Duplicated Go compiler's job
3. Poor error messages ("must import SDK" vs specific compiler errors)
4. Maintenance burden (update paths every structure change)
5. False validation (checking imports doesn't mean code works)

**Root Cause**: Trying to validate syntax/imports pre-execution instead of trusting language tooling and validating outcomes.

**Solution**: Adopt Pulumi's philosophy - trust the compiler, validate results:

**Pulumi's Approach**:
1. Run user code with native tooling (\`go run\`, \`python\`, \`node\`)
2. Let compiler/interpreter catch syntax/import errors
3. Check if resources were registered (validate outcomes)
4. Provide helpful errors if no resources found

**Implementation**:
```go
// ❌ REMOVED: Pre-validation of imports
err = agent.ValidateGoFile(mainFilePath)

// ✅ NEW: Execute directly, let Go compiler handle imports
manifestResult, err := agent.ExecuteGoAgentAndGetManifest(mainFilePath)
if err != nil {
    // Go compiler provides specific error:
    // "main.go:10:2: undefined: agent" (much better!)
    return err
}

// ✅ Validate outcome: Were resources created?
if result.AgentManifest == nil && result.WorkflowManifest == nil {
    return errors.New("no resources were created - your code must use Stigmer SDK\n\n" +
        "Example:\n" +
        "  import \"github.com/stigmer/stigmer/sdk/go/stigmer\"\n" +
        "  ...\n")
}
```

**Benefits**:
- **More robust**: Works with any import path structure
- **Better errors**: Go compiler errors are specific ("undefined: agent" vs "must import SDK")
- **Simpler code**: Removed 30+ lines of validation logic
- **Less maintenance**: No import paths to update
- **Pulumi-like UX**: Trust language tooling, validate meaningful outcomes

**Prevention**:
- **Don't duplicate compiler's job**: If the language toolchain validates something, let it
- **Validate outcomes, not syntax**: Check if resources were created, not how they were imported
- **Trust language tooling**: Go compiler, Python interpreter, TypeScript compiler - they're better at their job than custom validation
- **Better error messages**: Specific compiler errors > generic validation errors
- **Applies to all SDKs**: Python, TypeScript, future languages - same philosophy

**When NOT to pre-validate**:
- ❌ Imports (compiler handles)
- ❌ Syntax (compiler handles)
- ❌ Type correctness (compiler handles)
- ❌ Module resolution (compiler handles)

**When TO validate**:
- ✅ Resource registration (did SDK produce outputs?)
- ✅ Business logic (is organization valid?)
- ✅ Runtime state (is server running?)
- ✅ Manifest structure (is SDK-CLI contract honored?)

**Real-World Impact**:
```bash
# Before: Generic error when import path changed
Error: file must import Stigmer SDK (agent, workflow, or stigmer package)

# After: Specific Go compiler error OR successful execution
✓ Manifest loaded: 2 resource(s) discovered (1 agent(s), 1 workflow(s))
```

**Example Testing**:
```bash
# Test with missing import
cat > test.go <<'INNER_EOF'
package main

func main() {
    // Missing stigmer import
    stigmer.Run(func(ctx *stigmer.Context) error {
        return nil
    })
}
INNER_EOF

go run test.go
# Output: test.go:5:2: undefined: stigmer
# Clear, actionable, from Go compiler
```

**Related Docs**:
- Changelog: \`_changelog/2026-01/2026-01-20-084344-remove-brittle-validation-pulumi-approach.md\`
- Validation philosophy comments in \`client-apps/cli/internal/cli/agent/validation.go\`
- Branch: \`fix/stigmer-apply-cmd\`

**Key Takeaway**: When building developer tools, trust the language's native tooling. Validate outcomes (resources created) not syntax (imports present). This applies to all language SDKs - Python, TypeScript, Go, etc.


---

## Backend & Daemon Management

### 2026-01-20 - Auto-Start Daemon Pattern for Runtime Services

**Problem**: Requiring manual `stigmer server start` before commands creates friction:
- Users forget to start daemon
- Error: "cannot connect to server" is confusing on first run  
- Doesn't match user expectations from Docker, Minikube patterns
- Mental overhead: "Did I start the server? Do I need to?"

**Root Cause**: Treating daemon startup as manual user action instead of transparent implementation detail. Users don't care about "starting a daemon" - they just want their commands to work.

**Solution**: Auto-start daemon when needed, inspired by industry patterns:

**Industry Research**:
- **Docker Desktop** ✅: `docker run` auto-starts Docker daemon on first use
- **Minikube** ✅: `minikube start` starts entire Kubernetes cluster
- **Podman Machine (macOS)** ✅: Auto-starts VM when running `podman` commands
- **Temporal CLI** ✅: `temporal server start-dev` for managed runtime

**Key Insight**: Stigmer is a **workflow runtime** (like Docker/Minikube), not just **state management** (like Pulumi). Runtime services justify auto-start.

**Related Docs**:
- Changelog: `_changelog/2026-01/2026-01-20-090202-cli-auto-start-daemon-local-backend.md`
- Architecture: `docs/architecture/backend-modes.md`
- Getting started: `docs/getting-started/local-mode.md`
- Branch: `fix/stigmer-apply-cmd`

**Key Takeaway**: For workflow runtimes (not just state management), auto-start daemon following Docker/Minikube patterns. Fast path optimization for subsequent runs. Only for local mode (cloud connects to remote API).

---

### 2026-01-20 - Backend Mode Organization Handling (Local vs Cloud)

**Problem**: CLI required organization in ALL modes, failing in local mode:
```
Error: organization not set
```

**Solution**: Backend mode-aware organization handling. Local mode uses constant "local", cloud mode requires user-provided organization.

**Related Docs**:
- Changelog: `_changelog/2026-01/2026-01-20-090202-cli-auto-start-daemon-local-backend.md`
- Architecture: `docs/architecture/backend-modes.md`
- Branch: `fix/stigmer-apply-cmd`

**Key Takeaway**: Follow Pulumi's local-first pattern. Local backend = constant "local" organization (zero config). Cloud backend = user-provided organization (required).

---

### 2026-01-20 - gRPC Server Initialization Order and Dependency Injection

**Problem**: `stigmer-server` daemon was crashing immediately after startup with fatal error:
```
FATAL: [core] grpc: Server.RegisterService after Server.Serve for "ai.stigmer.agentic.agent.v1.AgentCommandController"
```

**Impact**:
- Daemon crashed on every startup attempt
- All CLI commands requiring backend connection failed
- `stigmer apply` was completely broken
- Auto-start feature worked but server immediately died

**Root Cause**: The initialization sequence violated gRPC's fundamental requirement that **all services must be registered BEFORE calling `Server.Serve()`**.

**The Circular Dependency Problem**:
```
1. Controllers need client dependencies (Agent, AgentInstance, Workflow clients)
2. Clients need the in-process gRPC server to be started
3. Starting the in-process server calls Serve() internally
4. After Serve() is called, no more services can be registered
5. But some controllers were being registered AFTER Serve() → CRASH
```

**Broken Sequence**:
```go
// ❌ WRONG: This causes fatal gRPC error
RegisterInitialServices()      // ✅ OK
server.StartInProcess()         // ← Calls Serve() internally!
RegisterMoreServices()          // ❌ FATAL - too late!
```

**Solution**: **Dependency Injection via Setters** - Break the circular dependency by separating registration from dependency injection:

**Fixed Sequence**:
```go
// 1. Register ALL services upfront (with nil/placeholder dependencies)
agentController := NewAgentController(store, nil)  // nil = no client yet
grpcServer.RegisterAgentCommandController(agentController)
// ... register all other services ...

// 2. Now it's safe to start the server (all services registered)
server.StartInProcess()  // ✅ Safe now

// 3. Create client connections (server is running)
conn := server.NewInProcessConnection()
agentInstanceClient := NewAgentInstanceClient(conn)

// 4. Inject dependencies via setter methods
agentController.SetAgentInstanceClient(agentInstanceClient)
```

**Pattern: Setter Injection for gRPC Controllers**:

```go
// Controller with setter method
type AgentController struct {
    store               *badger.Store
    agentInstanceClient *agentinstance.Client  // Can be nil initially
}

func NewAgentController(store *badger.Store, client *agentinstance.Client) *AgentController {
    return &AgentController{
        store:               store,
        agentInstanceClient: client,  // OK to be nil at registration time
    }
}

// Setter for late dependency injection
func (c *AgentController) SetAgentInstanceClient(client *agentinstance.Client) {
    c.agentInstanceClient = client
}
```

**Why This Pattern Works**:

✅ **Satisfies gRPC Requirements**
- All services registered before `Serve()` is called
- No more "RegisterService after Serve" errors

✅ **Breaks Circular Dependency**
- Controllers don't need clients at registration time
- Clients can be created after server starts
- Dependencies injected once clients are available

✅ **Maintains In-Process gRPC Benefits**
- Controllers still use full gRPC stack with interceptors
- Single source of truth through interceptor chain
- API resource kind injection still works

✅ **Clean Separation of Concerns**
- **Registration phase**: Pure service registration
- **Initialization phase**: Server startup  
- **Wiring phase**: Dependency injection

**Files Modified**:
1. `backend/services/stigmer-server/cmd/server/main.go` - Fixed initialization order
2. `backend/services/stigmer-server/pkg/domain/agent/controller/agent_controller.go` - Added setter
3. `backend/services/stigmer-server/pkg/domain/agentexecution/controller/agentexecution_controller.go` - Added setter
4. `backend/services/stigmer-server/pkg/domain/workflow/controller/workflow_controller.go` - Added setter
5. `backend/services/stigmer-server/pkg/domain/workflowinstance/controller/workflowinstance_controller.go` - Added setter
6. `backend/services/stigmer-server/pkg/domain/workflowexecution/controller/workflowexecution_controller.go` - Added setter

**Prevention**:

**Critical Rule**: **Register ALL gRPC services BEFORE calling `Serve()` or `StartInProcess()`**

- ❌ **Never** register services after calling `server.Start()`, `server.Serve()`, or `server.StartInProcess()`
- ❌ **Never** assume you can register services in multiple phases
- ✅ **Always** register all services upfront, even with nil dependencies
- ✅ **Use setter injection** when dependencies require runtime server to be started
- ✅ **Add comments** warning about registration order (`// CRITICAL: All services MUST be registered BEFORE...`)

**When to Use Setter Injection**:

✅ **Use setter injection when:**
- Dependencies are only available after server starts (in-process clients)
- Registration must happen before dependencies exist
- Controllers are already instantiated and registered

❌ **Don't use setter injection when:**
- Dependencies are available at construction time (store, config)
- Constructor injection works fine
- No circular dependency exists

**Alternative Approaches Considered**:

❌ **Lazy Client Creation**: Controllers create clients on-demand → Bypasses interceptor chain, loses single source of truth

❌ **Two-Phase Registration**: "Provisional" registration → gRPC doesn't support this, registration is locked after `Serve()`

❌ **Pass Server to Controllers**: Controllers create their own clients → Violates separation of concerns, tight coupling

✅ **Setter Injection (Chosen)**: Register with nil, start server, inject dependencies → Satisfies all requirements

**Testing**:
```bash
# Build verification
bazel build //backend/services/stigmer-server/cmd/server:server

# Runtime verification
stigmer server
# Should start successfully without crashes
```

**Key Takeaways**:

1. **gRPC is strict about registration order** - All services BEFORE Serve(), no exceptions
2. **Circular dependencies need design patterns** - Setter injection breaks the cycle
3. **Comment critical ordering** - Warn future developers about ordering constraints
4. **Validate with industry patterns** - This pattern is used by gRPC servers in production
5. **Runtime dependencies are OK in setters** - But registration-time dependencies must be available

**Future Improvements**:

Consider adding validation:
```go
func (c *AgentController) validateInitialized() error {
    if c.agentInstanceClient == nil {
        return fmt.Errorf("AgentController not fully initialized - client not set")
    }
    return nil
}
```

**Related Docs**:
- Changelog: `_changelog/2026-01/2026-01-20-091054-fix-grpc-initialization-crash.md`
- Technical fix doc: `_cursor/grpc-initialization-fix.md`
- Error report: `_cursor/error.md`
- Branch: `fix/stigmer-apply-cmd`

**Example Pattern for Future gRPC Services**:
```go
// Step 1: Create controller with nil dependency
controller := NewMyController(store, nil)

// Step 2: Register immediately
grpcServer.RegisterMyService(controller)

// Step 3: Start server (after ALL services registered)
server.StartInProcess()

// Step 4: Create clients
client := NewMyClient(conn)

// Step 5: Inject dependency
controller.SetMyClient(client)
```

**Remember**: In gRPC, registration order matters more than dependency availability. Register everything first, wire dependencies second.

---

### 2026-01-20 - Daemon Lifecycle: Robust Process Management Without PID Files

**Problem**: `stigmer server restart` was creating orphaned server processes, causing `stigmer apply` to show "Starting daemon" on every run even though the server was already running.

**User Experience**:
```bash
$ stigmer apply
ℹ 🚀 Starting local backend daemon...  # Every single time!
# ... Temporal port conflicts in logs ...
```

**Root Cause**: Three bugs creating a vicious cycle:
1. `IsRunning()` only checked PID file → No fallback for orphaned servers
2. `Stop()` gave up without PID file → Couldn't kill orphans
3. `handleServerRestart()` conditionally stopped → Skipped stop when detection failed

Cycle: Missing PID → Can't detect → Don't stop → Port conflict → Orphaned process

**Solution**: Three-tier detection with unconditional restart

**Tier 1 - PID File** (most reliable):
```go
pid, err := getPID(dataDir)
if err == nil && processIsAlive(pid) {
    return true
}
// Clean up stale PID file
os.Remove(pidFile)
```

**Tier 2 - Port Discovery** (for cleanup):
```go
func findProcessByPort(port int) (int, error) {
    cmd := exec.Command("lsof", "-t", "-i", fmt.Sprintf(":%d", port), "-sTCP:LISTEN")
    output, err := cmd.Output()
    // Parse PID from output
    return pid, nil
}

func Stop(dataDir string) error {
    pid, err := getPID(dataDir)
    if err != nil {
        // Fallback: find by port
        pid, err = findProcessByPort(DaemonPort)
        log.Info().Msg("Found orphaned process by port")
    }
    // Kill it
    process.Signal(syscall.SIGTERM)
}
```

**Tier 3 - gRPC Health** (for detection):
```go
func IsRunning(dataDir string) bool {
    // ... after Tier 1 fails
    conn, err := grpc.DialContext(ctx, endpoint, ...)
    if err == nil {
        log.Warn().Msg("Daemon running but PID file missing")
        return true
    }
    return false
}
```

**Fix - Unconditional Restart**:
```go
func handleServerRestart() {
    // Don't check if running - always try to stop
    daemon.Stop(dataDir)  // Handles orphans via lsof
    time.Sleep(1 * time.Second)
    daemon.Start(dataDir)  // Start fresh
}
```

**Why All Three Tiers**:
- PID file alone → Fails on orphans
- Port check alone → Might kill wrong process
- gRPC alone → Can detect but can't kill
- Together → Robust ✅

**Prevention**:
- ✅ Implement fallback process discovery (lsof, netstat)
- ✅ Make restart unconditional (always stop first)
- ✅ Clean stale PID files automatically
- ✅ Make stop operations idempotent
- ✅ Handle edge cases (orphans, stale files, port conflicts)

**Testing**: All scenarios passed (stop orphans, start clean, detect without PID, restart reliably)

**Files**: `client-apps/cli/internal/cli/daemon/daemon.go`, `client-apps/cli/cmd/stigmer/root/server.go`

**Changelog**: `_changelog/2026-01/2026-01-20-194409-fix-server-restart-orphaned-processes.md`

**Key Pattern**: For long-running daemons, implement PID file → port discovery → health check tiers with unconditional lifecycle operations.

---

### 2026-01-20 - Interactive Prompts with Survey Package

**Problem**: Need to present users with multiple choices when discovering agents/workflows:
- Multiple resources found during auto-discovery
- Need clean, user-friendly selection interface
- Standard CLI prompts look primitive

**Root Cause**: Go's standard input functions (`fmt.Scan`) don't provide interactive selection menus.

**Solution**: Use `github.com/AlecAivazis/survey/v2` for interactive prompts:

```go
import "github.com/AlecAivazis/survey/v2"

// Create selection prompt
prompt := &survey.Select{
    Message: "Select resource to run:",
    Options: optionLabels, // []string of display names
}

var selectedIndex int
err := survey.AskOne(prompt, &selectedIndex)
if err != nil {
    // Handle cancellation (Ctrl+C)
    return
}

// Use selectedIndex to get the chosen option
```

**Features**:
- Arrow keys for navigation
- Enter to select
- Ctrl+C to cancel gracefully
- Clean terminal output
- Cross-platform support

**Prevention**:
- Use survey package for any CLI interactive selections
- Don't implement custom terminal input handling
- Provides better UX than stdin reading
- Handles terminal escapes and control characters

**Related Docs**:
- Implementation: `client-apps/cli/cmd/stigmer/root/run.go`
- Package: https://github.com/AlecAivazis/survey

---

### 2026-01-20 - Smart Code Synchronization Pattern (Apply-Before-Run)

**Problem**: Users editing code locally but running stale versions:
- Edit agent/workflow code
- Run `stigmer run <name>`
- Old version executes (forgot to run `stigmer apply`)
- Confusion: "I changed it but it's not working"

**Root Cause**: Separation of deployment (`apply`) and execution (`run`) creates cognitive overhead.

**Solution**: Implement "apply-before-run" pattern with project directory detection:

```go
func runReferenceMode(reference string, ...) {
    // Check if we're in a Stigmer project directory
    inProjectDir := config.InStigmerProjectDirectory()
    
    if inProjectDir {
        // In project: auto-apply latest code first
        cliprint.PrintInfo("📁 Detected Stigmer project - applying latest code")
        deployedAgents, deployedWorkflows, err := ApplyCodeMode(...)
        // Then run the resource
    } else {
        // Outside project: run deployed resource directly
        // No apply needed
    }
}

// Helper function
func InStigmerProjectDirectory() bool {
    cwd, err := os.Getwd()
    if err != nil {
        return false
    }
    stigmerPath := filepath.Join(cwd, "Stigmer.yaml")
    _, err = os.Stat(stigmerPath)
    return err == nil
}
```

**Mental Model**:
```
Inside project directory = Development mode → Auto-apply
Outside project directory = Execution mode → No auto-apply
```

**Benefits**:
- Eliminates "stale code" confusion
- Fast iteration (edit → run → see results)
- Matches user intent naturally
- No extra commands to remember

**Prevention**:
- For dev tools with code-driven resources, auto-sync when in project context
- Detect project directory presence (Stigmer.yaml, package.json, etc.)
- Different behavior inside vs outside project makes sense to users
- Document the mental model clearly

**Related Docs**:
- Implementation: `client-apps/cli/cmd/stigmer/root/run.go`
- Documentation: `docs/cli/running-agents-workflows.md`
- Changelog: `_changelog/2026-01/2026-01-20-implement-stigmer-run-command.md`

**Key Takeaway**: For IaC/code-driven tools, smart context detection (in/out of project) enables better UX than forcing users to remember separate commands.

---

### 2026-01-20 - Dual-Mode Command Design (Auto-Discovery vs Reference)

**Problem**: Need to support different user workflows:
- Quick testing: "Just run something from my project"
- Targeted execution: "Run this specific agent"
- First-time use: "Show me what I have"

**Root Cause**: Single command pattern doesn't cover both exploratory and targeted workflows.

**Solution**: Design command with two modes based on arguments:

**Mode 1 - Auto-Discovery** (no arguments):
```bash
stigmer run  # Discovers all resources, prompts if multiple
```

**Mode 2 - Reference** (with name/ID):
```bash
stigmer run my-agent      # Runs specific resource
stigmer run agt_01abc123  # By ID
```

**Implementation Pattern**:
```go
func NewRunCommand() *cobra.Command {
    cmd := &cobra.Command{
        Run: func(cmd *cobra.Command, args []string) {
            hasReference := len(args) > 0
            
            if hasReference {
                // REFERENCE MODE: Run specific resource
                reference := args[0]
                runReferenceMode(reference, ...)
            } else {
                // AUTO-DISCOVERY MODE: Discover and prompt
                runAutoDiscoveryMode(...)
            }
        },
    }
    return cmd
}
```

**Benefits**:
- Single command covers multiple workflows
- No separate `stigmer discover` command needed
- Natural: no args = explore, with args = target
- Matches Docker pattern: `docker ps` (list) vs `docker ps <container>` (specific)

**Prevention**:
- Consider dual-mode design for commands with exploratory + targeted use cases
- Use arg presence/absence to switch modes
- Provide helpful output in auto-discovery mode
- Support both names and IDs in reference mode

**Related Docs**:
- Implementation: `client-apps/cli/cmd/stigmer/root/run.go`
- Pattern similar to: `docker ps`, `kubectl get`, `terraform apply`

**Key Takeaway**: Dual-mode commands (args-based switching) can replace multiple separate commands while maintaining clear UX.

---

### 2026-01-20 - Workflow-First Resolution Pattern

**Problem**: Users want to run either agents or workflows without remembering which is which.

**Root Cause**: Separate commands for agents vs workflows creates cognitive overhead:
```bash
stigmer agent run my-thing      # Is it an agent?
stigmer workflow run my-thing   # Or a workflow?
```

**Solution**: Single command that checks both, workflows first:

```go
func runResourceMode(reference string, ...) {
    // Try workflow first
    workflow, workflowErr := resolveWorkflow(reference, orgID, conn)
    if workflowErr == nil {
        executeWorkflow(workflow, ...)
        return
    }
    
    // Workflow not found - try agent
    agent, agentErr := resolveAgent(reference, orgID, conn)
    if agentErr == nil {
        executeAgent(agent, ...)
        return
    }
    
    // Neither found - helpful error
    cliprint.PrintError("Agent or Workflow not found: %s", reference)
}
```

**Why Workflows First**:
- Workflows often orchestrate agents (higher-level concept)
- If both have same name, workflow is usually what user wants
- Can be changed to user preference if needed

**Benefits**:
- Single command for both resource types
- No need to remember which is which
- Helpful error mentions both types
- Matches user mental model ("just run it")

**Prevention**:
- For similar resource types, implement unified execution
- Provide clear error messages listing all types checked
- Document resolution order in help text
- Consider making order configurable if needed

**Related Docs**:
- Implementation: `client-apps/cli/cmd/stigmer/root/run.go`
- Similar to: Kubernetes `kubectl get <resource>` (checks all types)

---

### 2026-01-20 - Project Directory Detection Helper

**Problem**: Multiple CLI commands need to know if they're in a Stigmer project directory.

**Root Cause**: Duplicating the same `Stigmer.yaml` check logic across multiple commands.

**Solution**: Create reusable helper function in config package:

```go
// InStigmerProjectDirectory checks if current directory contains a Stigmer.yaml file
func InStigmerProjectDirectory() bool {
    cwd, err := os.Getwd()
    if err != nil {
        return false
    }
    
    stigmerPath := filepath.Join(cwd, DefaultStigmerConfigFilename)
    _, err = os.Stat(stigmerPath)
    return err == nil
}
```

**Usage**:
```go
// In any command
if config.InStigmerProjectDirectory() {
    // Project-specific behavior
} else {
    // Non-project behavior
}
```

**Benefits**:
- Single source of truth for project detection
- Consistent behavior across commands
- Easy to extend (check additional files, validate content)
- No error handling needed at call sites

**Prevention**:
- Create helper functions for common checks
- Place in appropriate package (config for project detection)
- Make it simple boolean return (no error to handle)
- Document the check criteria

**Related Docs**:
- Implementation: `client-apps/cli/internal/cli/config/stigmer.go`
- Used by: `apply`, `run`, future commands

**Key Takeaway**: Common checks deserve helper functions. Boolean return (instead of error) simplifies usage when false is an acceptable answer.

---

### 2026-01-20 - Log Rotation Pattern for Daemon Restarts

**Problem**: Log files grew indefinitely, consuming disk space and making it hard to find recent logs in long-running development environments.

**Root Cause**: No log rotation strategy - logs accumulated from all previous sessions in a single file.

**Solution**: Automatic log rotation on daemon restart with timestamp-based archiving and 7-day cleanup:

**Implementation Pattern**:
```go
// In daemon.Start(), before starting services
func Start(dataDir string) error {
    // Rotate logs before starting new session
    if err := rotateLogsIfNeeded(dataDir); err != nil {
        log.Warn().Err(err).Msg("Failed to rotate logs, continuing anyway")
        // Don't fail daemon startup if log rotation fails
    }
    
    // Start services (logs written to fresh files)
    // ...
}

func rotateLogsIfNeeded(dataDir string) error {
    logDir := filepath.Join(dataDir, "logs")
    timestamp := time.Now().Format("2006-01-02-150405") // YYYY-MM-DD-HHMMSS
    
    logFiles := []string{
        "daemon.log", "daemon.err",
        "agent-runner.log", "agent-runner.err",
        "workflow-runner.log", "workflow-runner.err",
    }
    
    for _, logFile := range logFiles {
        oldPath := filepath.Join(logDir, logFile)
        
        // Only rotate if file exists and is non-empty
        if stat, err := os.Stat(oldPath); err == nil && stat.Size() > 0 {
            newPath := fmt.Sprintf("%s.%s", oldPath, timestamp)
            os.Rename(oldPath, newPath)
        }
    }
    
    // Cleanup old archives (7 days retention)
    return cleanupOldLogs(logDir, 7)
}

func cleanupOldLogs(logDir string, keepDays int) error {
    cutoff := time.Now().AddDate(0, 0, -keepDays)
    
    files, _ := filepath.Glob(filepath.Join(logDir, "*.log.*"))
    for _, file := range files {
        if info, err := os.Stat(file); err == nil {
            if info.ModTime().Before(cutoff) {
                os.Remove(file)
            }
        }
    }
    return nil
}
```

**Key Decisions**:
- **Timestamp-based naming** (`daemon.log.2026-01-20-150405`): Easy to identify when logs are from, natural sorting
- **Only rotate non-empty files**: Avoids clutter from empty log files
- **Non-fatal errors**: Log rotation failure doesn't prevent daemon startup (warn but continue)
- **7-day retention**: Balances disk space with debugging needs (industry standard)
- **Rotate on restart, not stop**: New session = fresh logs (clearer session boundaries)

**Benefits**:
- Prevents disk space exhaustion
- Clear session boundaries (find logs for specific restart)
- Preserves history for debugging (7 days of archives)
- Professional UX (matches nginx, syslog, production log management)

**Prevention**:
- Consider log rotation for any long-running daemon or server
- Choose between timestamp-based vs sequential naming
- Decide retention policy based on debugging needs
- Make rotation errors non-fatal if daemon is more important

**Related Docs**:
- Implementation: `client-apps/cli/internal/cli/daemon/daemon.go`
- Documentation: `docs/cli/server-logs.md` (Log Rotation section)
- Changelog: `_changelog/2026-01/2026-01-20-234758-cli-log-management-enhancements.md`

**Key Takeaway**: Log rotation on daemon restart provides clear session boundaries and prevents disk bloat. Use timestamp-based naming. Make rotation errors non-fatal.

---

### 2026-01-20 - Multi-File Log Streaming with Goroutines

**Problem**: Users had to view logs from each daemon component separately, making it hard to understand system-wide behavior and correlate events.

**Root Cause**: Single-file streaming approach - no way to merge logs from multiple files in real-time.

**Solution**: Goroutine-based multi-file streaming with central channel for merging.

**Key Pattern**: One goroutine per file + central channel for collecting lines.

**Benefits**:
- System-wide visibility (complete picture)
- Kubernetes/docker-compose UX (familiar)
- No manual mental correlation needed
- Reduces cognitive load

**Key Decisions**:
- Goroutine per file (concurrent reading)
- Central channel (merge streams)
- Buffered channel (100) prevents blocking
- 100ms poll interval (balance responsiveness/CPU)
- Handle file rotation (detect size shrink)

**Related Docs**:
- Implementation: `client-apps/cli/internal/cli/logs/streamer.go`
- Documentation: `docs/cli/server-logs.md` (Unified Log Viewing section)
- Changelog: `_changelog/2026-01/2026-01-20-234758-cli-log-management-enhancements.md`

**Key Takeaway**: Use goroutines + central channel for multi-file streaming. Handle file rotation. Parse timestamps flexibly. Buffer channels.

---

### 2026-01-20 - Log Utilities Package Structure Pattern

**Problem**: Adding log features in command handlers created large files (200+ lines) and mixed concerns.

**Root Cause**: Violation of Single Responsibility Principle.

**Solution**: Extract into dedicated `logs` package:

```
internal/cli/logs/
├── types.go       (15 lines)  - Data structures
├── parser.go      (59 lines)  - Timestamp parsing
├── merger.go      (76 lines)  - Log merging
└── streamer.go    (103 lines) - Multi-file streaming
```

**Benefits**:
- Single responsibility per file
- All files under 150 lines
- Reusable by other commands
- Testable pure functions
- Thin command handlers

**Prevention**:
- Create dedicated package for significant features
- Keep files under 150 lines
- One responsibility per file
- Avoid generic names (utils, helpers)

**Related Docs**:
- Implementation: `client-apps/cli/internal/cli/logs/`
- Coding guidelines: `.cursor/rules/client-apps/cli/coding-guidelines.mdc`
- Changelog: `_changelog/2026-01/2026-01-20-234758-cli-log-management-enhancements.md`

**Key Takeaway**: Extract complex features into dedicated packages. Single responsibility per file. Keep files under 150 lines.
