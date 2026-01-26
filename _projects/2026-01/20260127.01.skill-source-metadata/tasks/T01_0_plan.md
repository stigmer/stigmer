# Task T01: Proto Design and Implementation

**Created**: 2026-01-27
**Status**: PENDING REVIEW
**Type**: Feature Development

⚠️ **This plan requires your review before execution**

## Objective

Design and implement proto messages for skill source metadata, following the buf input pattern, and update push request to require skill name from SKILL.md YAML.

## Background

Currently:
- **Skill name** comes from folder name (`filepath.Base(opts.Directory)`) - see `artifact/skill.go:73`
- **No source metadata** is captured or stored
- Buf uses a flexible input model: `directory`, `git_repo` with `tag` and `subdir`

We need:
1. Skill name from SKILL.md YAML frontmatter (required)
2. Source metadata (git repo info or local filesystem)
3. Support for remote GitHub repo push (URL + tag/commit + subdir)

## Technical Design

### Proto Changes (spec.proto, io.proto)

#### 1. SkillSource Message (new)
Similar to buf's input concept:

```protobuf
// SkillSource identifies where the skill artifacts originated from.
// This provides traceability and enables features like "push from GitHub".
message SkillSource {
  oneof source {
    // Local directory push - git info auto-detected
    LocalSource local = 1;
    // Remote git repository push
    GitSource git = 2;
  }
}

// LocalSource represents a skill pushed from a local directory.
message LocalSource {
  // Git remote URL if the directory is a git repo (auto-detected)
  // Empty if not a git repository
  string git_remote_url = 1;
  
  // Git commit SHA at time of push (auto-detected)
  // Empty if not a git repository
  string git_commit = 2;
  
  // Sub-directory within the repo (relative path from repo root)
  // Empty if pushed from repo root
  string subdir = 3;
  
  // Whether the directory was a git repository
  bool is_git_repo = 4;
}

// GitSource represents a skill pushed from a remote git repository.
// Similar to buf's git_repo input.
message GitSource {
  // Git repository URL (required)
  // Example: "https://github.com/stigmer/skills.git"
  string url = 1;
  
  // Git reference - tag, branch, or commit SHA (required)
  // Examples: "v1.0.0", "main", "abc123def456..."
  string ref = 2;
  
  // Sub-directory within the repo containing SKILL.md
  // Example: "skills/calculator"
  string subdir = 3;
}
```

#### 2. Update SkillSpec (spec.proto)
```protobuf
message SkillSpec {
  // Skill name extracted from SKILL.md YAML frontmatter (required)
  // This is the canonical name, not the folder name
  string name = 3;
  
  // SKILL.md content (existing field)
  string skill_md = 1;
  
  // Version tag (existing field)
  string tag = 2;
  
  // Source information for traceability
  SkillSource source = 4;
}
```

#### 3. Update PushSkillRequest (io.proto)
The `name` field stays but validation changes - must match YAML name:
```protobuf
message PushSkillRequest {
  // Skill name - must match name in SKILL.md YAML frontmatter
  string name = 1;
  
  // ... existing fields ...
  
  // Source information (optional but recommended)
  SkillSource source = 6;
}
```

### SKILL.md YAML Format

Expected frontmatter format:
```yaml
---
name: calculator
version: 1.0.0
description: A calculator skill for mathematical operations
---

# Calculator Skill
...
```

The CLI will:
1. Parse SKILL.md to extract YAML frontmatter
2. Extract `name` field (required, fail if missing)
3. Use this name for the push request

### Implementation Phases

#### Phase 1: Proto Design (T01)
- [ ] Add `SkillSource`, `LocalSource`, `GitSource` messages to spec.proto
- [ ] Add `name` and `source` fields to `SkillSpec`
- [ ] Add `source` field to `PushSkillRequest`
- [ ] Run buf generate to update stubs
- [ ] Review generated Go/Java/Python stubs

#### Phase 2: CLI - YAML Parsing (T02)
- [ ] Implement YAML frontmatter parser for SKILL.md
- [ ] Extract skill name from YAML (fail if missing)
- [ ] Update `artifact/skill.go` to use YAML name instead of folder name
- [ ] Add validation: name in request must match YAML name

#### Phase 3: CLI - Git Detection (T03)
- [ ] Implement git info detection (remote URL, commit SHA)
- [ ] Detect if directory is a git repo
- [ ] Calculate subdir relative to repo root
- [ ] Populate `LocalSource` in push request

#### Phase 4: CLI - Remote GitHub Push (T04)
- [ ] Add new flags: `--git-url`, `--git-ref`, `--subdir`
- [ ] Implement remote repo cloning/fetching
- [ ] Extract SKILL.md and artifacts from remote
- [ ] Populate `GitSource` in push request

#### Phase 5: Backend - Store Source (T05)
- [ ] Update skill handler to store source metadata
- [ ] Persist source in skill status/state
- [ ] Return source info in responses

## Task Breakdown (Detailed)

### T01: Proto Design (Current - 2-3 hours)

1. **Create proto messages**
   - [ ] Add messages to `apis/ai/stigmer/agentic/skill/v1/spec.proto`
   - [ ] Update `PushSkillRequest` in `io.proto`
   - [ ] Add field numbers carefully (backward compat)

2. **Generate stubs**
   - [ ] Run buf generate
   - [ ] Verify Go stubs compile
   - [ ] Verify Java stubs compile

3. **Document decisions**
   - [ ] Why oneof for source (extensibility)
   - [ ] Why name in spec vs just request

### T02: CLI YAML Parsing (3-4 hours)

1. **Add YAML parser**
   - [ ] Use `gopkg.in/yaml.v3` or similar
   - [ ] Parse frontmatter between `---` markers
   - [ ] Handle missing frontmatter gracefully with clear error

2. **Update skill push flow**
   - [ ] Read SKILL.md content
   - [ ] Extract name from frontmatter
   - [ ] Fail with helpful error if name missing
   - [ ] Use extracted name in push request

### T03: CLI Git Detection (2-3 hours)

1. **Git info detection**
   - [ ] Check if `.git` directory exists
   - [ ] Get remote URL: `git remote get-url origin`
   - [ ] Get current commit: `git rev-parse HEAD`
   - [ ] Calculate subdir from repo root

2. **Populate LocalSource**
   - [ ] Set `is_git_repo` flag
   - [ ] Populate git fields if available
   - [ ] Handle non-git directories gracefully

### T04: Remote GitHub Push (4-6 hours)

1. **New CLI flags**
   - [ ] `--git-url` for remote repo URL
   - [ ] `--git-ref` for tag/branch/commit
   - [ ] `--subdir` for subdirectory path

2. **Remote fetch logic**
   - [ ] Clone/fetch repo to temp directory
   - [ ] Checkout specified ref
   - [ ] Locate SKILL.md in subdir
   - [ ] Create artifact from subdir

### T05: Backend Storage (2-3 hours)

1. **Update skill handler**
   - [ ] Accept source in push request
   - [ ] Store in skill record

2. **Return source in responses**
   - [ ] Include source in skill status
   - [ ] Add to get/list responses

## Success Criteria for T01

- [x] Proto messages designed (see above)
- [ ] Proto changes implemented in spec.proto and io.proto
- [ ] Stubs generated successfully
- [ ] Go/Java compilation passes
- [ ] Ready for T02 (CLI YAML parsing)

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Proto backward compat | High | Use new field numbers, optional fields |
| YAML parsing edge cases | Medium | Clear error messages, validate format |
| Git detection failures | Low | Graceful fallback to non-git mode |
| Remote clone performance | Medium | Consider sparse checkout, depth=1 |

## Next Task Preview

**T02: CLI YAML Parsing** - Implement YAML frontmatter parsing to extract skill name from SKILL.md.

---

## Review Process

**Please consider**:
1. Does the proto design look correct? (SkillSource with oneof)
2. Should `name` be required in SKILL.md YAML, or have fallback?
3. For remote push, do we need `--git-ref` or can we default to HEAD/main?
4. Any other source types to consider? (tar.gz URL, etc.)
5. Should we store source in `SkillSpec` or `SkillStatus`?

**Awaiting your review before proceeding with implementation.**
