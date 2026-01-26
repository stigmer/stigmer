---
name: Go Backend Skill Source Metadata
overview: Add skill source metadata persistence to the Go backend (stigmer OSS) to match the Java backend (stigmer-cloud), ensuring the `name` and `source` fields from PushSkillRequest are properly copied to SkillSpec.
todos:
  - id: update-populate-step
    content: Add name and source field copying to PopulateSkillFieldsStep.Execute() in push.go
    status: completed
  - id: verify-build
    content: Run bazel build to verify the change compiles correctly
    status: completed
isProject: false
---

# Go Backend Skill Source Metadata Persistence

## Context

The skill source metadata feature was completed in the Java backend (stigmer-cloud) in session 2 of project 20260127.01. The Java `SkillPushHandler.java` now persists:

- `name` from request to `SkillSpec.name`
- `source` from request to `SkillSpec.source`

The Go backend in stigmer OSS is missing this functionality, creating an inconsistency between the two backends.

## Current State Analysis

**Proto definitions**: Already complete with `name` (field 3) and `source` (field 4) in `SkillSpec`

- [apis/ai/stigmer/agentic/skill/v1/spec.proto](apis/ai/stigmer/agentic/skill/v1/spec.proto)

**Go stubs**: Already generated with proper fields

- `SkillSpec.Name` (string)
- `SkillSpec.Source` (*SkillSource)

**Gap**: The Go backend `PopulateSkillFieldsStep` in [backend/services/stigmer-server/pkg/domain/skill/controller/push.go](backend/services/stigmer-server/pkg/domain/skill/controller/push.go) does not copy these fields from the request to the spec.

## Implementation

### File to Modify

[`backend/services/stigmer-server/pkg/domain/skill/controller/push.go`](backend/services/stigmer-server/pkg/domain/skill/controller/push.go)

### Change Location

`PopulateSkillFieldsStep.Execute()` (lines 430-473)

### Current Code (line 437)

```go
// 1. Populate spec with extracted SKILL.md content
skill.Spec.SkillMd = extractResult.Content
```

### Required Addition (after line 437)

```go
// 2. Set skill name from request (extracted from SKILL.md YAML frontmatter)
req := ctx.Input()
if req.Name != "" {
    skill.Spec.Name = req.Name
}

// 3. Set source metadata for traceability (local git or remote git)
if req.Source != nil {
    skill.Spec.Source = req.Source
}
```

## Java Backend Reference

The Java implementation in `SkillPushHandler.java` (lines 309-316):

```java
// Set skill name from request (extracted from SKILL.md YAML frontmatter)
if (!request.getName().isEmpty()) {
    specBuilder.setName(request.getName());
}
// Set source metadata for traceability (local git or remote git)
if (request.hasSource()) {
    specBuilder.setSource(request.getSource());
}
```

## Data Flow

```
CLI (skill push) → PushSkillRequest → Go Backend → SkillSpec → SQLite
                         ↓
                    name: from YAML frontmatter
                    source: LocalSource (git detected) or GitSource (remote push)
```

## Verification

After implementation, the stored `Skill` resource should contain:

- `spec.name`: The kebab-case skill name from SKILL.md frontmatter
- `spec.source`: Either `LocalSource` (with git metadata if in a repo) or `GitSource` (for remote pushes)

## Quality Considerations

- **Minimal change**: Only 9 lines of code in a single file
- **Pattern matching**: Follows exact same pattern as Java backend
- **No new dependencies**: Uses existing proto types already imported
- **Backward compatible**: Fields are optional; old artifacts without source continue to work
- **Idiomatic Go**: Uses nil check for pointer types, empty string check for strings