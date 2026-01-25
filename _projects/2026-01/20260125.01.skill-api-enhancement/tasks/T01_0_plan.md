# Task T01: Skill API Enhancement - Implementation Plan

**Created**: 2026-01-25
**Status**: PENDING REVIEW
**Timeline**: 2 weeks (Target: Feb 8, 2026)

⚠️ **This plan requires your review before execution**

## Executive Summary

Implement a comprehensive Skill API following the ADR architecture document, supporting both local daemon and cloud deployments. This enhancement includes:

1. **Proto API** - Complete Skill resource with 5-file pattern
2. **Versioning** - Add version field to ApiResourceReference (defaults to "latest")
3. **CLI Intelligence** - Enhance `stigmer apply` to detect SKILL.md and auto-upload skills
4. **Backend Unification** - Single backend supporting both local file storage and CloudFlare buckets
5. **Agent Cleanup** - Remove inline skill feature
6. **Documentation** - Complete examples and migration guide

## Architecture Reference

Based on ADR document decisions:
- **Empty Desk Model**: Agents spawn in `/workspace` sandbox
- **Skill Storage**: MongoDB (metadata + SKILL.md text) + S3/MinIO (immutable Zip artifacts)
- **Versioning**: Tag-based (`latest`, `v1.0`) with SHA256 hash immutability
- **Runtime**: Skills mounted at `/bin/skills/` (read-only, added to $PATH)

## Task Breakdown

### T01.1 - Proto API Definitions (Days 1-2)

**Objective**: Create complete Skill API resource following Stigmer proto standards

#### Subtasks:

1. **Create Skill Resource Proto (5-file pattern)**
   - [ ] `apis/ai/stigmer/agentic/skill/v1/api.proto`
     - Main `Skill` resource message
     - `SkillList` message
     - Structure: api_version, kind, metadata, spec, status
   - [ ] `apis/ai/stigmer/agentic/skill/v1/spec.proto`
     - `SkillSpec` message with:
       - `skill_md` (string) - SKILL.md content for prompt injection
       - `tag` (string, optional) - User-provided tag (e.g., "stable", "v1.0")
     - `SkillState` enum (UNSPECIFIED, UPLOADING, READY, FAILED)
   - [ ] `apis/ai/stigmer/agentic/skill/v1/command.proto`
     - `SkillCommandController` service
     - RPCs: `create`, `update`, `delete`, `push` (upload artifact)
   - [ ] `apis/ai/stigmer/agentic/skill/v1/query.proto`
     - `SkillQueryController` service
     - RPCs: `get`, `findAll`, `getByTag`, `getByHash`
   - [ ] `apis/ai/stigmer/agentic/skill/v1/io.proto`
     - All request/response messages
     - `PushSkillRequest` (includes Zip artifact stream)
     - `PushSkillResponse` (returns version hash)
   - [ ] `SkillStatus` structure (in api.proto):
     - `audit` (ApiResourceAudit at field 99)
     - `version_hash` (SHA256 of Zip, system-generated)
     - `artifact_storage_key` (storage location, system-generated)
     - `state` (SkillState enum)

2. **Add FGA Authorization Configuration**
   - [ ] Configure resource_kind for Skill
   - [ ] Set permissions: `can_view`, `can_edit`, `can_delete`, `can_create`
   - [ ] Configure field_path for each RPC
   - [ ] Skip authorization for `findAll` (IAM Policy query in handler)

3. **Register Skill in ApiResourceKind enum**
   - [ ] Add `SKILL` to `apis/ai/stigmer/commons/apiresource/enums.proto`

4. **Enhance ApiResourceReference for Version Support**
   - [ ] Add `version` field to `ApiResourceReference` proto (optional string)
   - [ ] Default to "latest" when not specified (empty string = latest)
   - [ ] Support three formats: empty (latest), tag name, exact hash
   - [ ] Document versioning strategy (tags vs exact hashes)
   - [ ] Update all existing references to support optional version
   - [ ] See: `design-decisions/02-api-resource-reference-versioning.md`

5. **Validation Rules**
   - [ ] Add buf.validate constraints:
     - `name`: required, pattern (namespace/name)
     - `version_hash`: sha256 format (64 hex chars)
     - `skill_md`: required, min_len = 1
     - `tag`: optional, pattern (alphanumeric + dots/dashes)
   - [ ] ApiResourceReference.version: pattern for empty/"latest"/tag/hash

**Success Criteria**:
- ✅ All 5 proto files created and follow standards
- ✅ FGA authorization configured for all RPCs
- ✅ Skill registered in ApiResourceKind enum
- ✅ ApiResourceReference supports version field
- ✅ buf.validate constraints in place
- ✅ Proto follows Spec/Status separation (user intent vs system state)
- ✅ Proto generation succeeds (`make build-protos`)

**Dependencies**: 
- ADR document
- Proto modeling standards
- Design decisions: `design-decisions/01-skill-proto-structure.md`

---

### T01.2 - CLI Enhancement (Days 3-4)

**Objective**: Make `stigmer apply` intelligent about SKILL.md detection and upload

#### Subtasks:

1. **Enhance stigmer apply Command**
   - [ ] Check for `SKILL.md` in current directory
   - [ ] If found (and no `stigmer.yml`): Enter **Artifact Mode**
   - [ ] If `stigmer.yml` found: Enter **Infrastructure Mode** (existing behavior)

2. **Implement Artifact Mode Logic**
   - [ ] Zip current directory (recursive, exclude `.git`, `node_modules`)
   - [ ] Calculate SHA256 hash of Zip
   - [ ] Extract skill name from SKILL.md metadata (or prompt user)
   - [ ] Call backend `PushSkill` RPC with:
     - Zip artifact stream
     - SKILL.md content
     - Tag (default: "latest")

3. **Add Skill-Specific CLI Commands**
   - [ ] `stigmer skill list` - List all skills
   - [ ] `stigmer skill get <name>` - Get skill details
   - [ ] `stigmer skill versions <name>` - List skill versions/tags
   - [ ] `stigmer skill delete <name>` - Delete skill (requires confirmation)

4. **Progress Indicators**
   - [ ] Show progress during Zip creation
   - [ ] Display upload progress
   - [ ] Show success message with version hash

**Success Criteria**:
- ✅ `stigmer apply` detects SKILL.md automatically
- ✅ Artifact Mode zips and uploads skill correctly
- ✅ SHA256 hash calculated properly
- ✅ New skill commands work end-to-end
- ✅ Error handling for network issues, invalid SKILL.md, etc.

**Dependencies**: T01.1 (proto definitions)

---

### T01.3 - Backend Implementation (Days 5-8)

**Objective**: Implement unified backend supporting both local file storage and cloud bucket

#### Subtasks:

1. **Create Skill Command Handler (Java)**
   - [ ] Implement `SkillCommandHandler` class
   - [ ] `create()` method: 
     - Validate skill structure
     - Store metadata in MongoDB
     - Return Skill resource
   - [ ] `push()` method:
     - Stream Zip artifact
     - Extract SKILL.md from Zip (in-memory)
     - Calculate SHA256 hash
     - Store artifact (local or cloud based on config)
     - Update MongoDB with hash and metadata
     - Update tag pointer (e.g., "latest" → new hash)
   - [ ] `update()` method: Update skill metadata only
   - [ ] `delete()` method: Remove from MongoDB (keep artifacts for immutability)

2. **Create Skill Query Handler (Java)**
   - [ ] Implement `SkillQueryHandler` class
   - [ ] `get()` method: Fetch by ID from MongoDB
   - [ ] `findAll()` method: IAM Policy query for authorized skills
   - [ ] `getByTag()` method: Resolve tag to hash, return skill
   - [ ] `getByHash()` method: Fetch specific version

3. **Storage Abstraction Layer**
   - [ ] Create `SkillArtifactStorage` interface with:
     - `uploadArtifact(hash, zipStream)` → storage key
     - `downloadArtifact(storageKey)` → zipStream
     - `artifactExists(hash)` → boolean
   - [ ] Implement `LocalFileStorage`:
     - Store in `~/.stigmer/storage/skills/`
     - Path: `<hash>.zip`
   - [ ] Implement `CloudBucketStorage`:
     - Upload to CloudFlare R2 bucket
     - Path: `skills/<namespace>_<name>_<hash>.zip`
   - [ ] Configuration-driven storage selection (env var or config file)

4. **MongoDB Schema Design**
   - [ ] **Main collection**: `skills` (always current state)
     ```json
     {
       "_id": "uuid",
       "metadata": { "name": "acme/calculator", ... },
       "spec": {
         "skill_md": "... SKILL.md content ...",
         "tag": "stable"  // Optional, user-provided
       },
       "status": {
         "version_hash": "abc123...",
         "artifact_storage_key": "skills/acme_calculator_abc123.zip",
         "state": "READY",
         "audit": {
           "spec_audit": {
             "created_at": "...",
             "updated_at": "..."  // Use for version ordering
           },
           "status_audit": {...}
         }
       }
     }
     ```
   - [ ] **Audit collection**: `skill_audit` (immutable history)
     - Complete snapshot of every modification
     - Same structure as main table + `skill_id` and `archived_at`
     - Multiple versions can have same tag (ordered by timestamp)
     - Index on: `skill_id`, `archived_at`, `spec.tag`, `status.version_hash`
   - [ ] **Archival trigger**: Every update to `skills` collection
     - Snapshot current state before modification
     - Use existing `ApiResourceAudit` timestamps (no version_number field)
   - [ ] **Audit framework**: Evaluate options during implementation
     - MongoDB Change Streams
     - Spring Data Event Listeners
     - Custom interceptor
   - [ ] See: `design-decisions/01-skill-proto-structure.md` for complete logic

5. **FGA Integration**
   - [ ] Implement authorization checks in handlers
   - [ ] For `findAll`: Use `listAuthorizedResourceIds` pattern
   - [ ] For create: Check organization membership + permissions
   - [ ] For update/delete: Check resource-level permissions

**Success Criteria**:
- ✅ Skill artifacts upload to local storage correctly
- ✅ Skill artifacts upload to cloud bucket correctly
- ✅ MongoDB stores metadata and SKILL.md content
- ✅ Tag resolution works (latest → hash)
- ✅ FGA authorization enforced
- ✅ Storage abstraction allows easy switching

**Dependencies**: T01.1 (proto definitions), T01.2 (CLI commands)

---

### T01.4 - Agent Integration & Inline Skill Removal (Days 9-10)

**Objective**: Integrate versioned skills into agent execution and remove inline skill feature

#### Subtasks:

1. **Remove Inline Skill Feature**
   - [ ] Find all references to inline skill in agent code
   - [ ] Remove inline skill configuration from Agent proto
   - [ ] Remove inline skill handling from agent runner
   - [ ] Clean up any inline skill-related tests

2. **Update Agent Proto with SkillAttachment**
   - [ ] Verify `Agent` proto has `repeated SkillAttachment skills` field
   - [ ] Ensure SkillAttachment includes version support:
     ```protobuf
     message SkillAttachment {
       string skill_name = 1;
       oneof selector {
         string tag = 2;        // "latest", "v1.0"
         string exact_hash = 3;  // "abc123" (immutable)
       }
       string version = 4; // Defaults to "latest" if not specified
     }
     ```

3. **Temporal Workflow Integration**
   - [ ] Create `ResolveSkillsActivity`:
     - Input: Agent config with SkillAttachments
     - Resolve tags to specific hashes
     - Fetch `interface_definition` from MongoDB for each skill
     - Return resolved skill metadata
   - [ ] Update `ProvisionSandboxActivity`:
     - Call Daytona with skill mount instructions
     - Mount skills at `/bin/skills/<namespace>_<name>/`
     - Ensure read-only mount

4. **Agent Runtime Changes**
   - [ ] Update sandbox setup to mount skills
   - [ ] For **Cloud Mode**: 
     - Download skill Zips from CloudFlare bucket
     - Extract to `/bin/skills/`
   - [ ] For **Local Mode**:
     - Copy from `~/.stigmer/storage/skills/`
     - Extract to `/bin/skills/`
   - [ ] Add skill location to $PATH

5. **Prompt Engineering Updates**
   - [ ] Construct system prompt with skill definitions:
     ```
     ### SKILL: Calculator
     LOCATION: /bin/skills/acme_calculator/
     
     (Content of SKILL.md from interface_definition...)
     ```
   - [ ] Remove any inline skill content injection
   - [ ] Ensure prompt includes location headers for each skill

**Success Criteria**:
- ✅ Inline skill feature completely removed
- ✅ Agent uses SkillAttachment with version support
- ✅ Skills resolve correctly (tags → hashes)
- ✅ Skills mount at `/bin/skills/` in sandbox
- ✅ System prompt includes skill definitions with locations
- ✅ Both local and cloud modes work

**Dependencies**: T01.1 (proto), T01.3 (backend storage)

---

### T01.5 - Testing & Validation (Day 11)

**Objective**: Comprehensive testing of all components

#### Subtasks:

1. **CLI Testing**
   - [ ] Test `stigmer apply` with SKILL.md detection
   - [ ] Test skill upload (local and cloud)
   - [ ] Test skill listing and retrieval
   - [ ] Test error scenarios (invalid SKILL.md, network failures)

2. **Backend Testing**
   - [ ] Unit tests for handlers
   - [ ] Test storage abstraction (both local and cloud)
   - [ ] Test tag resolution logic
   - [ ] Test FGA authorization (authorized/unauthorized cases)

3. **Integration Testing**
   - [ ] End-to-end: CLI → Backend → Storage
   - [ ] End-to-end: Agent execution with versioned skills
   - [ ] Test version pinning (tag vs exact hash)
   - [ ] Test skill updates and tag updates

4. **Agent Execution Testing**
   - [ ] Create test agent with multiple skills
   - [ ] Verify skills mount correctly
   - [ ] Test agent can invoke skill tools
   - [ ] Verify prompt includes skill definitions

**Success Criteria**:
- ✅ All tests pass
- ✅ No regressions in existing functionality
- ✅ Both local and cloud modes validated
- ✅ Error handling robust

**Dependencies**: T01.1-T01.4 (all components)

---

### T01.6 - Documentation & Examples (Day 12)

**Objective**: Complete documentation for developers and users

#### Subtasks:

1. **Developer Documentation**
   - [ ] Update proto API documentation
   - [ ] Document storage abstraction layer
   - [ ] Document FGA authorization model for skills
   - [ ] Add backend implementation guide

2. **User Documentation**
   - [ ] Create skill authoring guide (SKILL.md format)
   - [ ] Document `stigmer apply` behavior with skills
   - [ ] Create skill versioning guide (tags vs hashes)
   - [ ] Document ApiResourceReference version field usage

3. **Examples**
   - [ ] Create example skill: "simple-calculator"
     - Complete SKILL.md
     - Implementation files
     - stigmer.yml for infrastructure mode
   - [ ] Create example agent using versioned skills
   - [ ] Create example showing version pinning

4. **Migration Guide**
   - [ ] Document inline skill removal (no migration needed, clean slate)
   - [ ] Guide for converting old skills to new format

5. **ADR Update**
   - [ ] Update architecture document with implementation details
   - [ ] Document any design decisions made during implementation

**Success Criteria**:
- ✅ Complete developer documentation
- ✅ User-friendly skill authoring guide
- ✅ Working examples provided
- ✅ Migration guide clear

**Dependencies**: T01.1-T01.5 (all features complete)

---

### T01.7 - Final Review & Polish (Days 13-14)

**Objective**: Code review, cleanup, and deployment preparation

#### Subtasks:

1. **Code Review**
   - [ ] Self-review all proto definitions
   - [ ] Review CLI implementation
   - [ ] Review backend handlers
   - [ ] Check for code duplication or optimization opportunities

2. **Cleanup**
   - [ ] Remove dead code from inline skill removal
   - [ ] Ensure consistent error messages
   - [ ] Add logging where appropriate
   - [ ] Update all imports and dependencies

3. **Linting & Formatting**
   - [ ] Run proto linters
   - [ ] Format Go code (`gofmt`)
   - [ ] Format Java code (project standards)
   - [ ] Check for any linter errors

4. **Deployment Preparation**
   - [ ] Update deployment configs for local mode
   - [ ] Update deployment configs for cloud mode
   - [ ] Verify environment variables documented
   - [ ] Test deployment scripts

**Success Criteria**:
- ✅ Code passes all reviews
- ✅ No linter errors
- ✅ Clean commit history
- ✅ Ready for production deployment

---

## Key Design Decisions

### 1. Proto Structure: Spec vs Status
- **Spec (User Intent)**: `skill_md` (content), `tag` (optional)
- **Status (System State)**: `version_hash`, `artifact_storage_key`, `state`, `audit`
- Follows Kubernetes pattern: User owns spec, system owns status
- See: `design-decisions/01-skill-proto-structure.md`

### 2. Field Naming
- **`skill_md`** chosen over `interface_definition` or `content`
- Clear, specific, format-explicit
- Intuitive in conversation and code

### 3. Audit Strategy: Two-Collection Pattern
- **Main table** (`skills`): Always current state, one record per skill
- **Audit table** (`skill_audit`): Complete history, immutable snapshots
- Archive triggered on EVERY modification
- Use `audit.spec_audit.updated_at` for version ordering (no version_number field)
- Multiple audit records can have same tag (resolved by timestamp)

### 4. Tag Strategy: Mutable Tags
- Tags are mutable pointers (like Docker tags)
- Tag can move to new versions (old versions archived)
- Query resolution: Latest version with requested tag
- Immutability available: Use exact hash for pinning

### 5. Content-Addressable Storage
- SHA256 hash from Zip content
- Same content = same hash = single storage copy
- Deduplication: Skip re-upload if hash exists
- Integrity: Hash verifies content not corrupted

### 6. Skill Naming Convention
- Format: `namespace/name` (e.g., "acme/calculator")
- Namespace prevents conflicts
- Aligns with container registry patterns

### 7. Version Resolution Strategy
```
User specifies version in ApiResourceReference:
├─ Empty/unset → Resolve to "latest" (main table)
├─ "latest" → Resolve to main table (current version)
├─ "stable" (tag) → Check main, then audit (latest with this tag)
└─ "abc123..." (hash) → Check main, then audit (exact match)
```

### 8. Storage Path Patterns
- **Local**: `~/.stigmer/storage/skills/<hash>.zip`
- **Cloud**: `skills/<namespace>_<name>_<hash>.zip`

### 9. Skill Mount Location
- Runtime path: `/bin/skills/<namespace>_<name>/`
- Added to $PATH automatically
- Read-only mount for security

### 10. Backend Unification
- Single codebase, configuration-driven storage
- Environment variable: `STIGMER_STORAGE_MODE=local|cloud`
- Abstraction layer allows easy extension (Azure, GCS, etc.)

## Risk Mitigation

| Risk | Mitigation Strategy |
|------|---------------------|
| Proto breaking changes | ApiResourceReference is widely used - ensure backward compatibility during version field addition |
| Large Zip uploads | Implement streaming upload, add size limits, show progress |
| Storage failures | Retry logic, clear error messages, transaction handling |
| Tag conflicts | Implement tag locking during updates |
| Skill naming conflicts | Namespace enforcement, clear error messages |
| Agent execution failures | Extensive testing, fallback to previous version |

## Success Criteria (Overall Project)

1. ✅ **Proto API Complete**
   - 5-file pattern followed
   - FGA authorization configured
   - ApiResourceReference has version field
   - All validation rules in place

2. ✅ **CLI Functionality**
   - `stigmer apply` detects SKILL.md
   - Skill upload works (local + cloud)
   - Skill management commands functional

3. ✅ **Backend Implementation**
   - Storage abstraction supports local + cloud
   - MongoDB schema implemented
   - FGA integration complete
   - Tag resolution working

4. ✅ **Agent Integration**
   - Inline skill feature removed
   - Versioned skills work in agent execution
   - Skills mount correctly in sandbox
   - Prompt engineering updated

5. ✅ **Quality & Documentation**
   - All tests passing
   - Complete documentation
   - Working examples
   - Deployment ready

## Timeline Summary

- **Week 1** (Days 1-7): Proto API, CLI, Backend core
- **Week 2** (Days 8-14): Agent integration, testing, documentation, polish

## Review Questions for You

Please consider:

1. **Proto Structure**: Does the Skill resource structure align with your vision? Any fields missing?

2. **Versioning Strategy**: Is the tag-based versioning with immutable hashes the right approach?

3. **CLI Behavior**: Should `stigmer apply` auto-detect SKILL.md, or should there be a separate `stigmer skill push` command?

4. **Storage Configuration**: Is environment variable-based storage selection sufficient, or should it be in a config file?

5. **Agent Changes**: Any specific concerns about removing inline skill feature?

6. **Priorities**: Should any task be moved earlier or later in the timeline?

7. **Scope**: Is anything missing from the plan, or anything that should be deferred?

## Design Decisions Documented

All architectural decisions from our discussion have been documented in:
- `design-decisions/01-skill-proto-structure.md` - Proto structure, audit strategy, content-addressable storage
- `design-decisions/02-api-resource-reference-versioning.md` - Version field, resolution logic, default behavior

**Key decisions captured**:
✅ Proto structure: Spec (user) vs Status (system) separation
✅ Field naming: `skill_md` for SKILL.md content
✅ Audit pattern: Two-collection strategy with timestamp-based ordering
✅ Tag strategy: Mutable tags with archived history
✅ Content-addressable storage: Same content = same hash
✅ Version resolution: Empty/latest/tag/hash support in ApiResourceReference
✅ No version_number field: Use existing `audit.spec_audit.updated_at`
✅ Audit framework: Evaluate during implementation (Change Streams vs Event Listeners)

**Next Steps (In New Conversation)**:
1. Review design decisions documents
2. Create T01_3_execution.md tracking implementation progress
3. Begin with T01.1 (Proto API definitions)
4. Update checkpoints as we complete each major task

**Status**: Ready for implementation with complete design documentation 🎯
