# Task T01: Self-Bootstrapping Agent & Skill System (Practical Plan)

**Created**: 2026-02-07
**Revised**: 2026-02-08 (Incorporated seedpack bootstrap research findings)
**Status**: APPROVED
**Type**: Feature Development
**Supersedes**: T01_1_revised_plan.md (Deep Research output - not implementation-aware)
**Research**: [research.seedpack-bootstrap-architecture/04.report.gpt.md](../research.seedpack-bootstrap-architecture/04.report.gpt.md)

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
| SDK: skill.FromGit() | Import skills from git repos during apply |
| SDK: agent.New() | Create agents with skill references |

### What We're NOT Building (Overkill from Deep Research)
- ❌ Separate `skills`, `skill_versions`, `skill_files` SQL tables
- ❌ `blobs` table with content-addressed storage (ZIP approach works)
- ❌ Multi-scope ownership (SYSTEM/ORG/PROJECT/USER) - org scope is sufficient for now
- ❌ Complex permission profile system (defer until sandboxing is needed)

---

## Research Findings: Key Architecture Changes

Deep research on seedpack bootstrap architecture (comparing K3s, Codex, Terraform, Ollama) identified critical changes:

### What Research Validated
| Our Approach | Validation |
|--------------|------------|
| Seedpack embedded in CLI | ✅ K3s packaged components pattern |
| Meta-skill to create skills | ✅ Codex bundles `skill-creator` as SYSTEM |
| Progressive disclosure | ✅ Industry standard (Codex, Claude) |
| ZIP artifact storage | ✅ Aligns with Pulumi, LocalAI |

### Critical Change: No Git Clone on Server Startup

> **Research finding**: "Do not auto-clone upstream repos during server startup."

**Original plan** (problematic):
```go
skill.FromGit(ctx, "https://github.com/anthropics/skills", ...)  // Network on startup!
```

**Revised approach** (research-informed):
- **Vendor** skill content in binary (pinned to commit SHA)
- **No network** required for server startup or bootstrap
- **Explicit update** via `stigmer seed update` command

### Patterns to Adopt
| Pattern | Source | Application |
|---------|--------|-------------|
| Bundled content, applied on startup | K3s | Seedpack embedded, bootstrap on server start |
| Lockfile with checksums | Terraform | Provenance tracking (git url, commit, digest) |
| Lazy model pulling | Ollama | Server starts without network |
| System skills with disable | Codex | `stigmer system disable <skill>` |
| Durable step tracking | K3s AddOns | Bootstrap as state machine |

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

## Phase 1: Vendored Seedpack (Offline-First Bootstrap)

> **Goal**: Bundle essential skills in CLI with vendored content for offline operation.
> **Key change**: Content is vendored at build time, not fetched at runtime.

### Task 1.1: Vendor Anthropic's skill-creator

**One-time vendoring process** (done during Stigmer release, not at runtime):

```bash
# Clone and pin to specific commit
git clone https://github.com/anthropics/skills /tmp/anthropic-skills
cd /tmp/anthropic-skills
COMMIT_SHA=$(git rev-parse HEAD)

# Copy skill-creator to seedpack
mkdir -p client-apps/cli/internal/seedpack/skills/skill-creator
cp -r skills/skill-creator/* client-apps/cli/internal/seedpack/skills/skill-creator/

# Create provenance record
cat > client-apps/cli/internal/seedpack/skills/skill-creator/provenance.json << EOF
{
  "source_type": "git",
  "git_url": "https://github.com/anthropics/skills",
  "git_ref": "main",
  "commit_sha": "$COMMIT_SHA",
  "vendored_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "digest": "sha256:$(find . -type f -exec sha256sum {} \; | sha256sum | cut -d' ' -f1)"
}
EOF
```

**Deliverables:**
- [ ] Vendor skill-creator from Anthropic (pin to commit SHA)
- [ ] Create provenance.json with full tracking
- [ ] Add LICENSE attribution file

---

### Task 1.2: Create Seedpack Directory Structure

**Directory Structure:**
```
client-apps/cli/internal/seedpack/
├── manifest.json              # Version, checksums, provenance refs
├── skills/
│   ├── skill-creator/
│   │   ├── SKILL.md           # Vendored from Anthropic
│   │   ├── provenance.json    # Git origin tracking
│   │   └── LICENSE            # Attribution
│   └── yaml-validator/
│       ├── SKILL.md           # Created by skill-creator-agent
│       ├── provenance.json    # "created_by: skill-creator-agent"
│       └── scripts/
│           └── validate.py    # Schema validation
└── agents/
    └── skill-creator-agent.yaml  # Pre-defined agent config
```

**manifest.json:**
```json
{
  "version": "1.0.0",
  "created_at": "2026-02-08T00:00:00Z",
  "description": "Stigmer system seedpack - bootstrap resources",
  "skills": [
    {
      "name": "skill-creator",
      "path": "skills/skill-creator",
      "digest": "sha256:abc123...",
      "source": "anthropic"
    }
  ],
  "agents": [
    {
      "name": "skill-creator-agent",
      "path": "agents/skill-creator-agent.yaml"
    }
  ]
}
```

**Deliverables:**
- [ ] Create seedpack directory structure
- [ ] Create manifest.json with version and digests
- [ ] Validate skill-creator SKILL.md format compatibility

---

### Task 1.3: Go Embed Infrastructure

Embed the seed pack in the CLI binary.

**Implementation:**
```go
// client-apps/cli/internal/seedpack/embed.go
package seedpack

import (
    "embed"
    "encoding/json"
)

//go:embed manifest.json skills/* agents/*
var Content embed.FS

// Manifest represents the seedpack metadata
type Manifest struct {
    Version     string  `json:"version"`
    CreatedAt   string  `json:"created_at"`
    Description string  `json:"description"`
    Skills      []Skill `json:"skills"`
    Agents      []Agent `json:"agents"`
}

type Skill struct {
    Name   string `json:"name"`
    Path   string `json:"path"`
    Digest string `json:"digest"`
    Source string `json:"source"`
}

type Agent struct {
    Name string `json:"name"`
    Path string `json:"path"`
}

type Provenance struct {
    SourceType  string `json:"source_type"`
    GitURL      string `json:"git_url,omitempty"`
    GitRef      string `json:"git_ref,omitempty"`
    CommitSHA   string `json:"commit_sha,omitempty"`
    VendoredAt  string `json:"vendored_at"`
    Digest      string `json:"digest"`
}

// LoadManifest reads the embedded manifest
func LoadManifest() (*Manifest, error) {
    data, err := Content.ReadFile("manifest.json")
    if err != nil {
        return nil, err
    }
    var m Manifest
    if err := json.Unmarshal(data, &m); err != nil {
        return nil, err
    }
    return &m, nil
}

// LoadSkillContent loads a skill's SKILL.md content
func LoadSkillContent(skillPath string) (string, error) {
    data, err := Content.ReadFile(skillPath + "/SKILL.md")
    if err != nil {
        return "", err
    }
    return string(data), nil
}
```

**Deliverables:**
- [ ] Implement `seedpack.LoadManifest()` function
- [ ] Implement `seedpack.LoadSkillContent()` function
- [ ] Parse SKILL.md frontmatter for metadata
- [ ] Parse agent YAML files
- [ ] Unit tests for loading

---

## Phase 2: Server Bootstrap (Offline, No Network)

> **Goal**: Apply seedpack to registry on server startup without network.
> **Key principle**: Bootstrap uses only embedded content.

### Task 2.1: Bootstrap State Machine

Based on research: model bootstrap as durable steps for resumability.

**[bootstrap.go](backend/services/stigmer-server/pkg/server/bootstrap.go)**

```go
package server

// BootstrapStep represents a step in the bootstrap process
type BootstrapStep string

const (
    StepExtractBundle   BootstrapStep = "extract_bundle"
    StepApplySkills     BootstrapStep = "apply_skills"
    StepApplyAgents     BootstrapStep = "apply_agents"
    StepVerifyIntegrity BootstrapStep = "verify_integrity"
    StepMarkComplete    BootstrapStep = "mark_complete"
)

// BootstrapState tracks progress (persisted to DB)
type BootstrapState struct {
    SeedpackVersion string                       `json:"seedpack_version"`
    Steps           map[BootstrapStep]StepStatus `json:"steps"`
    StartedAt       time.Time                    `json:"started_at"`
    CompletedAt     *time.Time                   `json:"completed_at,omitempty"`
}

type StepStatus struct {
    Status    string    `json:"status"` // pending, running, completed, failed
    Error     string    `json:"error,omitempty"`
    Timestamp time.Time `json:"timestamp"`
}

func RunBootstrap(ctx context.Context, db Store, manifest *seedpack.Manifest) error {
    // 1. Check if already bootstrapped with this version
    // 2. Run steps with durability (persist after each step)
    // 3. Don't block on errors - log and continue in degraded mode
}
```

**Deliverables:**
- [ ] Create bootstrap.go with state machine
- [ ] Add bootstrap_state table to SQLite schema
- [ ] Implement step-level persistence
- [ ] Add `stigmer system status` to show bootstrap state

---

### Task 2.2: Server Integration

Add to `server.go` after startup completes (no network required):

```go
// Bootstrap seedpack (offline, uses embedded content only)
manifest, err := seedpack.LoadManifest()
if err != nil {
    log.Warn().Err(err).Msg("Failed to load seedpack manifest")
} else {
    if err := RunBootstrap(ctx, store, manifest); err != nil {
        log.Warn().Err(err).Msg("Bootstrap incomplete, system skills may be unavailable")
        // Don't fail server startup - continue in degraded mode
    }
}
```

**Deliverables:**
- [ ] Add bootstrap call to server.go
- [ ] Ensure bootstrap doesn't block startup on failure
- [ ] Log bootstrap status for debugging

---

## Phase 3: Skill Resolution Chain

> **Goal**: When invoking an agent, resolve skills from registry OR embedded pack.

### Task 3.1: Skill Resolver

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
    SkillMD     string            // Full SKILL.md content
    Scripts     map[string][]byte // path -> content
    Source      SkillSource       // REGISTRY or EMBEDDED
    Provenance  *Provenance       // Origin tracking
}
```

**Deliverables:**
- [ ] `SkillResolver` interface and implementation
- [ ] Registry-first resolution with embedded fallback
- [ ] Include provenance in resolved skill
- [ ] Unit tests with mock registry

---

## Phase 4: Agent Runtime Skill Integration

> **Goal**: Wire up agent invocation with skill loading.

### Task 4.1: Agent Runtime Skill Integration

When an agent is invoked, load its referenced skills and inject into context.

**Flow:**
```
1. Load agent spec (from registry or embedded)
2. For each skill reference in agent.spec.skill_refs:
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

### Task 4.2: skill-creator-agent Configuration

Create the system agent that uses skill-creator skill.

**agents/skill-creator-agent.yaml:**
```yaml
apiVersion: stigmer.ai/v1
kind: Agent
metadata:
  name: skill-creator-agent
  org: stigmer
  labels:
    stigmer.ai/system: "true"
spec:
  description: Creates new skills using the SKILL.md format from Anthropic
  skill_refs:
    - org: stigmer
      slug: skill-creator
  instructions: |
    You are a skill creation assistant. You help users create well-structured
    SKILL.md packages following the Agent Skills format.

    When creating a skill:
    1. Ask clarifying questions about the skill's purpose and scope
    2. Use skill.read("skill-creator") to access format guidelines
    3. Generate a complete, valid SKILL.md file with proper frontmatter
    4. Include clear instructions, examples, and guidelines sections

    Always validate the generated skill against the format requirements.
```

**Deliverables:**
- [ ] skill-creator-agent.yaml in seedpack/agents/
- [ ] Validate agent spec structure

---

## Phase 5: Draft Command Implementation

> **Goal**: Implement `stigmer draft agent` command.

### Task 5.1: Draft Command Infrastructure

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
```

**Deliverables:**
- [ ] `stigmer draft agent` command
- [ ] Streaming conversation support
- [ ] Output to file or stdout
- [ ] `--no-save` flag for dry-run

---

### Task 5.2: Extend to Other Resource Types

Once `draft agent` works, extend to other resources.

**Commands:**
```bash
stigmer draft workflow [--output FILE]
stigmer draft skill [--output FILE]
stigmer draft mcpserver [--output FILE]
```

Each requires:
1. A drafter skill created by skill-creator-agent
2. A drafter agent that uses the skill
3. CLI subcommand wiring

**Deliverables:**
- [ ] `stigmer draft workflow`
- [ ] `stigmer draft skill`
- [ ] `stigmer draft mcpserver`

---

## Phase 6: System Management Commands

> **Goal**: Explicit commands for managing system resources (from research).

### Task 6.1: Seed Update Command

**Command:**
```bash
stigmer seed update                    # Update all system skills from upstream
stigmer seed update skill-creator      # Update specific skill
stigmer seed update --dry-run          # Show what would change
```

**Behavior:**
1. Fetch upstream git repo (requires network)
2. Compare with vendored content
3. Show diff for review
4. User confirms update
5. Re-vendor and update local registry

**Deliverables:**
- [ ] `stigmer seed update` command
- [ ] Diff display for review
- [ ] Confirmation prompt

---

### Task 6.2: System Commands

**Commands:**
```bash
stigmer system list                    # List all system resources
stigmer system status                  # Show bootstrap state
stigmer system diff --upstream         # Compare with upstream
stigmer system disable skill-creator   # Disable without removing
stigmer system enable skill-creator    # Re-enable
```

**Deliverables:**
- [ ] `stigmer system list` command
- [ ] `stigmer system status` command
- [ ] `stigmer system disable/enable` commands

---

## Implementation Order

| Order | Task | Rationale | Effort |
|-------|------|-----------|--------|
| 1 | **1.1**: Vendor skill-creator | Foundation - need the skill content | Small |
| 2 | **1.2**: Create seedpack structure | Directory and manifest setup | Small |
| 3 | **1.3**: Go embed infrastructure | Load skills from binary | Small |
| 4 | **2.1**: Bootstrap state machine | Durable bootstrap logic | Medium |
| 5 | **2.2**: Server integration | Hook bootstrap to server start | Small |
| 6 | **3.1**: Skill resolver | Resolve from registry or embedded | Medium |
| 7 | **4.1**: Agent runtime skill integration | Wire skills into agent invocation | Medium |
| 8 | **4.2**: skill-creator-agent config | The agent that creates skills | Small |
| 9 | **5.1**: `draft agent` command | User-facing feature | Medium |
| 10 | **5.2**: Other draft commands | Extend pattern | Small each |
| 11 | **6.1**: Seed update command | Explicit upstream sync | Medium |
| 12 | **6.2**: System commands | System resource management | Small |

---

## Deferred Items (Not Needed Now)

These can be added later based on production needs:

| Item | When to Add |
|------|-------------|
| Permission Profile System | When you need sandboxing for untrusted skills |
| Skill Lifecycle States (DRAFT/PUBLISHED) | When AI-generated skills need review gates |
| SkillEvalSuite | When you need automated skill testing |
| Trust Tiers | When you support external skill imports |
| Artifact Signing (cosign) | When supply-chain security is critical |
| OCI Registry for Skills | When you need standard container semantics |

---

## Success Criteria

1. ✅ `stigmer server` starts **without network** (uses embedded seedpack)
2. ✅ `stigmer list skills --org stigmer` shows `skill-creator`
3. ✅ `stigmer get agent stigmer/skill-creator-agent` shows the agent
4. ✅ `stigmer run agent skill-creator-agent -m "Create a yaml-validator"` works
5. ✅ `stigmer draft agent` produces valid Agent YAML
6. ✅ `stigmer system status` shows bootstrap state
7. ✅ `stigmer seed update` can sync from upstream (when online)

---

## Risk Mitigations (from Research)

| Risk | Mitigation |
|------|------------|
| Upstream breaking changes | Pin to commit SHA, run compatibility tests in CI |
| Supply-chain attack | Verify digest on every bootstrap, sign artifacts in future |
| Network unavailable | Bootstrap uses only embedded content |
| Silent drift | Treat updates like dependency upgrades (diff, review, confirm) |
| Privilege escalation | Future: tool allowlists in skill frontmatter |

---

## Files to Create/Modify

### New Files:
```
client-apps/cli/internal/seedpack/
├── embed.go                              # Go embed directive and loaders
├── manifest.json                         # Version, checksums, provenance refs
├── skills/skill-creator/
│   ├── SKILL.md                          # Vendored from Anthropic
│   ├── provenance.json                   # Git origin tracking
│   └── LICENSE                           # Attribution
└── agents/
    └── skill-creator-agent.yaml          # Pre-defined agent config

client-apps/cli/internal/skillresolver/
└── resolver.go

client-apps/cli/internal/cli/draft/
└── agent.go

client-apps/cli/cmd/stigmer/root/
├── draft.go                              # draft command group
├── seed.go                               # seed command group
└── system.go                             # system command group

backend/services/stigmer-server/pkg/server/
└── bootstrap.go                          # Bootstrap state machine
```

### Modified Files:
```
backend/services/stigmer-server/pkg/server/server.go     # Add bootstrap call
backend/services/stigmer-server/pkg/storage/sqlite/      # Add bootstrap_state table
client-apps/cli/internal/cli/agent/execute.go            # Add skill loading
client-apps/cli/cmd/stigmer/root/root.go                 # Add draft, seed, system commands
```

---

## Key Design Decisions

| Decision | Rationale | Research Source |
|----------|-----------|-----------------|
| Vendor content, don't git clone on startup | Offline-first, supply-chain security | K3s, Ollama patterns |
| Track provenance (url, commit, digest) | Reproducibility, audit trail | Terraform lockfile |
| Bootstrap as state machine | Resumable, debuggable | K3s AddOn status |
| Explicit update command | User controls when network is used | Terraform `-upgrade` |
| System scope with disable | Override without mutation | Codex system skills |
