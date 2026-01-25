# Conversation Summary: Skill API Enhancement Design Session

**Date**: 2026-01-25
**Participants**: Developer (Suresh), AI Assistant
**Duration**: ~1 hour
**Status**: Design complete, ready for implementation

## Overview

This document summarizes the design conversation that resulted in comprehensive architectural decisions for the Skill API Enhancement project. All decisions have been documented in detail in separate design decision documents.

## Project Goals

Enhance the existing Skill API with:
1. Proper proto definitions following Stigmer standards
2. Version support (tags and immutable hashes)
3. Unified backend for local daemon and cloud storage
4. Remove inline skill feature from agents
5. Add version field to ApiResourceReference
6. Complete documentation and examples

**Timeline**: 2 weeks (target: Feb 8, 2026)

## Major Topics Discussed

### 1. Proto Structure Refinement

**Initial Proposal**: Generic structure with `interface_definition` field
**Final Decision**: Kubernetes-aligned structure with clear Spec/Status separation

**Key Changes**:
- Field renamed: `interface_definition` → `skill_md` (clearer, more intuitive)
- Spec contains only user-provided fields: `skill_md`, `tag`
- Status contains only system-generated fields: `version_hash`, `artifact_storage_key`, `state`, `audit`
- Removed `tags` map - single optional `tag` in spec instead
- Removed separate `SkillVersion` message - status.audit provides timestamps

**Rationale**: Follow AgentExecution pattern, clear ownership boundaries

### 2. Audit Strategy Evolution

**Initial Proposal**: Single collection with version arrays
**Developer Feedback**: Need separate audit table with complete snapshots
**Final Decision**: Two-collection pattern (main + audit)

**Architecture**:
- **Main collection** (`skills`): Always current state, one record per skill
- **Audit collection** (`skill_audit`): Immutable snapshots of every modification
- Archive triggered on EVERY update to main collection
- Multiple audit records can have same tag (resolved by timestamp)

**Version Ordering**:
- Initial: Proposed separate `version_number` field
- Final: Use existing `status.audit.spec_audit.updated_at` timestamp
- Rationale: Reuse existing audit infrastructure, no redundancy

**Audit Framework**:
- Deferred to implementation phase
- Options: MongoDB Change Streams, Spring Data Event Listeners, Custom Interceptor
- Requirement: Automatic, transparent archival on every modification

### 3. Tag Strategy Clarification

**Confusion Point**: How tags work with multiple versions in audit
**Resolution**: Mutable tags with timestamp-based resolution

**Behavior**:
```
Push 1: tag "stable" → hash "abc123"
Push 2: tag "stable" → hash "xyz789" (archives v1)
Push 3: tag "stable" → hash "def456" (archives v2)

Result:
- Main table: tag "stable" → hash "def456"
- Audit: 2 records with tag "stable" (older versions)
- Query "stable": Return latest by timestamp
```

**Key Insight**: Tag can move forward, old versions preserved in audit with same tag

### 4. Content-Addressable Storage

**Question**: What if user pushes same content twice?
**Answer**: Same content = same hash = deduplication!

**Benefits**:
- No duplicate storage
- Integrity verification
- Immutability
- Cache-friendly

**Implementation**: Check if hash exists before upload, skip if exists

### 5. Field Location Decisions

**Where does version_hash belong?**
- **Considered**: Spec (derived from user content)
- **Decided**: Status (system-generated, observed state)
- **Rationale**: User doesn't specify hash, system calculates it

**Where does artifact_storage_key belong?**
- **Decided**: Status (system-determined storage location)
- **Rationale**: Configuration-dependent, can change with migrations

**Pattern**: If system generates/assigns it → Status. If user provides it → Spec.

### 6. ApiResourceReference Enhancement

**Added**: Optional `version` field
**Default**: Empty string means "latest"
**Formats Supported**:
- Empty/unset → Latest
- "latest" → Latest (explicit)
- Tag name → Resolve to version with this tag
- Exact hash → Immutable reference

**Validation**: Pattern for empty/"latest"/tag/hash formats

**Impact**: Backward compatible, no breaking changes

## Design Decision Documents Created

All decisions documented in detail:

1. **`01-skill-proto-structure.md`**
   - Complete proto structure (Spec vs Status)
   - Field naming rationale (`skill_md`)
   - Audit strategy (two-collection pattern)
   - Tag strategy (mutable tags)
   - Content-addressable storage
   - Version ordering (timestamps)
   - Resolution logic
   - MongoDB schema

2. **`02-api-resource-reference-versioning.md`**
   - Version field specification
   - Default behavior (empty = latest)
   - Resolution logic
   - Use cases and examples
   - Validation rules
   - Impact on other resources
   - Migration notes

## Key Takeaways for Implementation

### Proto Definition
```protobuf
message SkillSpec {
  string skill_md = 1;  // User provides
  string tag = 2;       // Optional, user chooses
}

message SkillStatus {
  ai.stigmer.commons.apiresource.ApiResourceAudit audit = 99;
  string version_hash = 1;        // System calculates
  string artifact_storage_key = 2; // System determines
  SkillState state = 3;            // System manages
}
```

### MongoDB Collections
```javascript
// Main: skills (current)
{metadata, spec, status}

// Audit: skill_audit (history)
{skill_id, archived_at, metadata, spec, status}
```

### Resolution Logic
```
Query skill with version:
1. Check main table first
2. If not found, query audit
3. Use timestamp ordering for tags
4. Exact match for hashes
```

### Archival Flow
```
On every skill update:
1. Snapshot current main record → audit
2. Apply changes to main record
3. Update timestamps in audit
```

## Questions Answered During Session

1. **Q**: How to name the content field?
   **A**: `skill_md` - clear, specific, intuitive

2. **Q**: Where do timestamps go?
   **A**: Existing `ApiResourceAudit` in status (field 99)

3. **Q**: How to handle multiple versions with same tag?
   **A**: Archive old versions, use timestamp ordering

4. **Q**: Where does version_hash belong?
   **A**: Status (system-generated, not user input)

5. **Q**: Same content pushed twice?
   **A**: Same hash, deduplication, skip re-upload

6. **Q**: Need separate version_number field?
   **A**: No, use existing `updated_at` timestamp

7. **Q**: Audit framework options?
   **A**: Evaluate during implementation (Change Streams preferred)

## References

- **ADR Document**: `/Users/suresh/scm/github.com/stigmer/stigmer/_cursor/adr-doc.md`
- **Proto Modeling Standards**: `@stigmer/apis/_rules/model-stigmer-oss-protos/`
- **AgentExecution Pattern**: `apis/ai/stigmer/agentic/agentexecution/v1/`
- **ApiResourceAudit**: `apis/ai/stigmer/commons/apiresource/status.proto`
- **Project Bootstrap**: `@start-stigmer-oss-new-project`

## Next Steps

**For new conversation context**:
1. Read all design decision documents
2. Review updated T01_0_plan.md
3. Start with T01.1: Proto API definitions
4. Reference design docs during implementation
5. Update checkpoints as tasks complete

## Project Status

✅ Requirements gathered
✅ Architecture designed
✅ Design decisions documented
✅ Task plan updated
⏳ Ready for implementation (new conversation)

---

**Note for AI assistants resuming this project**: Read this summary first to understand the complete design context, then review individual design decision documents for detailed specifications.
