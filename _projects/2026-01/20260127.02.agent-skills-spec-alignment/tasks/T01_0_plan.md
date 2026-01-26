# Task T01: Agent Skills Specification Alignment

**Created**: 2026-01-27
**Updated**: 2026-01-27 (Revised based on feedback)
**Status**: PENDING REVIEW
**Type**: Refactoring / Feature Enhancement

⚠️ **This plan requires your review before execution**

## Objective

Align Stigmer's Agent Skills implementation with the official Agent Skills specification (agentskills.io) by:
1. Moving SKILL.md YAML frontmatter parsing to the backend (single source of truth)
2. Storing skill `name` and `description` extracted by backend in `SkillSpec` proto
3. Simplifying the API by removing redundant fields from `PushSkillRequest`

## Design Decision (Based on Feedback)

**Principle**: Backend is the authoritative parser of SKILL.md content.

**Rationale**:
- Backend already extracts SKILL.md content from the artifact ZIP
- Parsing YAML frontmatter should happen in the same place (backend)
- CLI should only **validate** format (for fast user feedback), not extract fields for API
- This avoids duplication of parsing logic across CLI, SDKs, and other clients
- Single source of truth ensures consistency

## Architecture

### Current Flow (Redundant)
```
CLI: Parse SKILL.md → Extract name/description → Send in PushSkillRequest
Backend: Extract SKILL.md → Store raw content → Use name/description from request
```

### Revised Flow (Clean)
```
CLI: Validate SKILL.md format → Create ZIP → Send artifact only
Backend: Extract SKILL.md → Parse YAML frontmatter → Store name/description/content
```

## Background

### Current Implementation Analysis

**What we have:**
- `SkillMetadata` struct in `skillmd.go` parses `name` and `description` from YAML frontmatter
- `PushSkillRequest` has `name` and `description` fields (CLI sends these)
- Backend's `ExtractSkillMd` extracts raw SKILL.md content but doesn't parse frontmatter
- Backend stores `req.Name` and `req.Description` from the request

**What's wrong:**
- Parsing logic is duplicated (CLI parses, backend could parse)
- `name` and `description` in `PushSkillRequest` are redundant (they're in SKILL.md)
- If parsing logic changes, must update CLI, SDK, and any other client

**Agent Skills Specification (agentskills.io) Requirements:**
1. Parse frontmatter to get `name` and `description`
2. Inject skills into system prompt using XML format
3. Keep metadata concise (~50-100 tokens per skill in system prompt)

## Task Breakdown

### Phase 1: Proto Schema Cleanup

**T01.1: Clean up PushSkillRequest proto**
- [ ] Remove `name` field from `PushSkillRequest` in `io.proto`
- [ ] Remove `description` field from `PushSkillRequest` in `io.proto`
- [ ] Keep `description` field in `SkillSpec` (added earlier, still needed for storage)
- [ ] Run proto generation to create Go/Python stubs

**Files to modify:**
- `apis/ai/stigmer/agentic/skill/v1/io.proto`

**Note**: The `name` field was added in a previous project. We're removing it as part of this architectural cleanup.

### Phase 2: Backend YAML Frontmatter Parsing (Go - OSS)

**T01.2: Add frontmatter parsing to Go backend**
- [ ] Create/update YAML frontmatter parser in `backend/services/stigmer-server/pkg/domain/skill/storage/`
- [ ] Update `ExtractSkillMdResult` struct to include `Name` and `Description` fields
- [ ] Modify `ExtractSkillMd` to parse YAML frontmatter from SKILL.md content
- [ ] Update `PopulateSkillFieldsStep` to use extracted name/description instead of request fields
- [ ] Add validation: return error if `name` is missing from frontmatter
- [ ] Add tests for frontmatter parsing

**Files to modify:**
- `backend/services/stigmer-server/pkg/domain/skill/storage/zip_extractor.go`
- `backend/services/stigmer-server/pkg/domain/skill/controller/push.go`
- Add tests in `storage/` and `controller/`

### Phase 3: Backend YAML Frontmatter Parsing (Java - Cloud)

**T01.3: Add frontmatter parsing to Java backend**
- [ ] Identify equivalent skill push handler in stigmer-cloud Java backend
- [ ] Add YAML frontmatter parsing logic
- [ ] Extract `name` and `description` from SKILL.md content
- [ ] Store in SkillSpec (or equivalent Java model)
- [ ] Add validation and tests

**Files to modify:**
- `stigmer-cloud/backend/...` (Java skill controller/service)

### Phase 4: CLI Update

**T01.4: Update CLI to validate-only (no extraction in request)**
- [ ] Keep `ParseSkillMetadata` for local validation (good error messages)
- [ ] Remove `Name` and `Description` from `PushSkillRequest` construction
- [ ] CLI validates format, backend extracts and stores

**Files to modify:**
- `client-apps/cli/internal/cli/artifact/skill.go` (remove name/description from request)

### Phase 5: System Prompt Integration (Analysis)

**T01.5: Document system prompt injection approach**
- [ ] Identify where skills are injected into agent prompts
- [ ] Verify XML format compliance with Agent Skills spec
- [ ] Document any gaps for future work

## Success Criteria

- [ ] `PushSkillRequest` no longer has `name` or `description` fields
- [ ] `SkillSpec` has `description` field (storage)
- [ ] Go backend parses YAML frontmatter and extracts name/description
- [ ] Java backend parses YAML frontmatter and extracts name/description
- [ ] CLI validates SKILL.md format but doesn't send name/description in request
- [ ] Proto stubs regenerated for Go and Python
- [ ] Tests for frontmatter parsing in both backends

## Affected Files Summary

| File | Change Type | Repo |
|------|-------------|------|
| `apis/ai/stigmer/agentic/skill/v1/io.proto` | Remove fields | stigmer |
| `apis/ai/stigmer/agentic/skill/v1/spec.proto` | Keep description | stigmer |
| `apis/stubs/go/.../io.pb.go` | Regenerate | stigmer |
| `apis/stubs/python/.../io_pb2.py` | Regenerate | stigmer |
| `backend/.../skill/storage/zip_extractor.go` | Add frontmatter parsing | stigmer |
| `backend/.../skill/controller/push.go` | Use extracted values | stigmer |
| `client-apps/cli/.../skill.go` | Remove fields from request | stigmer |
| `stigmer-cloud/backend/.../skill/...` | Add frontmatter parsing | stigmer-cloud |

## Risk Assessment

- **Medium Risk**: Removing `name` from `PushSkillRequest` is a breaking change
  - Mitigation: Coordinate release, update CLI before removing field
- **Low Risk**: Adding backend parsing is additive
- **Scope Increase**: Now involves both Go and Java backends

## Migration Strategy

Since removing `name` from `PushSkillRequest` is breaking:

1. **Phase A**: Add backend parsing (keep request field temporarily)
2. **Phase B**: Update CLI to stop sending name/description
3. **Phase C**: Remove fields from proto (breaking change)

Or alternatively: Make this a single coordinated release if all components deploy together.

## Notes

- The `name` field in `PushSkillRequest` was added previously, not in this project
- Both OSS (Go) and Cloud (Java) backends need the frontmatter parsing
- CLI's `ParseSkillMetadata` provides good validation error messages and should be kept
- The XML format for system prompts is a specification recommendation

## Review Process

**What happens next**:
1. **You review this plan** - Consider the approach and scope
2. **Provide feedback** - Share any concerns, suggestions, or changes
3. **I'll revise the plan** - Create an updated version incorporating your feedback
4. **You approve** - Give explicit approval to proceed
5. **Execution begins** - Implementation tracked in T01_3_execution.md

**Please consider**:
- Is the migration strategy appropriate (phased vs coordinated release)?
- Are there other clients (besides CLI) that use `PushSkillRequest`?
- Should we deprecate the fields first before removing?
- Any concerns about the expanded scope (Java backend)?
