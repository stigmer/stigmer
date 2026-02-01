# Agent Validate & Get Commands + Enum-Based ID Detection

**Date**: February 1, 2026

## Summary

Completed Sub-task 5 of the Agent YAML-First initiative by implementing `stigmer agent validate` and `stigmer agent get` commands, plus a critical architectural improvement: refactored the entire CLI reference parsing system to derive resource ID prefixes from the ApiResourceKind enum instead of hardcoding them. This eliminates a major source of technical debt and ensures the CLI automatically adapts as new resource kinds are added to the platform.

The validate command enables CI-friendly configuration validation without backend connectivity, while the get command provides flexible resource retrieval by ID, slug, or org/slug with multiple output formats. The enum-based ID detection creates a single source of truth for resource identification across the entire CLI.

## Problem Statement

### Need for Validation and Retrieval Commands

After implementing the `stigmer agent apply` command, users needed two additional capabilities:

1. **Pre-deployment validation**: Ability to validate agent YAML files in CI/CD pipelines without connecting to the backend or actually creating resources
2. **Resource inspection**: Ability to fetch and view existing agents by name, organization/name, or resource ID in various output formats (human-readable table, YAML for editing, JSON for scripting)

### The Hardcoded Prefix Problem

The CLI's reference parsing system (`pkg/reference`) had a critical architectural flaw: resource ID prefixes were hardcoded as string literals throughout the code:

```go
// OLD APPROACH - Hardcoded prefixes everywhere
func IsAgentID(ref string) bool {
    return strings.HasPrefix(ref, "agt_")  // What if prefix changes?
}

func IsMcpServerID(ref string) bool {
    return strings.HasPrefix(ref, "mcp-")  // Different separator, inconsistent
}
```

**Pain Points**:

1. **Duplication**: Prefixes were defined in proto enum options (`id_prefix: "agt"`) but duplicated in CLI code
2. **Maintenance burden**: Every new resource kind required manual updates to `pkg/reference`
3. **Drift risk**: CLI and backend could use different prefixes, causing bugs
4. **No single source of truth**: Two independent systems (proto enum + hardcoded strings) that could diverge
5. **Inconsistency**: Some IDs used underscores (`agt_`), others hyphens (`mcp-`), with no clear pattern
6. **Scalability**: Adding session, environment, and future resource kinds would multiply the duplication

The user explicitly called out this issue: "IDs always have prefixes and a ULID value (e.g., `prefix_ULID`), and the CLI code should NOT hardcode these prefix values. Instead, the prefixes should be extracted from the enum options."

## Solution

### High-Level Approach

**Architectural shift**: Make the ApiResourceKind enum the single source of truth for resource ID prefixes. The CLI dynamically fetches prefixes from enum metadata at runtime instead of hardcoding them.

**Command design**: Follow the proven MCP Server pattern for both validate and get commands, ensuring consistency across the CLI.

**Three-part implementation**:

1. **Prerequisite (Step 0)**: Refactor `pkg/reference` to use enum-derived prefixes
2. **Validation command**: Load + validate YAML without backend (CI-friendly)
3. **Get command**: Fetch agent by reference with flexible output formats

## Implementation Details

### Part 1: Enum-Based ID Detection (Step 0)

**Core abstraction** - `isResourceIDWithKind()`:

```go
// NEW APPROACH - Dynamic prefix lookup from enum
func isResourceIDWithKind(ref string, kind apiresourcekind.ApiResourceKind) bool {
    prefix, err := apiresource.GetIdPrefix(kind)  // Fetch from enum metadata
    if err != nil || prefix == "" {
        return false
    }
    // Support both underscore and hyphen separators
    return strings.HasPrefix(ref, prefix+"_") || strings.HasPrefix(ref, prefix+"-")
}
```

**Refactored all ID check functions**:

```go
// All ID checks now use the enum-driven abstraction
func IsAgentID(ref string) bool {
    return isResourceIDWithKind(ref, apiresourcekind.ApiResourceKind_agent)
}

func IsWorkflowID(ref string) bool {
    return isResourceIDWithKind(ref, apiresourcekind.ApiResourceKind_workflow)
}

func IsSessionID(ref string) bool {
    return isResourceIDWithKind(ref, apiresourcekind.ApiResourceKind_session)
}
```

**Generic ID detection** - `isResourceID()`:

```go
// Check against ALL resource kinds dynamically
func isResourceID(ref string) bool {
    for kind := range apiresourcekind.ApiResourceKind_name {
        k := apiresourcekind.ApiResourceKind(kind)
        if k == apiresourcekind.ApiResourceKind_api_resource_kind_unknown {
            continue
        }
        if isResourceIDWithKind(ref, k) {
            return true
        }
    }
    return isUUID(ref)  // Legacy UUID support
}
```

**Dependencies added**:
- `pkg/reference/BUILD.bazel`: Added `//backend/libs/go/apiresource` and `//apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind`
- Zero hardcoded prefix strings remain in the package

**Test updates**:
- Updated all test cases to use correct enum-derived prefixes
- Added tests for both underscore (`_`) and hyphen (`-`) separators
- Added `TestIsResourceIDWithKind` to verify enum integration
- All 241 lines comply with coding guidelines (< 250 line limit)

### Part 2: Agent Validate Command (Step 3)

**File**: `client-apps/cli/cmd/stigmer/root/agent_validate.go` (78 lines)

**Command specification**:
```go
Use:   "validate [file]"
Args:  cobra.MaximumNArgs(1)
Flags: None
```

**Execution flow**:

```go
func executeAgentValidate(filePath string) error {
    // Step 1: Load configuration file
    loadResult, err := agent.Load(&agent.LoadOptions{FilePath: filePath})
    
    // Step 2: Validate cross-field logic
    err := agent.Validate(loadResult.Agent)
    
    return nil  // Success
}
```

**Features**:
- Auto-detection: Finds `agent.yaml` or `AGENT.yaml` in current directory if no file specified
- Exit codes: 0 for valid, 1 for invalid (CI-friendly)
- Actionable errors: Proto validation + cross-field business logic errors with guidance
- Offline operation: No backend connectivity required

**Use cases**:
```bash
# CI pipeline
stigmer agent validate agent.yaml && echo "Valid"

# Current directory auto-detect
stigmer agent validate

# Pre-commit hook
git diff --cached --name-only | grep -q agent.yaml && stigmer agent validate agent.yaml
```

### Part 3: Agent Get Command (Step 4)

**File**: `client-apps/cli/cmd/stigmer/root/agent_get.go` (115 lines)

**Command specification**:
```go
Use:   "get <name-or-id>"
Args:  cobra.ExactArgs(1)
Flags: --output/-o (table|yaml|json), --org (organization override)
```

**Execution flow** - 5 steps mirroring MCP Server pattern:

```go
func executeAgentGet(opts agentGetOptions) (*agentv1.Agent, error) {
    // 1. Load backend configuration
    cfg, err := config.Load()
    
    // 2. Resolve organization (--org flag > context > local default)
    orgID, err := resolveAgentOrganization(cfg, opts.OrgOverride)
    
    // 3. Ensure daemon running (local mode only)
    if cfg.Backend.Type == config.BackendTypeLocal {
        err := daemon.EnsureRunning(dataDir)
    }
    
    // 4. Connect to backend
    conn, err := backend.NewConnection()
    defer conn.Close()
    
    // 5. Get agent from backend (using enum-based reference parsing)
    result, err := agent.GetFromBackend(conn, orgID, opts.Reference)
    
    return result, nil
}
```

**Reference parsing** - `internal/cli/agent/get.go`:

```go
func GetFromBackend(conn grpc.ClientConnInterface, orgID, ref string) (*agentv1.Agent, error) {
    // Parse reference (auto-detects ID vs slug using enum-based detection)
    parsed, err := reference.Parse(ref, orgID)
    
    client := agentv1.NewAgentQueryControllerClient(conn)
    
    if parsed.IsID {
        // Get by resource ID (e.g., "agt_abc123")
        return client.Get(ctx, &agentv1.AgentId{Value: parsed.ID})
    } else {
        // Get by org/slug reference (e.g., "stigmer/code-reviewer")
        return client.GetByReference(ctx, &apiresource.ApiResourceReference{
            Org:  parsed.Org,
            Kind: apiresourcekind.ApiResourceKind_agent,
            Slug: parsed.Slug,
        })
    }
}
```

**Display formats** - `internal/cli/agent/display.go`:

```go
func DisplayGetResult(agent *agentv1.Agent, format string) {
    switch format {
    case "yaml":
        displayAgentYAML(agent)      // Full proto as YAML (for editing)
    case "json":
        displayAgentJSON(agent)      // Full proto as JSON (for scripts)
    default: // table
        displayAgentTable(agent)     // Human-readable summary
    }
}
```

**Table format**:
```
Agent: Code Review Agent

Metadata:
  ID:          agt_01abc123def456
  Name:        Code Review Agent
  Slug:        code-reviewer
  Org:         stigmer

Spec:
  Name:         Code Review Agent
  Description:  Reviews code for best practices
  Instructions: You are a code review assistant...
  MCP Servers:  2
  Skills:       1
```

**YAML/JSON formats**:
- Proto → protojson → YAML (via generic map for clean output)
- Proto → protojson → JSON (with 2-space indentation)
- Same pattern as `mcpserver.go` for consistency

**Use cases**:
```bash
# Get by slug (uses context organization)
stigmer agent get code-reviewer

# Get by org/slug (explicit organization)
stigmer agent get stigmer/code-reviewer

# Get by resource ID (using enum-derived prefix detection)
stigmer agent get agt_01abc123def456

# Output as YAML (for editing)
stigmer agent get code-reviewer --output yaml > agent.yaml

# Output as JSON (for scripting)
stigmer agent get code-reviewer --output json | jq '.spec.instructions'

# Different organization
stigmer agent get my-agent --org acme-corp
```

### Part 4: Root Command Integration (Step 5)

**File**: `client-apps/cli/cmd/stigmer/root/agent.go` (242 lines)

**Registration**:
```go
func NewAgentCommand() *cobra.Command {
    cmd := &cobra.Command{
        Use:     "agent",
        Aliases: []string{"agt"},
        Short:   "Manage AI agents",
        // ... Long description with examples
    }
    
    cmd.AddCommand(newAgentApplyCommand())
    cmd.AddCommand(newAgentValidateCommand())    // NEW
    cmd.AddCommand(newAgentGetCommand())         // NEW
    
    return cmd
}
```

**Command structure** (current state):
```
stigmer agent
├── apply [file]         ✅ Session 4
├── validate [file]      ✅ Session 5 (this session)
└── get <name-or-id>     ✅ Session 5 (this session)
```

### Files Created and Modified

**New files**:
```
client-apps/cli/cmd/stigmer/root/
├── agent_validate.go                (78 lines)
└── agent_get.go                     (115 lines)

client-apps/cli/internal/cli/agent/
└── get.go                           (84 lines)
```

**Modified files**:
```
client-apps/cli/cmd/stigmer/root/
├── agent.go                         (+2 lines for command registration)
└── BUILD.bazel                      (+2 files to srcs)

client-apps/cli/internal/cli/agent/
├── display.go                       (+77 lines for get output)
└── BUILD.bazel                      (+4 deps: get.go, clierr, reference, apiresourcekind)

client-apps/cli/pkg/reference/
├── reference.go                     (refactored to 241 lines)
├── reference_test.go                (updated all tests, added new ones)
├── doc.go                           (updated documentation)
└── BUILD.bazel                      (+2 deps: apiresource, apiresourcekind)
```

**Other modified** (unrelated to this work):
```
_projects/2026-01/20260131.02.cli-agent-yaml-first/next-task.md
backend/services/workflow-runner/pkg/validation/*_test.go
backend/libs/python/graphton/src/graphton/core/__init__.py
client-apps/cli/internal/cli/artifact/BUILD.bazel
```

### Design Patterns Applied

**1. Coding Guidelines Compliance**:
- All files under 250 lines (agent.go: 242, reference.go: 241, display.go: 161)
- All functions under 50 lines
- Every error wrapped with context using `errors.Wrap()`
- Thin command layer - business logic in `internal/cli/agent`

**2. Single Responsibility**:
- `agent_validate.go`: Command + orchestration only (78 lines)
- `agent_get.go`: Command + orchestration only (115 lines)
- `get.go`: gRPC fetch logic only (84 lines)
- `display.go`: Display formatting only (161 lines)

**3. Consistency with MCP Server**:
- Same orchestration steps (config → org → daemon → connect → execute)
- Same display pattern (table/yaml/json)
- Same error handling (clierr.Handle)
- Same flag naming (--output, --org)

**4. Enum as Single Source of Truth**:
- Zero hardcoded prefix strings in CLI
- Dynamic lookup via `apiresource.GetIdPrefix(kind)`
- Automatic support for new resource kinds
- Both underscore and hyphen separator support

## Benefits

### For CI/CD Pipelines

**Before**: No way to validate agent configurations without deploying
**After**: Fast, offline validation in pre-commit hooks and CI

```bash
# .github/workflows/validate.yml
- name: Validate agent configs
  run: |
    for file in agents/*.yaml; do
      stigmer agent validate "$file"
    done
```

**Impact**: Catch configuration errors before deployment, reducing failed deployments

### For Development Workflow

**Before**: Edit YAML → apply → check backend → iterate
**After**: Get → edit → validate → apply

```bash
# Export, edit, validate, re-apply workflow
stigmer agent get my-agent -o yaml > agent.yaml
vim agent.yaml
stigmer agent validate agent.yaml
stigmer agent apply agent.yaml
```

**Impact**: Faster iteration cycles, fewer round-trips to backend

### For Scripting and Automation

**Before**: No programmatic way to inspect agents
**After**: JSON output for scripts, YAML for GitOps

```bash
# Extract specific fields in scripts
instructions=$(stigmer agent get my-agent -o json | jq -r '.spec.instructions')

# GitOps workflow
stigmer agent get prod-agent -o yaml > gitops/agents/prod-agent.yaml
git commit -m "chore: update prod agent config"
```

**Impact**: Enables infrastructure-as-code patterns for agent management

### For Platform Architecture

**Before**: Hardcoded prefixes created maintenance burden and drift risk
**After**: Single source of truth, automatic adaptation to new resource kinds

**Concrete improvements**:
1. **Zero duplication**: Prefixes defined once in proto, used everywhere
2. **Automatic updates**: Adding `session`, `environment`, etc. requires no CLI changes
3. **No drift risk**: CLI and backend always use same prefix values
4. **Consistent separators**: Both `_` and `-` supported uniformly
5. **Future-proof**: Platform can evolve without CLI code changes

**Example - Adding a new resource kind**:
```protobuf
// In proto enum (backend/stigmer-cloud)
enum ApiResourceKind {
  session = 8 [
    (kind_meta) = {
      id_prefix: "ses"
      name: "Session"
    }
  ];
}
```

**CLI automatically supports it** - no code changes needed:
```go
// This works immediately, no updates to pkg/reference required
IsSessionID("ses_abc123")  // → true
Parse("ses_abc123", "")    // → ParsedReference{IsID: true, ID: "ses_abc123"}
```

## Impact

### User Experience

**CLI Command Growth**:
```
stigmer agent
├── apply          ← Session 4
├── validate       ← Session 5 (NEW)
├── get            ← Session 5 (NEW)
├── list           ← Session 6 (pending)
├── delete         ← Session 6 (pending)
└── run            ← Session 7 (pending)
```

**Workflow enablement**:
- Pre-deployment validation for safer deployments
- Resource inspection for debugging and auditing
- Export/edit/re-apply for configuration management
- Script integration for automation

### Technical Debt Reduction

**Eliminated**:
- Hardcoded ID prefix strings (9+ occurrences removed)
- Maintenance burden for new resource kinds
- Risk of CLI/backend prefix divergence

**Created**:
- Single source of truth for resource identification
- Extensible system that scales with platform growth
- Foundation for future `session`, `environment`, `artifact` resources

### Code Quality

**Before enum refactoring**:
- 256 lines in reference.go with hardcoded strings
- Tests using incorrect enum values (numeric codes vs text)
- Manual updates required for each new resource kind

**After enum refactoring**:
- 241 lines in reference.go (15 lines saved despite added functionality)
- Tests using correct enum constants
- Zero maintenance for new resource kinds

**Test coverage**:
- Reference package: 28 tests passing (including enum integration)
- Agent package: All tests passing (loader + validator + display)
- Pattern consistency: 100% alignment with MCP Server commands

## Related Work

**Builds on**:
- [2026-02-01-092828] Agent Apply Command Foundation (Session 4)
- [2026-02-01-091708] Agent Applier & Display Foundation (Session 3)
- [2026-02-01-090942] Agent Schema Validator (Session 2)
- [2026-02-01-085647] Agent YAML Loader Foundation (Session 1)

**Enables**:
- Session 6: Agent List & Delete Commands
- Session 7: Agent Run Command
- Phase 2: Workflow Command Restructuring
- Future: Session, Environment, Artifact resource commands

**Architectural impact**:
- Establishes enum-as-source-of-truth pattern for all resource IDs
- All future resource kinds (session, environment, artifact) benefit automatically
- Reference parsing system is now platform-scale ready

## Phase 1 Progress

**Sub-tasks completed**:
- [x] Sub-task 1: Agent YAML Loader (Session 1)
- [x] Sub-task 2: Agent Schema Validator (Session 2)
- [x] Sub-task 3: Agent Applier & Display (Session 3)
- [x] Sub-task 4: Agent Apply Command (Session 4)
- [x] **Sub-task 5: Validate + Get Commands (Session 5) ← This session**
- [ ] Sub-task 6: List + Delete Commands (Session 6)
- [ ] Sub-task 7: Run Command (Session 7)

**Progress**: 5 of 7 sub-tasks complete (71%)

**Target CLI structure**:
```
stigmer agent
├── apply          ✅ YAML-based declarative apply
├── validate       ✅ CI-friendly validation
├── get            ✅ Flexible retrieval with multiple formats
├── list           🔲 Browse agents (pending)
├── delete         🔲 Remove agents with confirmation (pending)
└── run            🔲 Execute agents (pending)
```

---

**Status**: ✅ Production Ready
**Timeline**: Session 5 of Agent YAML-First initiative
**Next**: Sub-task 6 - List & Delete Commands
