# Task T01: Platform Capabilities Architecture & Implementation

**Created**: 2026-02-07
**Status**: PENDING REVIEW
**Type**: Feature Development
**Research**: [../research.platform-capabilities-draft-implementation/04.report.gpt.md](../../research.platform-capabilities-draft-implementation/04.report.gpt.md)

## Executive Summary

Implement a **hybrid capabilities bundle model** for AI-powered draft commands following industry best practices from GitHub Copilot CLI, OpenAI Codex, and Kiro CLI. The system embeds a baseline bundle in the CLI binary (`go:embed`) while allowing optional signed updates from a registry.

**Key Design Decisions (from research):**
1. **System scope separation**: Capabilities are NOT user-visible skills; they power draft commands internally
2. **Hybrid distribution**: Embedded baseline + optional registry updates
3. **Explicit update UX**: `stigmer capabilities update` (no auto-updates)
4. **Offline-first**: Works fully with embedded bundle; network is optional

---

## Phase 1: Foundation (Infrastructure)

### 1.1 Capabilities Bundle Schema Design
- [ ] Define `CapabilityBundle` type (separate from `SkillResource`)
- [ ] Create `manifest.yaml` schema with:
  - `bundleVersion` (semver)
  - `minCliVersion` / `maxCliVersion`
  - `capabilitySchemaVersion`
  - `capabilities[]` list with metadata
- [ ] Define capability structure (one folder per capability):
  ```
  capabilities/
  ├── manifest.yaml
  └── draft/
      ├── agent/
      │   ├── CAPABILITY.md      # Instructions/prompts
      │   └── examples/          # Example outputs
      ├── workflow/
      ├── skill/
      └── mcpserver/
  ```

### 1.2 Embedded Bundle Infrastructure
- [ ] Create `internal/capabilities/` package in CLI codebase
- [ ] Set up `//go:embed` for baseline bundle directory
- [ ] Implement `CapabilityLoader` interface:
  ```go
  type CapabilityLoader interface {
      LoadCapability(kind string) (*Capability, error)
      ListCapabilities() ([]*CapabilityMetadata, error)
      BundleVersion() string
  }
  ```
- [ ] Implement `embeddedLoader` for go:embed bundle
- [ ] Implement `cachedLoader` for local cache (XDG data dir)
- [ ] Implement `compositeLoader` with fallback chain: cache → embedded

### 1.3 Local Cache Infrastructure
- [ ] Define cache directory structure:
  ```
  $XDG_DATA_HOME/stigmer/capabilities/
  ├── bundles/
  │   └── v1.0.0/
  │       ├── manifest.yaml
  │       └── draft/...
  ├── current -> bundles/v1.0.0  (symlink)
  └── pinned.lock (optional)
  ```
- [ ] Implement cache manager with:
  - Atomic updates (download → verify → rename)
  - Version selection (highest compatible)
  - Pin/unpin support

---

## Phase 2: Capabilities Commands

### 2.1 Command Group Structure
- [ ] Create `cmd/stigmer/root/capabilities.go` parent command
- [ ] Implement subcommands:
  ```
  stigmer capabilities
  ├── status     # Show installed versions, compatibility
  ├── update     # Fetch and install latest compatible bundle
  ├── list       # List available capabilities (system-only)
  ├── pin        # Pin to specific version
  └── unpin      # Remove version pin
  ```

### 2.2 Status Command
- [ ] Display current bundle version (embedded vs cached)
- [ ] Show CLI compatibility range
- [ ] Check for available updates (optional, with --check flag)
- [ ] Show pinned version if any

### 2.3 Update Command
- [ ] Fetch manifest from registry (GitHub releases)
- [ ] Select highest compatible version
- [ ] Download bundle tarball
- [ ] Verify signature/checksum
- [ ] Install to cache atomically
- [ ] Provide `--offline` flag to disable network checks

### 2.4 List Command
- [ ] List capabilities in current bundle
- [ ] Show metadata: name, description, version
- [ ] Distinguish from `stigmer skill list` (user skills)

### 2.5 Pin/Unpin Commands
- [ ] Write/remove `pinned.lock` file
- [ ] Respect pin during `update`
- [ ] Show pin status in `status` output

---

## Phase 3: Draft Commands

### 3.1 Draft Command Infrastructure
- [ ] Create `internal/cli/draft/` package
- [ ] Implement `DraftEngine` that:
  - Loads capability for resource kind
  - Runs interactive Q&A flow
  - Generates valid YAML
  - Validates output against schema
  - Shows preview before writing

### 3.2 Agent Draft Command
- [ ] Add `stigmer draft agent` subcommand
- [ ] Load `draft/agent` capability
- [ ] Interactive prompts for agent configuration:
  - Name, description
  - Model selection
  - Tools/skills to include
  - System prompt
- [ ] Generate valid agent YAML
- [ ] Validate and offer to save

### 3.3 Workflow Draft Command
- [ ] Add `stigmer draft workflow` subcommand
- [ ] Load `draft/workflow` capability
- [ ] Interactive prompts for workflow configuration:
  - Name, description
  - Steps/agents to orchestrate
  - Input/output definitions
- [ ] Generate valid workflow YAML

### 3.4 Skill Draft Command
- [ ] Add `stigmer draft skill` subcommand
- [ ] Load `draft/skill` capability
- [ ] Interactive prompts for skill configuration:
  - Name, description
  - Tool definitions
  - Parameters
- [ ] Generate valid skill YAML

### 3.5 MCP Server Draft Command
- [ ] Add `stigmer draft mcpserver` subcommand
- [ ] Load `draft/mcpserver` capability
- [ ] Interactive prompts for MCP server configuration:
  - Name, transport type
  - Server command/URL
  - Environment variables
- [ ] Generate valid mcpserver YAML

---

## Phase 4: Authoring Capabilities Content

### 4.1 Create Baseline Bundle
- [ ] Author `CAPABILITY.md` for each draft type:
  - Agent drafting instructions/prompts
  - Workflow drafting instructions/prompts
  - Skill drafting instructions/prompts
  - MCP Server drafting instructions/prompts
- [ ] Include example outputs
- [ ] Create bundle manifest

### 4.2 Embed in CLI
- [ ] Place bundle in `internal/capabilities/baseline/`
- [ ] Wire `go:embed` directive
- [ ] Verify bundle loads correctly

---

## Phase 5: Registry Integration (Optional for MVP)

### 5.1 GitHub Releases Registry
- [ ] Define release asset naming convention
- [ ] Implement manifest fetching from releases
- [ ] Implement bundle download with progress
- [ ] Implement signature verification (cosign/GPG)

### 5.2 Enterprise/Offline Mode
- [ ] Add `--offline` global flag
- [ ] Add config option to disable network checks
- [ ] Support local mirror directories

---

## Phase 6: Testing & Documentation

### 6.1 Testing
- [ ] Unit tests for CapabilityLoader implementations
- [ ] Unit tests for cache manager
- [ ] Integration tests for draft commands
- [ ] Golden tests for YAML output

### 6.2 Documentation
- [ ] Update CLI help text
- [ ] Add examples to command descriptions
- [ ] Document capabilities architecture
- [ ] Document how to contribute capabilities

---

## Success Criteria

1. **All 4 draft commands working**: `stigmer draft agent|workflow|skill|mcpserver`
2. **Embedded baseline bundle**: ~100KB, works offline with zero config
3. **Capabilities commands functional**: `status`, `update`, `pin`, `list`
4. **System capabilities hidden**: Not visible in `stigmer skill list`
5. **Offline-first**: Full functionality without network access

---

## Risk Mitigations

| Risk | Mitigation |
|------|------------|
| Schema evolution breaks old bundles | Version schema explicitly; CLI supports N previous versions |
| Remote bundle tampering | Sign bundles; verify checksums; pin versions |
| Prompt injection from project context | Treat repo content as untrusted; validate/sanitize |
| Binary size bloat | Keep bundle ~100KB; test size impact |

---

## Dependencies

- **Phase 7 Search & Discovery** (parent project): Useful for resource discovery during drafting
- **Research completed**: [Platform Capabilities Research Report](../../research.platform-capabilities-draft-implementation/04.report.gpt.md)

---

## Recommended Implementation Order

1. **Phase 1.1-1.2**: Schema + embedded loader (foundation)
2. **Phase 4**: Author baseline capabilities (content)
3. **Phase 3.2**: Agent draft command (first draft command)
4. **Phase 2.1-2.2**: Capabilities status command
5. **Phase 3.3-3.5**: Remaining draft commands
6. **Phase 1.3 + 2.3**: Cache + update command
7. **Phase 5**: Registry integration (can defer to v2)
8. **Phase 6**: Testing + documentation

---

## Review Requested

**Please review this plan and provide feedback on:**

1. **Phasing**: Is the implementation order correct? Should we defer registry (Phase 5) to a later version?
2. **Scope**: Is MVP scope (embedded bundle + draft commands) appropriate? Or should we include update from registry in v1?
3. **Architecture**: Does the capability loader design align with your vision?
4. **Naming**: `stigmer capabilities` vs `stigmer platform` vs something else?
5. **Integration**: Any concerns about how this integrates with existing CLI structure?

**After your review, I'll:**
1. Capture your feedback in `T01_1_review.md`
2. Create a revised plan in `T01_2_revised_plan.md`
3. Begin execution after your approval
