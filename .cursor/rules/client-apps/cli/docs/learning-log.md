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

---

### 2026-01-22 - Docker Container Lifecycle Management for Daemon Services

**Problem**: Agent-runner used PyInstaller binary but suffered from persistent import errors:
```
ModuleNotFoundError: No module named 'multipart'
```
- PyInstaller couldn't detect dynamic imports in `multipart` package
- Multiple attempted fixes (vendoring, hooks, sys.path manipulation) all failed
- Builds succeeded but execution failed
- 7+ hours of debugging couldn't solve PyInstaller packaging issues

**Root Cause**: PyInstaller packages Python apps into standalone binaries but struggles with:
- Dynamic imports that can't be detected at build time
- Hidden runtime dependencies
- Packages that inspect sys.modules or use import hooks
- The `multipart` package's implementation relied on patterns PyInstaller couldn't handle

**Solution**: Replace subprocess-based daemon management with Docker container management:

**Docker Integration Pattern**:

```go
// 1. Docker Detection
func dockerAvailable() bool {
    // Check if docker command exists
    if _, err := exec.LookPath("docker"); err != nil {
        return false
    }
    // Check if Docker daemon is running
    cmd := exec.Command("docker", "info")
    return cmd.Run() == nil
}

// 2. Start Docker Container (analogous to starting subprocess)
func startAgentRunnerDocker(dataDir string, env map[string]string) error {
    // Remove any existing container
    _ = exec.Command("docker", "rm", "-f", "stigmer-agent-runner").Run()
    
    // Build docker run arguments
    args := []string{
        "run", "-d",
        "--name", "stigmer-agent-runner",
        "--network", "host",  // For localhost access
        "--restart", "unless-stopped",
    }
    
    // Add environment variables
    for key, value := range env {
        args = append(args, "-e", fmt.Sprintf("%s=%s", key, value))
    }
    
    // Add workspace volume mount
    workspaceDir := filepath.Join(dataDir, "workspace")
    args = append(args, "-v", fmt.Sprintf("%s:/workspace", workspaceDir))
    
    // Add image
    args = append(args, "stigmer-agent-runner:local")
    
    // Start container
    cmd := exec.Command("docker", args...)
    output, err := cmd.CombinedOutput()
    if err != nil {
        return errors.Wrapf(err, "failed to start container: %s", output)
    }
    
    containerID := strings.TrimSpace(string(output))
    
    // Store container ID for lifecycle management (analogous to PID file)
    containerIDFile := filepath.Join(dataDir, "agent-runner-container.id")
    return os.WriteFile(containerIDFile, []byte(containerID), 0644)
}

// 3. Stop Docker Container (analogous to killing process)
func stopAgentRunnerDocker(dataDir string) error {
    // Read container ID from file
    containerIDFile := filepath.Join(dataDir, "agent-runner-container.id")
    data, err := os.ReadFile(containerIDFile)
    var containerID string
    if err == nil {
        containerID = strings.TrimSpace(string(data))
    }
    
    // Fallback: find by name if no container ID file
    if containerID == "" {
        cmd := exec.Command("docker", "ps", "-aq", "-f", "name=^stigmer-agent-runner$")
        output, _ := cmd.Output()
        containerID = strings.TrimSpace(string(output))
    }
    
    if containerID == "" {
        return nil  // Nothing to stop
    }
    
    // Stop container gracefully
    exec.Command("docker", "stop", containerID).Run()
    
    // Remove container
    exec.Command("docker", "rm", containerID).Run()
    
    // Clean up container ID file
    os.Remove(containerIDFile)
    return nil
}

// 4. Cleanup Orphaned Containers (analogous to orphaned process cleanup)
func cleanupOrphanedContainers() {
    // Find orphaned containers from previous runs
    cmd := exec.Command("docker", "ps", "-aq", "-f", "name=^stigmer-agent-runner$")
    output, err := cmd.Output()
    if err != nil || len(output) == 0 {
        return  // No orphaned containers
    }
    
    containerID := strings.TrimSpace(string(output))
    log.Warn().Str("container_id", containerID[:12]).Msg("Found orphaned container, cleaning up")
    
    // Stop and remove
    exec.Command("docker", "stop", containerID).Run()
    exec.Command("docker", "rm", containerID).Run()
}
```

**Docker Logs Integration**:

```go
// Stream logs from Docker container (analogous to tailing log files)
func streamDockerLogs(containerName string, follow bool, tailLines int) error {
    args := []string{"logs"}
    if follow {
        args = append(args, "-f")
    }
    if tailLines > 0 {
        args = append(args, "--tail", strconv.Itoa(tailLines))
    }
    args = append(args, containerName)
    
    cmd := exec.Command("docker", args...)
    cmd.Stdout = os.Stdout
    cmd.Stderr = os.Stderr
    return cmd.Run()
}

// Auto-detect Docker vs file-based logs
if component == "agent-runner" && isAgentRunnerDocker(dataDir) {
    return streamDockerLogs("stigmer-agent-runner", follow, lines)
}
// Otherwise, use file-based logs
```

**Pattern Mapping: Subprocess ↔ Docker**:

| Subprocess Pattern | Docker Container Pattern |
|--------------------|--------------------------|
| PID file | Container ID file |
| `exec.Command()` to start binary | `docker run` to start container |
| Store PID in file | Store container ID in file |
| Kill process by PID | Stop container by ID/name |
| Check if process alive with `ps` | Check if container running with `docker ps` |
| Tail log files | `docker logs -f` |
| Clean up orphaned processes | Clean up orphaned containers |
| Process groups for cleanup | Docker's built-in child process management |

**Error Handling**:

```go
// Clear error if Docker not available
if !dockerAvailable() {
    return errors.New(`Docker is not running. Agent-runner requires Docker.

Please start Docker Desktop or install Docker:
  - macOS:  brew install --cask docker
  - Linux:  curl -fsSL https://get.docker.com -o get-docker.sh && sudo sh get-docker.sh
  - Windows: Download from https://www.docker.com/products/docker-desktop

After installing Docker, restart Stigmer server.`)
}

// Clear error if image not found
if !imageExists("stigmer-agent-runner:local") {
    return errors.New(`Docker image not found. Please build it first:
  cd backend/services/agent-runner
  docker build -f Dockerfile -t stigmer-agent-runner:local ../../..`)
}
```

**Benefits**:
- ✅ **Eliminates import errors** - All dependencies explicit in poetry.lock
- ✅ **Reproducible builds** - Same environment everywhere (dev, CI, prod)
- ✅ **Transparent debugging** - Can shell into container to investigate
- ✅ **Industry standard** - Docker is familiar to developers
- ✅ **Automatic cleanup** - Docker manages child processes
- ✅ **Built-in log rotation** - Docker handles log management

**Trade-offs**:
- ⚠️ **Requires Docker** - Users must install Docker (acceptable for modern development)
- ⚠️ **Larger footprint** - 2GB image vs ~100MB binary
- ⚠️ **Slightly slower cold start** - ~3s vs instant (acceptable)

**Prevention**:
- **Prefer Docker for Python daemons** with complex dependencies
- **Use subprocess pattern** for simple Go binaries (temporal, workflow-runner)
- **Document Docker requirement** in installation guides
- **Provide clear error messages** if Docker not available
- **Container ID tracking** enables reliable lifecycle management
- **Cleanup orphaned containers** on daemon restart (like orphaned processes)

**When to Use Docker vs Subprocess**:

**Use Docker when:**
- Complex dependency management (Python with many packages)
- Hidden import issues (dynamic imports, import hooks)
- Need reproducible builds across environments
- Service has runtime dependencies (system libs, tools)

**Use Subprocess when:**
- Simple self-contained binaries (Go, Rust)
- No complex dependencies
- Fast startup critical (<1s)
- Size matters (<100MB)

**Related Docs**:
- Changelog: `_changelog/2026-01/2026-01-22-020000-migrate-agent-runner-to-docker.md`
- Implementation: `client-apps/cli/internal/cli/daemon/daemon.go`
- Logs integration: `client-apps/cli/cmd/stigmer/root/server_logs.go`
- Architecture: `docs/architecture/cli-subprocess-lifecycle.md` (Docker section added)
- Getting started: `docs/getting-started/local-mode.md` (Docker requirement added)
- Project: `_projects/2026-01/20260122.01.migrate-agent-runner-to-docker/`

**Key Takeaway**: Docker container lifecycle management parallels subprocess management with different mechanisms. Container ID ≈ PID, `docker run` ≈ `exec.Command()`, `docker stop` ≈ kill. For Python services with complex dependencies, Docker eliminates packaging issues at the cost of requiring Docker installation. Pattern is reusable for other containerized services.

---

## Build System & Distribution

### 2026-01-21 - Go Embed + Gazelle Integration for Binary Embedding

**Problem**: Need to embed platform-specific binaries (stigmer-server, workflow-runner, agent-runner) into CLI for self-contained distribution, while maintaining Bazel build system compatibility.

**Root Cause**: CLI distribution required separate binaries. Users needed to install stigmer-server, workflow-runner, and agent-runner separately, leading to:
- Version mismatches when rebuilding only one component
- Complex binary search paths (~200 lines of fallback logic)
- Installation complexity (multiple files via Homebrew)
- Broken installations (users forget to install all components)

**Solution**: Use Go `embed` package with Gazelle auto-detection.

**Key Insight**: Gazelle automatically detects `//go:embed` directives and adds `embedsrcs` field to BUILD.bazel. NO manual BUILD file edits needed.

**Results**:
- Single binary distribution: 123 MB (vs 2-4 separate binaries)
- Fast extraction: < 3s first run, < 1s subsequent
- Version sync guaranteed: All components from same build
- Simplified installation: One binary via Homebrew
- Works offline: No downloads after install

**Related Docs**:
- Implementation: `client-apps/cli/embedded/`
- Release guide: `client-apps/cli/RELEASE.md`
- Changelog: `_changelog/2026-01/2026-01-21-011338-cli-embedded-binary-packaging.md`

**Key Takeaway**: Go embed + Gazelle works seamlessly. Gazelle auto-detects embed directives and manages BUILD files. Use platform-specific builds (not universal binary). Extract on first run with version checking.

---

### 2026-01-21 - No Fallbacks Architecture for Production Binary Finding

**Problem**: Binary search logic had 200 lines of fallback paths checking development locations. This created confusion about which binary was actually running and leaked development paths into production.

**Solution**: Remove ALL fallbacks. Production uses ONLY extracted binaries. Dev mode uses ONLY env vars.

**Code Reduction**:
- Total: 295 lines → 90 lines (70% reduction)
- findWorkspaceRoot(): 40 lines → DELETED

**Clear Separation**:
- Production: Uses only `~/.stigmer/data/bin/{binary}` (extracted)
- Development: Uses only env vars (`STIGMER_*_BIN`, `STIGMER_*_SCRIPT`)
- No overlap: No implicit fallbacks

**Related Docs**:
- Implementation: `client-apps/cli/internal/cli/daemon/daemon.go`
- Changelog: `_changelog/2026-01/2026-01-21-011338-cli-embedded-binary-packaging.md`

**Key Takeaway**: No fallbacks is better than smart fallbacks. Production uses ONLY extracted binaries. Dev mode uses ONLY env vars. Clear separation prevents confusion.

---

### 2026-01-21 - Version Checking Optimization for Binary Extraction

**Problem**: Extracting binaries on every daemon start would add 3+ seconds to startup time.

**Solution**: Version checking with `.version` marker file - Check version before extracting, skip if version matches.

**Performance**:
- First run: 3s (extract all binaries)
- Version upgrade: 3s (re-extract on mismatch)
- Subsequent runs: < 1s (version check only)

**Trade-off**: 3x faster subsequent starts (3s → 1s), worth the ~50 lines of complexity.

**Related Docs**:
- Implementation: `client-apps/cli/embedded/version.go`
- Changelog: `_changelog/2026-01/2026-01-21-011338-cli-embedded-binary-packaging.md`

**Key Takeaway**: Version checking optimizes expensive operations. Check before extraction. Fast path for common case. Automatic re-extraction on upgrade.

---

### 2026-01-21 - Source-Only Tarball Distribution for Platform-Portable Code

**Problem**: Agent-runner is Python code. Embedding full venv would be 80+ MB and platform-specific.

**Solution**: Embed source code only as tar.gz, install dependencies on first run via poetry.

**Results**:
- Tarball size: 25 KB (source code only)
- vs venv: 80 MB (3200x smaller!)
- Platform portable: Same tarball works on darwin + linux
- Fresh dependencies: `poetry install` gets latest compatible versions

**Trade-off**: 5s one-time dependency installation vs 240 MB embedded. Worth it.

**Related Docs**:
- Implementation: `Makefile` embed-agent-runner target
- Extraction: `client-apps/cli/embedded/extract.go`
- Changelog: `_changelog/2026-01/2026-01-21-011338-cli-embedded-binary-packaging.md`

**Key Takeaway**: For Python code, embed source only (not venv). Install dependencies at runtime. 3200x size reduction + platform portability.


### 2026-01-21 - gRPC Blocking Dial Pattern for Reliable Connections

**Problem**: `stigmer apply` would fail with "Cannot connect to stigmer-server" when the server was started in a different terminal or conversation context, even though the server was running and the PID file existed.

**Example User Experience**:
```bash
# Terminal 1
$ stigmer server restart
✓ Server restarted successfully
  PID:  41114
  Port: 7234

# Terminal 2 (immediately after)
$ stigmer apply
Error: Cannot connect to stigmer-server

Is the server running?
  stigmer server
```

**Root Cause**: Race condition caused by three issues:

1. **Non-Blocking Dial**: `grpc.DialContext()` without `grpc.WithBlock()` returns immediately before the connection is actually established
2. **Arbitrary Sleep Timing**: 500ms sleep after daemon start assumed server would be ready, but this was unreliable (especially with embedded binary extraction adding startup time)
3. **Manual Verification Attempts**: Trying to manually verify connection after non-blocking dial created additional race windows

**Technical Details**:
```go
// ❌ OLD PATTERN: Non-blocking dial
conn, err := grpc.DialContext(ctx, endpoint, opts...)
// Returns immediately - connection not ready!

// Then manually verify with RPC call
if err := c.verifyConnection(ctx); err != nil {
    // Race condition: Server might not be ready yet
    return err
}
```

**Solution**: Use industry-standard blocking dial pattern with `grpc.WithBlock()`:

```go
// ✅ NEW PATTERN: Blocking dial with timeout
ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
defer cancel()

opts = append(opts, grpc.WithBlock())  // Block until connected
conn, err := grpc.DialContext(ctx, endpoint, opts...)
// Connection is GUARANTEED ready when this returns (or timeout error)
```

**Why This Works**:
- `grpc.WithBlock()` makes `DialContext` wait until the TCP connection is established and server responds
- Context timeout (10s) provides reasonable wait for server startup
- No need for manual verification - the dial itself proves the server is ready
- Eliminates all timing-related race conditions

**Changes Made**:

1. **Client Connection** (`client.go`):
   - Added `grpc.WithBlock()` to all connection attempts
   - Added 10s timeout for server startup scenarios
   - Removed manual `verifyConnection()` RPC call (not needed with blocking dial)

2. **Daemon Management** (`daemon.go`):
   - Removed 500ms arbitrary sleep after daemon start
   - Updated `IsRunning()` to use `grpc.WithBlock()` with 1s timeout (short - just checking status)
   - Simplified `WaitForReady()` from 40 lines of polling to 12 lines with blocking dial
   - Server doesn't wait - clients block until ready (cleaner separation)

3. **Code Reduction**:
   - Total: -70 lines (5.2% reduction)
   - Removed all sleep-based timing
   - Removed polling loop in `WaitForReady()`
   - Removed manual verification logic

**Prevention**:

✅ **ALWAYS use `grpc.WithBlock()` for CLI→server connections**
- CLI tools should block until server is ready
- Use appropriate timeout based on context:
  - 10s for commands that might trigger server startup
  - 1-2s for status checks of already-running servers

❌ **NEVER rely on arbitrary sleep/wait times**
- `time.Sleep(500ms)` assumptions break as systems change
- Embedded binaries, slow machines, different platforms all affect timing

❌ **NEVER use non-blocking dials without explicit reason**
- Non-blocking is for async/streaming scenarios, not CLIs
- Manual verification after non-blocking dial creates race windows

✅ **Let gRPC handle the waiting**
- `grpc.WithBlock()` is built for this use case
- More reliable than manual polling/verification
- Industry standard (used by kubectl, docker CLI, terraform)

**Context Timeout Strategy**:
```go
// Client connections (might need to wait for startup): 10s
ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)

// Status checks (expect already running): 1s  
ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
```

**Testing**:
```bash
# Scenario 1: Server already running
$ stigmer apply
✓ Connected immediately (< 100ms)

# Scenario 2: Server starting
$ stigmer server &
$ stigmer apply  # Called immediately
✓ Blocks until server ready (< 3s)
✓ Connects successfully

# Scenario 3: Multi-terminal workflow (original bug)
# Terminal 1
$ stigmer server restart
✓ Server restarted

# Terminal 2 (immediately)
$ stigmer apply
✓ Blocks until server ready
✓ Connects successfully
✓ NO MORE RACE CONDITION!
```

**Industry Precedent**:
- **kubectl** (Kubernetes CLI): Uses `grpc.WithBlock()` for API server connections
- **docker** CLI: Blocks until daemon responds
- **terraform**: Blocks provider connections with timeouts

**Related Docs**:
- Implementation: `client-apps/cli/internal/cli/backend/client.go`
- Implementation: `client-apps/cli/internal/cli/daemon/daemon.go`
- Changelog: `_changelog/2026-01/2026-01-21-014002-fix-grpc-connection-race-condition.md`
- gRPC docs: https://grpc.io/docs/languages/go/basics/ (WithBlock pattern)

**Key Takeaway**: For CLI→server gRPC connections, ALWAYS use `grpc.WithBlock()` with appropriate context timeouts. This is the industry-standard pattern that eliminates race conditions and provides reliable connection behavior. Don't use arbitrary sleeps or manual verification - trust gRPC's built-in blocking dial.

---

### 2026-01-21 - BusyBox Internal Command Routing (Bypass Embedded CLI Parsers)

**Problem**: Workflow validation consistently timed out with 30-second `StartToClose` timeout when running `stigmer run` in local mode, even after server was fully started:

```
Failed to deploy: pipeline step ValidateWorkflowSpec failed: 
workflow validation system error: failed to execute validation workflow: 
Workflow timeout (type: StartToClose)
```

**User Experience**:
- ❌ Validation timed out on **every run** (not just first run)
- ❌ Restarting sometimes appeared to help but issue persisted  
- ❌ No obvious pattern (seemed sporadic)
- ❌ Happened consistently across all commands
- ❌ Workflow-runner subprocess wasn't running (`ps aux` showed no process)
- ❌ PID file existed but process was dead
- ❌ Log files completely empty (process died before logging)

**Initial Hypothesis** ❌ (WRONG):
"Race condition during worker initialization" → Considered adding 2-second delays

**User Feedback**: "Let's not add this 2-second thing. I want to build a state-of-the-art solution."

This feedback was critical - it forced investigation of the real issue instead of accepting a workaround.

**Investigation Breakthrough**:

Added debug output to trace execution:
```go
fmt.Fprintln(os.Stderr, "DEBUG: workflow-runner Run() called")
fmt.Fprintln(os.Stderr, "DEBUG: About to call rootCmd.Execute()")
```

Result:
```
DEBUG: workflow-runner Run() called
DEBUG: About to call rootCmd.Execute()
DEBUG: rootCmd.Execute() returned error: unknown command "internal-workflow-runner" for "zigflow"
```

**Root Cause**: Architectural mismatch in BusyBox pattern implementation.

The workflow-runner is actually the **zigflow CLI** (separate tool embedded in Stigmer):
1. Daemon spawns: `stigmer internal-workflow-runner`
2. This routes to: `runner.Run()` in workflow-runner package  
3. **Which was calling**: `worker.Execute()` (executes the **zigflow** CLI root command)
4. **Zigflow CLI tried to parse**: "internal-workflow-runner" as a zigflow subcommand
5. **But zigflow doesn't have that subcommand** → Error
6. Process exits **immediately** (before logging is set up)
7. PID file created but process dead
8. Validation workflows wait for activity that will never execute
9. Timeout after 30 seconds

**The Architecture**:
```
Stigmer CLI (BusyBox)
├── internal-server → server.Run() ✅ (direct function call)
└── internal-workflow-runner → runner.Run() ❌ (was going through zigflow CLI parser)
                                   ↓
                         worker.Execute() (zigflow CLI)
                                   ↓
                         "unknown command: internal-workflow-runner"
```

**Solution**: Bypass cobra command parsing for internal commands - call worker mode directly.

**Before** (`backend/services/workflow-runner/pkg/runner/runner.go`):
```go
func Run() error {
    // Call the existing Execute function which handles the cobra command
    worker.Execute()  // ← Tries to parse "internal-workflow-runner" as zigflow subcommand
    return nil
}
```

**After**:
```go
func Run() error {
    // Directly run in Temporal worker mode (stigmer integration)
    // Don't go through worker.Execute() which would try to parse cobra commands
    return worker.RunTemporalWorkerMode()  // ← Direct call, no command parsing
}
```

**Supporting Changes**:

1. **Exported function** (`backend/services/workflow-runner/cmd/worker/root.go`):
```go
// runTemporalWorkerMode() → RunTemporalWorkerMode()
// Exported for use by the runner package (BusyBox pattern)
func RunTemporalWorkerMode() error {
    // ... worker initialization
}
```

2. **Fixed env var names** (`client-apps/cli/internal/cli/daemon/daemon.go`):
```go
// Added TEMPORAL_ prefix to match config expectations
"TEMPORAL_WORKFLOW_EXECUTION_RUNNER_TASK_QUEUE=workflow_execution_runner",
"TEMPORAL_ZIGFLOW_EXECUTION_TASK_QUEUE=zigflow_execution",
"TEMPORAL_WORKFLOW_VALIDATION_RUNNER_TASK_QUEUE=workflow_validation_runner",
```

**Verification**:
```bash
$ stigmer run
✓ Deployed: 1 agent(s) and 1 workflow(s)  # ← NO TIMEOUT!

$ ps aux | grep internal-workflow-runner
suresh  24803  /Users/suresh/bin/stigmer internal-workflow-runner  # ← RUNNING!

$ cat ~/.stigmer/data/logs/workflow-runner.log
INFO  Started Worker Namespace default TaskQueue workflow_validation_runner
INFO  Starting complete workflow validation
INFO  Workflow validation completed successfully  # ← ACTUALLY EXECUTES!
```

**Impact**:

Before Fix:
- ❌ Validation always timed out (30 seconds)
- ❌ Workflows could not be deployed in local mode
- ❌ Silent subprocess failure (no logs)
- ❌ Frustrating user experience

After Fix:
- ✅ Validation completes in <200ms (expected latency)
- ✅ Workflows deploy successfully
- ✅ Workflow-runner subprocess starts and polls correctly
- ✅ All three Temporal task queues operational

**Prevention & Best Practices**:

✅ **BusyBox Internal Commands MUST bypass embedded CLI parsers**:
```go
// ✅ CORRECT: Direct function call
func Run() error {
    return actualImplementation()  // Call code directly
}

// ❌ WRONG: Goes through embedded CLI parser
func Run() error {
    embeddedCLI.Execute()  // Will try to parse command
}
```

✅ **Design internal commands for direct invocation**:
- Internal commands are **code paths**, not **user commands**
- They should call implementation functions directly
- Don't route through cobra/CLI frameworks
- The CLI parser is for **user commands**, not **internal routing**

✅ **Debug subprocess failures with stderr output**:
```go
// Add debug output at entry point
func Run() error {
    fmt.Fprintln(os.Stderr, "DEBUG: Function called")
    // ... rest of code
}
```

This traces execution even before logging is configured.

✅ **Check subprocess logs immediately**:
- Empty logs = crash before logging setup
- Check PID file vs running process
- Manual test: Run command directly with env vars

❌ **Don't assume timeouts are always race conditions**:
- Timeout might mean "worker not running at all"
- Check if subprocess is actually alive first
- Sporadic can mean "startup fails sometimes" OR "component missing entirely"

**Why This Was Hard to Debug**:

1. **Silent failure**: Process exited before logging configured
2. **Empty logs**: Both stdout and stderr empty
3. **PID file existed**: Daemon thought it started successfully  
4. **Misleading symptoms**: Looked like timing/race condition
5. **Deep in call stack**: Bug was in routing layer, not worker code

**Debugging Approach That Worked**:

1. Verify subprocess is actually running (`ps aux`)
2. Check PID file vs running processes (mismatch = crash)
3. Add debug output at function entry points
4. Test command manually with env vars
5. Trace through routing layers
6. Question assumptions ("Is this really a race condition?")

**Related Issues**:

This bug was introduced by commit `504c10c` ("refactor(cli): implement BusyBox pattern") which consolidated binaries but created this routing mismatch. The BusyBox pattern itself is correct, but internal command routing needed adjustment.

**Architecture Insight**:

The stigmer CLI is actually a **container** for multiple tools:
- Stigmer Server (Java backend)
- Workflow-Runner (Zigflow - Go Temporal worker)
- Agent-Runner (Python agent executor)

Each has its own CLI/entry point, but they're all embedded in one binary. Internal commands need to route to **implementations**, not **CLI parsers**.

**Related Docs**:
- Changelog: `_changelog/2026-01/2026-01-21-185839-fix-workflow-validation-timeout.md`
- Root cause analysis: `_cursor/REAL-ROOT-CAUSE.md`
- Error report: `_cursor/error.md`
- Commit: `34a1f36` fix(cli/workflow-runner): fix validation timeout

**Files Changed**:
- `client-apps/cli/internal/cli/daemon/daemon.go` (env var names)
- `backend/services/workflow-runner/pkg/runner/runner.go` (direct call)
- `backend/services/workflow-runner/cmd/worker/root.go` (export function)

**Key Takeaways**:

1. **BusyBox internal commands must bypass embedded CLI parsers** - Route to implementation functions directly
2. **Debug subprocess failures at the earliest entry point** - Before logging, before frameworks
3. **Empty logs + dead process = crash during initialization** - Check command parsing first
4. **User feedback drives investigation** - "This happens consistently" changed the direction
5. **Reject workarounds** - Delays/sleeps mask real issues
6. **Architectural understanding matters** - Know what each component is (zigflow = separate tool)

**Testing Pattern**:
```bash
# Test internal command works
EXECUTION_MODE=temporal \
TEMPORAL_SERVICE_ADDRESS=localhost:7233 \
STIGMER_BACKEND_ENDPOINT=localhost:9090 \
stigmer internal-workflow-runner &

sleep 2
ps aux | grep internal-workflow-runner  # Should be running

cat ~/.stigmer/data/logs/workflow-runner.log  # Should have output
```

**Example for Future Internal Commands**:
```go
// ✅ CORRECT PATTERN for BusyBox internal commands
func Run() error {
    // Don't call embeddedCLI.Execute()
    // Call implementation directly
    return implementation.StartInMode(os.Getenv("EXECUTION_MODE"))
}
```

**Remember**: BusyBox pattern = multiple tools in one binary. Internal commands are **routing**, not **parsing**. Route to implementations, don't parse through embedded CLIs.

---

### 2026-01-22 - Docker Host Networking on macOS Requires host.docker.internal

**Problem**: Agent-runner Docker container was failing to connect to Temporal with "Connection refused" on macOS after Docker migration:
```
Failed client connect: Server connection error: 
tonic::transport::Error(Transport, ConnectError(ConnectError(
  "tcp connect error", 127.0.0.1:7233, 
  Os { code: 111, kind: ConnectionRefused, message: "Connection refused" }
)))
```

**User Impact**:
- Container in crash/restart loop
- All agent executions failed with "No worker available to execute activity"
- `stigmer run` completely broken on macOS

**Root Cause**: Docker Desktop on macOS runs in a VM. Containers cannot reach the host via `localhost` or `127.0.0.1` **even with `--network host`** because the network stack is virtualized.

**Why `--network host` Doesn't Work on macOS**:
- On Linux: `--network host` gives container direct access to host's network stack → `localhost` works
- On macOS/Windows: Docker runs in a VM (HyperKit/WSL2) → `localhost` points to VM, not actual host
- Must use special DNS name: `host.docker.internal` → resolves to host machine IP

**Solution**: OS-aware Docker host address resolution:

```go
// Resolve host address for Docker container to reach host services
// On macOS/Windows, Docker runs in a VM, so containers must use host.docker.internal
// On Linux, localhost works with --network host
func resolveDockerHostAddress(addr string) string {
    // Only convert localhost addresses
    if !strings.Contains(addr, "localhost") && !strings.Contains(addr, "127.0.0.1") {
        return addr
    }
    
    // On Linux, localhost works with --network host
    if runtime.GOOS == "linux" {
        return addr
    }
    
    // On macOS/Windows (darwin/windows), use host.docker.internal
    originalAddr := addr
    addr = strings.ReplaceAll(addr, "localhost", "host.docker.internal")
    addr = strings.ReplaceAll(addr, "127.0.0.1", "host.docker.internal")
    
    log.Debug().
        Str("original", originalAddr).
        Str("resolved", addr).
        Str("os", runtime.GOOS).
        Msg("Resolved Docker host address for macOS/Windows")
    
    return addr
}

// Apply to Temporal and backend addresses
hostAddr := resolveDockerHostAddress(temporalAddr)
backendAddr := resolveDockerHostAddress(fmt.Sprintf("localhost:%d", DaemonPort))

// Pass to container
"-e", fmt.Sprintf("TEMPORAL_SERVICE_ADDRESS=%s", hostAddr),
"-e", fmt.Sprintf("STIGMER_BACKEND_URL=http://%s", backendAddr),
```

**Verification**:
```bash
# Check container is using correct address
$ docker inspect stigmer-agent-runner | grep TEMPORAL_SERVICE_ADDRESS
"TEMPORAL_SERVICE_ADDRESS=host.docker.internal:7233"  # ✅ Correct

# Check container logs
$ docker logs stigmer-agent-runner
✅ Connected to Temporal server at host.docker.internal:7233
✅ Registered Python activities
🚀 Worker ready, polling for tasks...
```

**Platform Compatibility**:

| OS | Address Used | Works |
|----|--------------|-------|
| macOS | `host.docker.internal` | ✅ |
| Windows | `host.docker.internal` | ✅ |
| Linux | `localhost` | ✅ |

**Why Not Always Use `host.docker.internal`**:
- On Linux, `localhost` is faster (no DNS lookup)
- Some Linux setups may not support `host.docker.internal`
- Best practice: Use optimal address for each platform

**Extended Fix: Logs Command Docker Support**

After fixing networking, discovered `stigmer server logs all` wasn't showing agent-runner logs because it only read log files, not Docker containers.

**Solution**: Extended logs package to support both files and Docker containers:

**1. Updated ComponentConfig** (`logs/types.go`):
```go
type ComponentConfig struct {
    Name           string
    LogFile        string
    ErrFile        string
    DockerContainer string // NEW: If set, read from Docker instead of files
}
```

**2. Added Docker log readers** (`logs/streamer.go`, `logs/merger.go`):
```go
// Streaming logs from Docker container
func tailDockerLogs(containerName, component string, linesChan chan<- LogLine) error {
    cmd := exec.CommandContext(ctx, "docker", "logs", "-f", "--tail", "0", containerName)
    // Read both stdout and stderr via goroutines
    // Parse and send to channel
}

// Historical logs from Docker container
func readDockerLogs(containerName, component string, tailLines int) ([]LogLine, error) {
    cmd := exec.Command("docker", "logs", "--tail", strconv.Itoa(tailLines), containerName)
    output, _ := cmd.CombinedOutput()
    // Parse output into LogLine structs
}
```

**3. Updated command to detect Docker** (`server_logs.go`):
```go
func getComponentConfigs(dataDir, logDir string) []logs.ComponentConfig {
    // Check if agent-runner is running in Docker
    if isAgentRunnerDocker(dataDir) {
        components = append(components, logs.ComponentConfig{
            Name:           "agent-runner",
            DockerContainer: daemon.AgentRunnerContainerName, // Use Docker logs
        })
    } else {
        components = append(components, logs.ComponentConfig{
            Name:    "agent-runner",
            LogFile: filepath.Join(logDir, "agent-runner.log"), // Use file logs
        })
    }
}
```

**Result**: `stigmer server logs all` now works with mixed file-based and Docker-based logging:
```bash
$ stigmer server logs all --tail=20
[stigmer-server ] 2:51AM INF Server started successfully
[agent-runner   ] ✅ Worker ready, polling for tasks...
[workflow-runner] Worker registered successfully
```

**Prevention**:

✅ **Test Docker containers on macOS during development**:
- Linux behavior differs - always test on macOS
- Use `docker inspect` to verify environment variables
- Check container logs for connection errors

✅ **Use OS-aware address resolution for all host services**:
```go
// Pattern for any service containers need to reach
temporalAddr := resolveDockerHostAddress("localhost:7233")
backendAddr := resolveDockerHostAddress("localhost:7234")
redisAddr := resolveDockerHostAddress("localhost:6379")
```

✅ **Support Docker containers in log/diagnostic commands**:
- Detect if component runs in Docker vs subprocess
- Use `docker logs` instead of file reading
- Maintain unified interface (users don't need to know)

✅ **Document platform-specific Docker behavior**:
- Add to troubleshooting guides
- Explain why different addresses on different platforms
- Provide verification commands

❌ **Don't assume `--network host` works the same everywhere**:
- Works on Linux (container shares host network)
- Doesn't work on macOS/Windows (VM isolation)
- Must use `host.docker.internal` on macOS/Windows

**Troubleshooting Pattern**:
```bash
# 1. Check if container can reach host
docker exec stigmer-agent-runner nc -zv host.docker.internal 7233

# 2. Check environment variables passed to container
docker inspect stigmer-agent-runner | grep TEMPORAL_SERVICE_ADDRESS

# 3. Check container logs for connection errors
docker logs stigmer-agent-runner --tail 50

# 4. Verify Temporal is listening on host
lsof -ti:7233  # Should return PID
```

**Related Docs**:
- Changelog: `_changelog/2026-01/2026-01-22-022000-fix-agent-runner-docker-networking-macos.md`
- Troubleshooting: `docs/guides/agent-runner-local-mode.md` (Docker networking section)
- Implementation: `client-apps/cli/internal/cli/daemon/daemon.go`
- Logs support: `client-apps/cli/internal/cli/logs/*.go`
- Docker docs: https://docs.docker.com/desktop/networking/#i-want-to-connect-from-a-container-to-a-service-on-the-host

**Key Takeaway**: Docker containers on macOS cannot reach the host via `localhost`. Always use `host.docker.internal` on macOS/Windows, `localhost` on Linux. Implement OS detection with `runtime.GOOS`. Extend log/diagnostic commands to support Docker containers alongside file-based logging. Test on macOS - Linux behavior is different.

---

## Configuration & Context

### 2026-01-22 - Configuration Cascade Pattern (CLI Flags → Env Vars → Config File → Defaults)

**Problem**: Users needed flexible ways to configure agent execution mode (local/sandbox/auto), but only environment variables were supported:
```bash
export STIGMER_EXECUTION_MODE=sandbox  # Only method
```

This created issues:
- CI/CD needed env vars (good) ✅
- Daily dev wanted persistent config (bad - had to re-export every session) ❌
- Quick testing needed temporary overrides (bad - had to unset env var after) ❌

**Root Cause**: Single configuration method doesn't serve all use cases. Different workflows need different configuration approaches.

**Solution**: Implement industry-standard **configuration cascade pattern** following Docker, kubectl, AWS CLI, Terraform:

```
Priority Order (highest to lowest):
1. CLI Flags        → stigmer server start --execution-mode=sandbox
2. Environment Variables → export STIGMER_EXECUTION_MODE=sandbox
3. Config File      → execution.mode in ~/.stigmer/config.yaml
4. Defaults         → local mode
```

**Implementation Pattern**:

**1. Add Config Struct** (`config.go`):
```go
type ExecutionConfig struct {
    Mode          string `yaml:"mode"`
    SandboxImage  string `yaml:"sandbox_image,omitempty"`
    AutoPull      bool   `yaml:"auto_pull"`
    Cleanup       bool   `yaml:"cleanup"`
    TTL           int    `yaml:"ttl,omitempty"`
}

type LocalBackendConfig struct {
    // ... existing fields
    Execution *ExecutionConfig `yaml:"execution,omitempty"`
}
```

**2. Add Resolve Methods** (following existing LLM pattern):
```go
// Priority: env var > config file > default
func (c *LocalBackendConfig) ResolveExecutionMode() string {
    // 1. Check environment variable (highest priority)
    if mode := os.Getenv("STIGMER_EXECUTION_MODE"); mode != "" {
        return mode
    }
    
    // 2. Check config file
    if c.Execution != nil && c.Execution.Mode != "" {
        return c.Execution.Mode
    }
    
    // 3. Default
    return "local"
}
```

**3. Add CLI Flags** (`server.go`):
```go
cmd.Flags().String("execution-mode", "", "Agent execution mode: local, sandbox, or auto")
cmd.Flags().String("sandbox-image", "", "Docker image for sandbox mode")
cmd.Flags().Bool("sandbox-auto-pull", true, "Auto-pull sandbox image if missing")
cmd.Flags().Bool("sandbox-cleanup", true, "Cleanup sandbox containers")
cmd.Flags().Int("sandbox-ttl", 3600, "Container reuse TTL in seconds")
```

**4. StartOptions Pass-Through** (`daemon.go`):
```go
type StartOptions struct {
    Progress        *cliprint.ProgressDisplay
    ExecutionMode   string  // CLI flag override
    SandboxImage    string  // CLI flag override
    SandboxAutoPull bool    // CLI flag override
    SandboxCleanup  bool    // CLI flag override
    SandboxTTL      int     // CLI flag override
}

// Resolution logic (CLI flags > Resolve methods)
executionMode := opts.ExecutionMode
if executionMode == "" {
    executionMode = cfg.Backend.Local.ResolveExecutionMode()
}
```

**5. Config Helper Commands** (`config.go`):
```go
stigmer config get execution.mode
stigmer config set execution.mode sandbox
stigmer config list
stigmer config path
```

**Usage Examples**:

```bash
# Method 1: CLI Flag (one-off override)
stigmer server start --execution-mode=sandbox

# Method 2: Environment Variable (session/CI)
export STIGMER_EXECUTION_MODE=sandbox
stigmer server start

# Method 3: Config File (persistent)
stigmer config set execution.mode sandbox
stigmer server start

# Priority Test (CLI flag wins)
stigmer config set execution.mode local     # Config file: local
export STIGMER_EXECUTION_MODE=sandbox       # Env var: sandbox
stigmer server start --execution-mode=auto  # CLI flag: auto
# Result: Uses auto (highest priority)
```

**Why This Pattern**:

✅ **Flexibility** - Users choose method that fits their workflow:
- Daily dev: Config file (set once, forget)
- CI/CD: Env vars (standard for pipelines)
- Testing: CLI flags (quick temporary overrides)

✅ **Industry Standard** - Matches familiar tools:
- Docker: `docker run --memory=512m` (flag) + `DOCKER_HOST` (env) + `config.json`
- kubectl: `--namespace` (flag) + `KUBECTL_NAMESPACE` (env) + `kubeconfig`
- AWS CLI: `--region` (flag) + `AWS_REGION` (env) + `~/.aws/config`

✅ **Predictable** - Clear priority order, no ambiguity

✅ **Discoverable** - `stigmer config list` shows all options

**Prevention**:

- ✅ **New config features should follow this cascade pattern**
- ✅ **Add Resolve*() method** for env var + config file resolution
- ✅ **Add CLI flag** for command-level overrides
- ✅ **Add to StartOptions** if needs to pass to daemon
- ✅ **Update config helper commands** (get/set support)
- ✅ **Document all three methods** in user docs

**Pattern Template for New Config Features**:

```go
// 1. Add to config struct
type LocalBackendConfig struct {
    NewFeature *NewFeatureConfig `yaml:"new_feature,omitempty"`
}

type NewFeatureConfig struct {
    Setting string `yaml:"setting"`
}

// 2. Add Resolve method
func (c *LocalBackendConfig) ResolveNewFeatureSetting() string {
    // Priority: env var > config file > default
    if val := os.Getenv("STIGMER_NEW_FEATURE_SETTING"); val != "" {
        return val
    }
    if c.NewFeature != nil && c.NewFeature.Setting != "" {
        return c.NewFeature.Setting
    }
    return "default_value"
}

// 3. Add CLI flag
cmd.Flags().String("new-feature-setting", "", "Description")

// 4. Add to StartOptions (if needed)
type StartOptions struct {
    NewFeatureSetting string
}

// 5. Update config commands (get/set)
case "new_feature.setting":
    return config.NewFeature.Setting
```

**Benefits Over Single-Method Approach**:

| Scenario | Before (Env Var Only) | After (Cascade) |
|----------|----------------------|-----------------|
| Daily dev | Export every session ❌ | Config file once ✅ |
| CI/CD | Env vars ✅ | Env vars ✅ |
| Quick test | Unset env after ❌ | CLI flag ✅ |
| Team standard | Share env vars ❌ | Share config file ✅ |

**Related Docs**:
- Implementation: `config.go`, `server.go`, `daemon.go`, `config.go` (helper commands)
- User guide: `docs/cli/configuration-cascade.md`
- Implementation: `docs/implementation/configuration-cascade-implementation.md`
- Changelog: `_changelog/2026-01/2026-01-22-implement-configuration-cascade-pattern.md`

**Key Takeaway**: Configuration cascade (CLI → Env → Config → Defaults) serves all user workflows. Follow the pattern for any user-configurable setting. Reuse Resolve*() method pattern. Add CLI flags for overrides. Provide helper commands for config file management. Document all three methods. This is the industry standard for good reason.

---

### 2026-01-22 - StartOptions Struct Pattern for CLI Flag Pass-Through

**Problem**: CLI flags parsed in command handler need to flow through daemon startup to Docker container environment variables. Direct parameter passing would require changing function signatures across multiple layers:
```go
daemon.Start(dataDir, executionMode, sandboxImage, autoPull, cleanup, ttl)  // 6+ parameters
```

**Root Cause**: Function signatures become unwieldy when adding new configuration options. Every new flag requires updating multiple function signatures.

**Solution**: Use options struct pattern for extensible configuration:

```go
// Before: Function signature with many parameters
func StartWithOptions(dataDir string, progress *cliprint.ProgressDisplay, 
    executionMode string, sandboxImage string, ...) error

// After: Options struct (extensible, clean)
type StartOptions struct {
    Progress        *cliprint.ProgressDisplay
    ExecutionMode   string
    SandboxImage    string
    SandboxAutoPull bool
    SandboxCleanup  bool
    SandboxTTL      int
}

func StartWithOptions(dataDir string, opts StartOptions) error {
    // Access via opts.ExecutionMode, opts.SandboxImage, etc.
}
```

**Usage in Command Handler**:
```go
func handleServerStart(cmd *cobra.Command) {
    // Parse CLI flags
    executionMode, _ := cmd.Flags().GetString("execution-mode")
    sandboxImage, _ := cmd.Flags().GetString("sandbox-image")
    // ... parse other flags
    
    // Pass through options struct
    daemon.StartWithOptions(dataDir, daemon.StartOptions{
        Progress:        progress,
        ExecutionMode:   executionMode,
        SandboxImage:    sandboxImage,
        SandboxAutoPull: sandboxAutoPull,
        SandboxCleanup:  sandboxCleanup,
        SandboxTTL:      sandboxTTL,
    })
}
```

**Benefits**:
- ✅ **Extensible** - Add new options without changing signatures
- ✅ **Self-documenting** - Field names show purpose
- ✅ **Optional** - Can omit fields (zero values)
- ✅ **Backward compatible** - Add fields without breaking existing calls
- ✅ **Type-safe** - Compiler catches field typos

**Prevention**:
- Use options struct when function needs 4+ parameters
- Use options struct for configuration that grows over time
- Don't create options struct for simple 1-2 parameter functions
- Name clearly: `StartOptions`, `ExecuteOptions`, `DeployOptions`

**Related Pattern**: Functional options (Google style guide alternative):
```go
type StartOption func(*StartOptions)

func WithProgress(p *cliprint.ProgressDisplay) StartOption {
    return func(opts *StartOptions) { opts.Progress = p }
}

// Usage
daemon.Start(dataDir, WithProgress(p), WithExecutionMode("sandbox"))
```

Both patterns work. Choose based on:
- **Struct pattern**: When you control all call sites, simpler
- **Functional options**: When library needs extensibility, more flexible

For Stigmer (internal use): **Struct pattern is simpler and sufficient**.

**Related Docs**:
- Implementation: `daemon.go` (StartOptions), `server.go` (flag parsing)
- Changelog: `_changelog/2026-01/2026-01-22-implement-configuration-cascade-pattern.md`
- Pattern source: Google Go Style Guide (Options pattern)

**Key Takeaway**: Options struct pattern enables clean extension of function parameters without breaking backward compatibility. Use for configuration that grows. Name fields clearly. Make optional fields use pointer or zero value defaults.

---
