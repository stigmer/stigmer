# Task T01: Agent Skills Specification Alignment

**Created**: 2026-01-27
**Status**: PENDING REVIEW
**Type**: Refactoring / Feature Enhancement

⚠️ **This plan requires your review before execution**

## Objective

Align Stigmer's Agent Skills implementation with the official Agent Skills specification (agentskills.io) by:
1. Storing skill `description` extracted from SKILL.md frontmatter in the `SkillSpec` proto
2. Ensuring the implementation follows the spec's system prompt injection format

## Background

### Current Implementation Analysis

**What we have:**
- `SkillMetadata` struct in `skillmd.go` already parses `description` from YAML frontmatter ✅
- `SkillSpec` proto only has: `skill_md`, `tag`, `name`, `source` (no `description` field) ❌
- CLI extracts `name` from frontmatter → stores in `spec.name` ✅
- CLI extracts `description` from frontmatter → **NOT stored anywhere** ❌

**Agent Skills Specification (agentskills.io) Requirements:**
1. Parse frontmatter to get `name` and `description`
2. Inject skills into system prompt using XML format:
   ```xml
   <available_skills>
     <skill>
       <name>pdf-processing</name>
       <description>Extracts text and tables from PDF files...</description>
       <location>/path/to/skills/pdf-processing/SKILL.md</location>
     </skill>
   </available_skills>
   ```
3. Keep metadata concise (~50-100 tokens per skill in system prompt)

### Gap Analysis

| Requirement | Current State | Action Needed |
|-------------|--------------|---------------|
| Extract `name` from frontmatter | ✅ Done | None |
| Extract `description` from frontmatter | ✅ Parsed | Store in proto |
| Store `description` in spec | ❌ Missing | Add proto field |
| XML format for system prompt | ❓ Unknown | Verify/implement |

## Task Breakdown

### Phase 1: Proto Schema Update

**T01.1: Add description field to SkillSpec proto**
- [ ] Edit `apis/ai/stigmer/agentic/skill/v1/spec.proto`
- [ ] Add `string description = 5;` field to `SkillSpec` message
- [ ] Add appropriate documentation comments following existing patterns
- [ ] Run proto generation to create Go/Python stubs

**Files to modify:**
- `apis/ai/stigmer/agentic/skill/v1/spec.proto`

### Phase 2: CLI Update

**T01.2: Update CLI to populate description field**
- [ ] Modify `PushSkill()` in `client-apps/cli/internal/cli/artifact/skill.go`
- [ ] Extract description from `metadata.Description` (already parsed)
- [ ] Include description in the `PushSkillRequest` or returned `SkillSpec`

**Files to modify:**
- `client-apps/cli/internal/cli/artifact/skill.go`

### Phase 3: Backend Verification

**T01.3: Verify backend stores description correctly**
- [ ] Review skill controller push logic
- [ ] Ensure description flows through to stored skill spec
- [ ] Verify description is returned in skill queries

**Files to review:**
- `backend/services/stigmer-server/pkg/domain/skill/controller/push.go`

### Phase 4: System Prompt Integration (Analysis)

**T01.4: Document system prompt injection approach**
- [ ] Identify where skills are injected into agent prompts
- [ ] Verify XML format compliance with Agent Skills spec
- [ ] Document any gaps for future work

**Note:** System prompt generation may be handled differently in Stigmer. This task is to analyze and document, not necessarily implement changes.

## Success Criteria

- [ ] `SkillSpec` proto has `description` field
- [ ] CLI extracts and sends `description` to backend on push
- [ ] Backend stores and returns `description` in skill queries
- [ ] Proto stubs regenerated for Go and Python
- [ ] Documentation of system prompt injection approach

## Affected Files Summary

| File | Change Type |
|------|-------------|
| `apis/ai/stigmer/agentic/skill/v1/spec.proto` | Add field |
| `apis/stubs/go/ai/stigmer/agentic/skill/v1/spec.pb.go` | Regenerate |
| `apis/stubs/python/stigmer/ai/stigmer/agentic/skill/v1/spec_pb2.py` | Regenerate |
| `client-apps/cli/internal/cli/artifact/skill.go` | Update push logic |

## Risk Assessment

- **Low Risk**: Adding a new optional field is backward compatible
- **No Breaking Changes**: Existing skills without description will have empty string
- **Minimal Scope**: Changes are isolated to skill-related code

## Notes

- The `description` field should be optional (empty string if not provided in SKILL.md)
- Follow the existing pattern of `name` field which is similarly extracted from frontmatter
- The XML format for system prompts is a specification recommendation; actual implementation may vary based on Stigmer's agent architecture

## Review Process

**What happens next**:
1. **You review this plan** - Consider the approach and scope
2. **Provide feedback** - Share any concerns, suggestions, or changes
3. **I'll revise the plan** - Create an updated version incorporating your feedback
4. **You approve** - Give explicit approval to proceed
5. **Execution begins** - Implementation tracked in T01_3_execution.md

**Please consider**:
- Is the proto field placement correct (field number 5)?
- Should description have validation constraints (max length)?
- Are there other places where description should be surfaced?
- Any concerns about the phased approach?
