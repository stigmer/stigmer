# Task T01: Self-Bootstrapping Agent & Skill System (Practical Plan)

**Created**: 2026-02-07
**Status**: PROPOSED
**Type**: Feature Development
**Supersedes**: T01_1_revised_plan.md (Deep Research output - not implementation-aware)

---

## Context: What Already Exists

Before defining tasks, here's what we DON'T need to rebuild:

### Skill Infrastructure (DONE)
| Component | Implementation |
|-----------|----------------|
| Skill Proto Resource | `Skill` with `metadata`, `spec`, `status` in `apis/ai/stigmer/agentic/skill/v1/` |
| Versioning | Content-addressed via `version_hash` (SHA256 of artifact ZIP) |
| Mutable Tags | `tag` field in `SkillSpec` |
| Git Provenance | `GitProvenance` message tracks origin |
| Artifact Storage | ZIP-based with `artifact_storage_key` |
| CLI: Push | `stigmer push skill` (local + remote git) |
| CLI: Get | `stigmer get skill` |
| CLI: List | `stigmer list skills` |
| CLI: Delete | `stigmer delete skill` |

### What We're NOT Building (Overkill from Deep Research)
- ❌ Separate `skills`, `skill_versions`, `skill_files` SQL tables
- ❌ `blobs` table with content-addressed storage (ZIP approach works)
- ❌ Multi-scope ownership (SYSTEM/ORG/PROJECT/USER) - org scope is sufficient for now
- ❌ Complex permission profile system (defer until sandboxing is needed)

---

## Goal: Enable `stigmer draft agent`

The primary deliverable is a working `stigmer draft agent` command that uses an AI agent to help users create valid Agent YAML configurations.

**Target Flow:**
```
User: stigmer draft agent
CLI: [resolves agent-drafter-agent from registry or embedded pack]
CLI: [invokes agent with streaming conversation]
Agent: [uses skill-creator skill + yaml-validator skill]
Agent: [produces valid agent.yaml]
CLI: [saves to file or displays]
```

---

## Phase 1: Embedded Seed Skills (CLI Foundation)

> **Goal**: Bundle essential skills in CLI for offline operation and bootstrapping.

### Task 1.1: Create Seed Skills Directory

Create skills that will be embedded in the CLI binary.

**Directory Structure:**
```
client-apps/cli/internal/seedpack/
├── manifest.yaml           # Version, checksums
├── skills/
│   ├── skill-creator/
│   │   └── SKILL.md        # Adapted from Anthropic (with attribution)
│   └── yaml-validator/
│       ├── SKILL.md
│       └── scripts/
│           └── validate.py # Schema validation
└── agents/
    └── agent-drafter.yaml  # Agent that uses the skills
```

**skill-creator/SKILL.md** - Instructions for creating new skills (adapted from Anthropic's format with proper attribution).

**yaml-validator/SKILL.md** - Deterministic schema validation for Stigmer resources.

**Deliverables:**
- [ ] Create `seedpack/` directory structure
- [ ] Adapt Anthropic skill-creator (with LICENSE attribution)
- [ ] Create yaml-validator skill with Stigmer schema support
- [ ] Create manifest.yaml with version tracking

---

### Task 1.2: Go Embed Infrastructure

Embed the seed pack in the CLI binary.

**Implementation:**
```go
// client-apps/cli/internal/seedpack/loader.go
package seedpack

import "embed"

//go:embed manifest.yaml skills/* agents/*
var content embed.FS

type SeedPack struct {
    Version  string
    Skills   map[string]*Skill
    Agents   map[string]*Agent
}

func Load() (*SeedPack, error) {
    // Parse manifest
    // Load skills (parse SKILL.md frontmatter)
    // Load agents (parse YAML)
    return &SeedPack{...}, nil
}
```

**Deliverables:**
- [ ] Implement `seedpack.Load()` function
- [ ] Parse SKILL.md frontmatter for metadata
- [ ] Parse agent YAML files
- [ ] Unit tests for loading

---

## Phase 2: Skill Resolution Chain

> **Goal**: When invoking an agent, resolve skills from registry OR embedded pack.

### Task 2.1: Skill Resolver

Create a resolver that checks registry first, falls back to embedded pack.

**Resolution Order:**
```
1. Registry (by org/slug@version or org/slug@tag)
2. Embedded seed pack (by name)
```

**Interface:**
```go
// client-apps/cli/internal/skillresolver/resolver.go
type SkillResolver interface {
    // Resolve skill by reference, returns artifact bytes
    Resolve(ctx context.Context, ref string) (*ResolvedSkill, error)
}

type ResolvedSkill struct {
    Name        string
    Description string
    SkillMD     string          // Full SKILL.md content
    Scripts     map[string][]byte // path -> content
    Source      SkillSource     // REGISTRY or EMBEDDED
}
```

**Deliverables:**
- [ ] `SkillResolver` interface and implementation
- [ ] Registry-first resolution with embedded fallback
- [ ] Unit tests with mock registry

---

## Phase 3: Agent Invocation Infrastructure

> **Goal**: Wire up agent invocation with skill loading.

### Task 3.1: Agent Runtime Skill Integration

When an agent is invoked, load its referenced skills and inject into context.

**Flow:**
```
1. Load agent spec (from registry or embedded)
2. For each skill reference in agent.spec.skills:
   a. Resolve skill using SkillResolver
   b. Extract metadata (name, description)
3. Build SkillIndex (compact list for system prompt)
4. Provide skill.read() tool for on-demand content access
```

**SkillIndex Format** (injected into system prompt):
```yaml
# Available Skills
You have access to the following skills. Use `skill.read(name)` to load full instructions.

- **skill-creator**: Creates new skills following the SKILL.md format
- **yaml-validator**: Validates YAML against Stigmer schemas
```

**Deliverables:**
- [ ] SkillIndex builder
- [ ] `skill.read(name)` tool implementation
- [ ] Integration point in agent invocation flow

---

### Task 3.2: Agent-Drafter Agent Configuration

Create the agent that will power `stigmer draft agent`.

**agent-drafter.yaml:**
```yaml
apiVersion: stigmer.ai/v1
kind: Agent
metadata:
  name: agent-drafter
  org: stigmer  # system org or embedded
spec:
  description: Creates valid Stigmer Agent YAML configurations through conversation
  skills:
    - name: skill-creator
    - name: yaml-validator
  systemPrompt: |
    You are an assistant that helps users create Stigmer Agent configurations.
    
    When the user wants to create an agent:
    1. Ask clarifying questions about the agent's purpose
    2. Use the yaml-validator skill to validate your output
    3. Return a complete, valid agent.yaml
    
    Use skill.read("yaml-validator") to access validation instructions.
```

**Deliverables:**
- [ ] agent-drafter.yaml in seedpack/agents/
- [ ] Validate agent spec structure

---

## Phase 4: Draft Command Implementation

> **Goal**: Implement `stigmer draft agent` command.

### Task 4.1: Draft Command Infrastructure

**Command:**
```bash
stigmer draft agent [--output FILE] [--no-save]
```

**Implementation:**
```go
// client-apps/cli/cmd/stigmer/root/draft.go
func newDraftCmd() *cobra.Command {
    cmd := &cobra.Command{
        Use:   "draft <resource-type>",
        Short: "Create resource configurations with AI assistance",
    }
    cmd.AddCommand(newDraftAgentCmd())
    // Future: draft workflow, draft skill, draft mcpserver
    return cmd
}

// client-apps/cli/internal/cli/draft/agent.go
func DraftAgent(ctx context.Context, opts DraftOptions) error {
    // 1. Resolve agent-drafter agent (embedded or registry)
    // 2. Invoke agent with streaming conversation
    // 3. Capture final YAML output
    // 4. Optionally save to file
}
```

**Deliverables:**
- [ ] `stigmer draft agent` command
- [ ] Streaming conversation support
- [ ] Output to file or stdout
- [ ] `--no-save` flag for dry-run

---

### Task 4.2: Extend to Other Resource Types

Once `draft agent` works, extend to other resources.

**Commands:**
```bash
stigmer draft workflow [--output FILE]
stigmer draft skill [--output FILE]
stigmer draft mcpserver [--output FILE]
```

Each requires:
1. A drafter skill (e.g., `workflow-drafter`)
2. A drafter agent (e.g., `workflow-drafter-agent`)
3. CLI subcommand wiring

**Deliverables:**
- [ ] `stigmer draft workflow`
- [ ] `stigmer draft skill`
- [ ] `stigmer draft mcpserver`

---

## Phase 5: Registry Bootstrap (Optional)

> **Goal**: Sync embedded skills to registry for discoverability.

### Task 5.1: System Sync Command

**Command:**
```bash
stigmer system sync [--dry-run]
```

**Behavior:**
1. Load embedded seed pack
2. For each skill/agent not in registry:
   - Push to registry under `stigmer` org
3. Record sync version in local config

**When to Implement:** Only needed if you want embedded skills discoverable via `stigmer list skills`. Can be deferred.

**Deliverables:**
- [ ] `stigmer system sync` command
- [ ] Idempotent upsert logic
- [ ] Sync state tracking

---

## Implementation Order

| Order | Task | Rationale | Effort |
|-------|------|-----------|--------|
| 1 | **1.1**: Create seed skills | Foundation - need skills to use | Medium |
| 2 | **1.2**: Go embed infrastructure | Load skills from binary | Small |
| 3 | **2.1**: Skill resolver | Resolve from registry or embedded | Medium |
| 4 | **3.1**: Agent runtime skill integration | Wire skills into agent invocation | Medium |
| 5 | **3.2**: Agent-drafter configuration | The agent that drafts agents | Small |
| 6 | **4.1**: `draft agent` command | User-facing feature | Medium |
| 7 | **4.2**: Other draft commands | Extend pattern | Small each |
| 8 | **5.1**: System sync (optional) | Registry bootstrap | Small |

---

## Deferred Items (Not Needed Now)

These can be added later based on production needs:

| Item | When to Add |
|------|-------------|
| Permission Profile System | When you need sandboxing for untrusted skills |
| Skill Lifecycle States (DRAFT/PUBLISHED) | When AI-generated skills need review gates |
| SkillEvalSuite | When you need automated skill testing |
| Trust Tiers | When you support external skill imports |
| Progressive Disclosure (3-level loading) | When skill count causes prompt bloat |

---

## Success Criteria

1. ✅ `stigmer draft agent` produces valid Agent YAML
2. ✅ Works offline using embedded seed pack
3. ✅ Works with registry-pushed skills when available
4. ✅ Streaming conversation experience
5. ✅ Extensible to other resource types

---

## Dependencies

- **Existing**: Skill push/get/list CLI, Agent proto definitions
- **Needed**: Agent invocation with streaming (may already exist in `agent/execute.go`)

---

## Files to Create/Modify

### New Files:
```
client-apps/cli/internal/seedpack/
├── loader.go
├── manifest.yaml
├── skills/skill-creator/SKILL.md
├── skills/yaml-validator/SKILL.md
├── skills/yaml-validator/scripts/validate.py
└── agents/agent-drafter.yaml

client-apps/cli/internal/skillresolver/
└── resolver.go

client-apps/cli/internal/cli/draft/
└── agent.go

client-apps/cli/cmd/stigmer/root/
└── draft.go (new command)
```

### Modified Files:
```
client-apps/cli/internal/cli/agent/execute.go  # Add skill loading
client-apps/cli/cmd/stigmer/root/root.go       # Add draft command
```
