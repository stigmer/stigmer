# Task T01: Self-Bootstrapping Agent & Skill System (Revised)

**Created**: 2026-02-07
**Revised**: 2026-02-07
**Status**: APPROVED
**Type**: Feature Development
**Research**: 
- [Original Research](../research.platform-capabilities-draft-implementation/04.report.gpt.md)
- [Skill Format Integration Research](../research.skill-format-integration-strategy/04.report.gpt.md) (Primary)

---

## Executive Summary

Build a **self-bootstrapping AI agent and skill system** following industry best practices from Codex, Copilot, and Claude Skills. This is NOT just about embedding prompts—it's about building a complete runtime where **agents use skills** to create more capabilities.

**Key Architecture (from deep research):**

1. **Two-Plane Design**: Control plane (DB registry) + Runtime plane (execution engine)
2. **Hybrid Distribution**: Embedded seed pack (offline) + DB registry (online evolution)
3. **Progressive Disclosure**: Metadata → Instructions → Resources (matches Codex/Claude)
4. **Skills as Versioned Packages**: First-class DB resources, not prompt blobs
5. **Trust Boundaries**: DRAFT state for AI-generated skills until reviewed
6. **Eval-Driven Improvement**: Skills require evaluation before publishing

**Bootstrapping Flow:**
```
Anthropic skill-creator → Import as Skill → Create skill-creator-agent
                                                      ↓
                                            Invoke with artifacts (schemas, examples)
                                                      ↓
                                            Creates agent-drafter skill (DRAFT)
                                                      ↓
                                            Review → Publish → Create agent-drafter-agent
                                                      ↓
                                            stigmer draft agent → invokes agent
```

---

## Phase 0: Runtime Primitives (Foundation)

> **Goal**: Build the execution infrastructure BEFORE any self-bootstrapping.
> **Rationale**: Deep research emphasizes that progressive disclosure, permissions, and tracing must be in place first.

### Task 0.1: Skill Package Data Model

**Objective**: Store skills as versioned packages (not prompt blobs) in the database.

**Schema Design**:
```sql
-- Logical identity
skills (
  id UUID PRIMARY KEY,
  slug VARCHAR UNIQUE,
  owner_scope ENUM('SYSTEM', 'ORG', 'PROJECT', 'USER'),
  status ENUM('DRAFT', 'REVIEW_PENDING', 'PUBLISHED', 'DEPRECATED', 'REVOKED'),
  created_at TIMESTAMP
)

-- Immutable versions
skill_versions (
  id UUID PRIMARY KEY,
  skill_id UUID REFERENCES skills,
  version VARCHAR,
  name VARCHAR,
  description TEXT,
  license VARCHAR,
  content_hash VARCHAR,
  created_by_execution_id UUID,  -- provenance
  created_by_agent_version_id UUID,  -- provenance
  created_at TIMESTAMP
)

-- File manifest
skill_files (
  id UUID PRIMARY KEY,
  skill_version_id UUID REFERENCES skill_versions,
  path VARCHAR,  -- e.g., "SKILL.md", "scripts/validate.py"
  blob_id UUID,
  sha256 VARCHAR,
  size INT,
  mime VARCHAR
)

-- Content-addressed storage
blobs (
  sha256 VARCHAR PRIMARY KEY,
  bytes BYTEA,
  external_url VARCHAR  -- optional object store pointer
)
```

**Deliverables**:
- [ ] Proto definitions for Skill, SkillVersion, SkillFile
- [ ] Database migrations
- [ ] CRUD operations in backend service
- [ ] CLI commands: `stigmer skill create`, `stigmer skill get`, `stigmer skill list`

---

### Task 0.2: Progressive Disclosure Implementation

**Objective**: Implement 3-level skill loading (matches Claude/Codex).

**Levels**:
1. **Level 1 (Metadata)**: `name`, `description` - always loaded for discovery
2. **Level 2 (Instructions)**: `SKILL.md` body - loaded when skill triggers
3. **Level 3 (Resources)**: `scripts/`, `references/`, `assets/` - loaded on-demand

**Runtime Tools** (exposed to agents):
```go
// Skill access tools for agent runtime
type SkillAccessTools interface {
    // Read skill file content
    ReadSkillFile(skillID, version, path string) ([]byte, error)
    
    // Run script in sandbox
    RunSkillScript(skillID, version, scriptPath string, args []string) (*ScriptResult, error)
    
    // List available skills (metadata only)
    ListAvailableSkills(scope OwnerScope) ([]*SkillMetadata, error)
}
```

**SkillIndex Injection** (compact list in system prompt):
```yaml
available_skills:
  - name: yaml-validator
    description: Validates YAML against Stigmer schemas
    skill_id: abc123
    version: "1.0.0"
  - name: agent-drafter
    description: Creates valid Agent YAML configurations
    skill_id: def456
    version: "1.2.0"
```

**Deliverables**:
- [ ] SkillIndex builder that generates compact metadata list
- [ ] `skills.read()` tool implementation
- [ ] `skills.run_script()` tool implementation (sandboxed)
- [ ] Integration with agent runtime to inject SkillIndex

---

### Task 0.3: Permission Profile System

**Objective**: Gate dangerous actions with explicit permission profiles.

**Permission Profiles**:
| Profile | Description | Use Case |
|---------|-------------|----------|
| `READ_ONLY` | No file writes, no network | Default for automation |
| `WORKSPACE_WRITE` | Write to current workspace only | Interactive drafting |
| `NET_ALLOWED` | Network access permitted | External API calls |
| `DANGER_FULL_ACCESS` | Unrestricted (gated) | Admin operations |

**Per-Invocation Permissions**:
```proto
message InvokeAgentRequest {
  string agent_id = 1;
  string agent_version = 2;
  PermissionProfile permissions = 3;
  repeated string allowed_tools = 4;  // explicit allowlist
  repeated string allowed_skills = 5;  // explicit allowlist
}

enum PermissionProfile {
  READ_ONLY = 0;
  WORKSPACE_WRITE = 1;
  NET_ALLOWED = 2;
  DANGER_FULL_ACCESS = 3;
}
```

**Deliverables**:
- [ ] Permission profile enum in proto
- [ ] Permission checking in tool execution
- [ ] Interactive approval hooks in CLI
- [ ] Per-tool and per-skill allowlists

---

### Task 0.4: Execution Tracing & Artifact Storage

**Objective**: Full auditability for self-bootstrapping (non-negotiable per research).

**Event Stream** (JSONL format, matches Codex):
```jsonl
{"type": "execution.started", "execution_id": "...", "agent_id": "...", "timestamp": "..."}
{"type": "turn.started", "turn_id": "...", "timestamp": "..."}
{"type": "tool.call", "tool": "skills.read", "input": {...}, "output": {...}}
{"type": "skill.triggered", "skill_id": "...", "version": "..."}
{"type": "file.created", "path": "agent.yaml", "sha256": "..."}
{"type": "turn.completed", "turn_id": "...", "timestamp": "..."}
{"type": "execution.completed", "execution_id": "...", "status": "success"}
```

**Storage**:
```sql
executions (
  id UUID PRIMARY KEY,
  agent_id UUID,
  agent_version_id UUID,
  permissions PermissionProfile,
  status ENUM('RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'),
  started_at TIMESTAMP,
  completed_at TIMESTAMP
)

execution_events (
  id UUID PRIMARY KEY,
  execution_id UUID REFERENCES executions,
  sequence INT,
  event_type VARCHAR,
  payload JSONB,
  timestamp TIMESTAMP
)

execution_artifacts (
  id UUID PRIMARY KEY,
  execution_id UUID REFERENCES executions,
  artifact_type VARCHAR,  -- 'file', 'skill_package', 'yaml_output'
  path VARCHAR,
  blob_id UUID REFERENCES blobs,
  created_at TIMESTAMP
)
```

**Deliverables**:
- [ ] Execution and event storage schema
- [ ] Event emitter in agent runtime
- [ ] Artifact capture and storage
- [ ] CLI command: `stigmer execution get --events`

---

## Phase 1: Embedded System Pack (CLI Bootstrap)

> **Goal**: Embed minimal seed skills/agents for offline operation.
> **Rationale**: Research recommends "bundled system skills" pattern.

### Task 1.1: Create Seed Skills

**Skills to Create**:

| Skill | Purpose | Source |
|-------|---------|--------|
| `skill-creator` | Meta-skill for creating new skills | Adapt from Anthropic |
| `yaml-validator` | Deterministic schema validation | New |
| `resource-packager` | Convert skill folder ↔ DB package | New |

**skill-creator Structure**:
```
skills/skill-creator/
├── SKILL.md           # Instructions (adapted from Anthropic)
├── references/
│   ├── skill-anatomy.md
│   ├── progressive-disclosure.md
│   └── quality-guidelines.md
└── LICENSE.txt        # Attribution to Anthropic
```

**yaml-validator Structure**:
```
skills/yaml-validator/
├── SKILL.md
└── scripts/
    └── validate.py    # Schema validation script
```

**Deliverables**:
- [ ] Adapt Anthropic skill-creator (with proper attribution)
- [ ] Create yaml-validator skill with schema validation
- [ ] Create resource-packager skill
- [ ] Verify all skills follow SKILL.md format

---

### Task 1.2: Create Seed Agents

**Agents to Create**:

| Agent | Allowlisted Skills | Purpose |
|-------|-------------------|---------|
| `skill-creator-agent` | `skill-creator`, `yaml-validator` | Creates new skills |
| `bootstrap-admin-agent` | `resource-packager` | Init/sync ops (restricted) |

**Agent YAML Format**:
```yaml
apiVersion: stigmer.ai/v1
kind: Agent
metadata:
  name: skill-creator-agent
  scope: SYSTEM
spec:
  description: Creates new skills using the SKILL.md format
  model: claude-sonnet  # or default
  skills:
    - skill: skill-creator
      version: "1.0.0"
    - skill: yaml-validator
      version: "1.0.0"
  permissions: WORKSPACE_WRITE
  systemPrompt: |
    You are a skill creation assistant. Use the skill-creator skill
    to help users create well-structured SKILL.md packages.
```

**Deliverables**:
- [ ] skill-creator-agent YAML
- [ ] bootstrap-admin-agent YAML
- [ ] Agent schema validation

---

### Task 1.3: CLI Embedding Infrastructure

**Directory Structure**:
```
client-apps/cli/internal/system-pack/
├── manifest.yaml           # Version, checksums, compatibility
├── skills/
│   ├── skill-creator/
│   │   ├── SKILL.md
│   │   ├── references/
│   │   └── LICENSE.txt
│   ├── yaml-validator/
│   │   ├── SKILL.md
│   │   └── scripts/
│   └── resource-packager/
│       └── SKILL.md
└── agents/
    ├── skill-creator-agent.yaml
    └── bootstrap-admin-agent.yaml
```

**Go Embedding**:
```go
//go:embed system-pack/*
var systemPack embed.FS

func LoadSystemPack() (*SystemPack, error) {
    // Load manifest
    // Parse skills and agents
    // Return structured pack
}
```

**Deliverables**:
- [ ] Create system-pack directory structure
- [ ] Implement Go embed directive
- [ ] Implement SystemPackLoader
- [ ] Unit tests for loading

---

## Phase 2: DB Bootstrap Command

> **Goal**: Idempotent command to sync system pack to database.
> **Rationale**: Research cites OpenAI's "sync system skills from public repo" pattern.

### Task 2.1: Implement `stigmer system sync`

**Command**:
```bash
stigmer system sync [--force] [--dry-run]
```

**Behavior**:
1. Read embedded system pack
2. Compare with DB SYSTEM scope resources
3. Upsert new/changed resources (unless modified in DB)
4. Record "installed system pack version" in DB
5. `--dry-run`: Show diffs without applying
6. `--force`: Overwrite even if modified in DB

**Resolution Precedence** (documented):
```
Invocation overrides → Project → Org/Tenant → System (DB) → System (embedded)
```

**Deliverables**:
- [ ] `stigmer system sync` command
- [ ] Diff logic for comparing pack vs DB
- [ ] System pack version tracking
- [ ] `stigmer system status` to show current state

---

## Phase 3: Create Drafter Skills Using skill-creator-agent

> **Goal**: Use the bootstrapped system to create specialized drafter skills.
> **Rationale**: This validates the self-bootstrapping workflow.

### Task 3.1: Create agent-drafter Skill

**Invocation**:
```bash
stigmer invoke agent skill-creator-agent \
  --input "Create a skill for drafting Stigmer Agent YAML configurations" \
  --artifact schemas/agent.proto \
  --artifact examples/agent-examples.yaml \
  --output agent-drafter/
```

**Expected Output**: `agent-drafter/SKILL.md` with:
- Instructions for creating Agent YAML
- References to schema documentation
- Examples of valid outputs

**Lifecycle**:
1. Output saved as `status=DRAFT`
2. Run validation checks
3. Human review
4. Promote to `PUBLISHED`

**Deliverables**:
- [ ] Invoke skill-creator-agent with agent schema
- [ ] Review and refine generated skill
- [ ] Validate against SKILL.md format
- [ ] Publish agent-drafter skill

---

### Task 3.2: Create Remaining Drafter Skills

Repeat Task 3.1 for:

| Skill | Input Artifacts |
|-------|-----------------|
| `workflow-drafter` | `schemas/workflow.proto`, workflow examples |
| `skill-drafter` | SKILL.md format spec, skill examples |
| `mcpserver-drafter` | `schemas/mcpserver.proto`, mcpserver examples |

**Deliverables**:
- [ ] workflow-drafter skill (PUBLISHED)
- [ ] skill-drafter skill (PUBLISHED)
- [ ] mcpserver-drafter skill (PUBLISHED)

---

## Phase 4: Create Drafter Agents

> **Goal**: Create agents that use drafter skills for the draft commands.

### Task 4.1: Create Drafter Agents

**Agents to Create**:

| Agent | Skills (pinned versions) |
|-------|-------------------------|
| `agent-drafter-agent` | `agent-drafter@1.0.0`, `yaml-validator@1.0.0` |
| `workflow-drafter-agent` | `workflow-drafter@1.0.0`, `yaml-validator@1.0.0` |
| `skill-drafter-agent` | `skill-drafter@1.0.0`, `yaml-validator@1.0.0` |
| `mcpserver-drafter-agent` | `mcpserver-drafter@1.0.0`, `yaml-validator@1.0.0` |

**Key Design**: Pin exact skill versions for reproducibility.

**Deliverables**:
- [ ] agent-drafter-agent (PUBLISHED)
- [ ] workflow-drafter-agent (PUBLISHED)
- [ ] skill-drafter-agent (PUBLISHED)
- [ ] mcpserver-drafter-agent (PUBLISHED)

---

## Phase 5: Wire CLI Draft Commands

> **Goal**: Implement `stigmer draft <resource>` commands that invoke drafter agents.

### Task 5.1: Draft Command Infrastructure

**Command Structure**:
```bash
stigmer draft agent [--output FILE] [--no-save] [--non-interactive]
stigmer draft workflow [--output FILE] [--no-save]
stigmer draft skill [--output FILE] [--no-save]
stigmer draft mcpserver [--output FILE] [--no-save]
```

**Execution Flow**:
1. Create execution session
2. Resolve drafter agent (precedence: Project → Org → System)
3. Invoke agent with streaming Q&A
4. Run deterministic validators
5. Return final YAML
6. Optionally save as DRAFT resource

**Non-Interactive Mode** (CI/Automation):
```bash
stigmer draft agent --non-interactive --input spec.yaml --output agent.yaml --json-stream
```

**Deliverables**:
- [ ] `stigmer draft agent` command
- [ ] `stigmer draft workflow` command
- [ ] `stigmer draft skill` command
- [ ] `stigmer draft mcpserver` command
- [ ] Streaming output support
- [ ] Non-interactive mode with JSON event stream

---

## Phase 6: Skill Lifecycle & Eval Framework

> **Goal**: Implement skill states and evaluation for self-improvement.
> **Rationale**: Research emphasizes eval-driven improvement.

### Task 6.1: Skill Lifecycle States

**States**:
```
DRAFT → REVIEW_PENDING → PUBLISHED → DEPRECATED → REVOKED
```

**Automated Pre-Publish Checks**:
1. Format validation (required frontmatter: `name`, `description`)
2. Schema validation for outputs
3. Security scan (network access, dangerous commands)

**Deliverables**:
- [ ] Skill state transitions in API
- [ ] `stigmer skill publish` command
- [ ] `stigmer skill deprecate` command
- [ ] Automated validation checks

---

### Task 6.2: SkillEvalSuite Resource

**Schema**:
```yaml
apiVersion: stigmer.ai/v1
kind: SkillEvalSuite
metadata:
  name: agent-drafter-evals
spec:
  skill: agent-drafter
  tests:
    - name: basic-agent-creation
      prompt: "Create a simple agent that summarizes text"
      expected:
        tool_calls: [yaml-validator]
        output_matches_schema: agent.json
    - name: complex-agent
      prompt: "Create an agent with multiple skills and MCP servers"
      rubric:
        has_skills_field: true
        has_mcp_servers_field: true
```

**Deliverables**:
- [ ] SkillEvalSuite proto definition
- [ ] Eval runner implementation
- [ ] `stigmer skill eval` command
- [ ] Require eval pass before publish

---

## Phase 7: Security & Trust Boundaries

> **Goal**: Implement trust tiers and security controls.

### Task 7.1: Trust Tiers

**Tiers**:
| Tier | Description | Auto-Loadable |
|------|-------------|---------------|
| `SYSTEM_SIGNED` | Bundled, signed by org | Yes |
| `ORG_SIGNED` | Org-level, signed | Yes |
| `USER_LOCAL` | User-created | Yes (user scope) |
| `UNTRUSTED_IMPORTED` | External imports | No (quarantined) |

**Mandatory Review Triggers** (skills requiring human review):
- Ships scripts
- Requests network access
- Adds MCP servers/tools
- Modifies filesystem beyond workspace

**Deliverables**:
- [ ] Trust tier field in skill schema
- [ ] Review requirement logic
- [ ] `stigmer skill review` command

---

## Success Criteria

1. **Self-Bootstrapping Works**: skill-creator-agent can create new skills
2. **All 4 Draft Commands**: `stigmer draft agent|workflow|skill|mcpserver`
3. **Progressive Disclosure**: Skills loaded on-demand, not all upfront
4. **Versioned Packages**: Immutable skill versions with provenance
5. **Trust Boundaries**: DRAFT state, review gates, permission profiles
6. **Full Auditability**: Event traces for all executions
7. **Offline Bootstrap**: CLI works without DB using embedded pack

---

## Technical Debt Mitigations

| Risk | Mitigation |
|------|------------|
| Loading all skills into prompt | Progressive disclosure from day one (Task 0.2) |
| No provenance/reproducibility | Content-addressed storage, immutable versions (Task 0.1) |
| Auto-activating AI-generated skills | DRAFT state, quarantine, review gates (Task 6.1) |
| Mixing system/user scopes | Explicit scopes, precedence chain (Task 2.1) |
| Silent skill regressions | Eval suites required for publish (Task 6.2) |

---

## Recommended Implementation Order

| Order | Phase/Task | Rationale |
|-------|------------|-----------|
| 1 | **Phase 0.1**: Skill data model | Foundation for everything |
| 2 | **Phase 0.4**: Execution tracing | Needed for auditability |
| 3 | **Phase 0.2**: Progressive disclosure | Core runtime pattern |
| 4 | **Phase 0.3**: Permission profiles | Security foundation |
| 5 | **Phase 1**: System pack embedding | Offline bootstrap |
| 6 | **Phase 2**: `stigmer system sync` | DB bootstrap |
| 7 | **Phase 3**: Create drafter skills | Validates self-bootstrap |
| 8 | **Phase 4**: Create drafter agents | Agents use skills |
| 9 | **Phase 5**: Draft commands | User-facing feature |
| 10 | **Phase 6**: Lifecycle & evals | Self-improvement loop |
| 11 | **Phase 7**: Trust boundaries | Production hardening |

---

## Dependencies

- **Stigmer Cloud Backend**: Must support skill/execution storage
- **Agent Runtime**: Must support tool execution, streaming
- **CLI Infrastructure**: Cobra commands, streaming output

---

## References

- [Skill Format Integration Research Report](../research.skill-format-integration-strategy/04.report.gpt.md)
- [Anthropic Agent Skills](https://github.com/anthropics/skills)
- [OpenAI Codex Skills](https://developers.openai.com/codex/skills/)
- [Codex Non-Interactive Mode](https://developers.openai.com/codex/noninteractive/)
- [GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/use-copilot-cli)
