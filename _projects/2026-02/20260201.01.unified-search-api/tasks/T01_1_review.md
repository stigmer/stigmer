# Task T01: Review Feedback

**Date**: 2026-02-01
**Reviewer**: Developer

## Feedback on Open Questions

### 1. Description Field
**Decision**: Extract from `spec` per resource type.

- `Agent`: `spec.instructions` (first N chars) or dedicated `spec.description` if exists
- `Skill`: `spec.description` or content summary
- `McpServer`: `spec.description`
- `Workflow`: `spec.description`

Some resources may not have descriptions - that's acceptable. Field will be empty/omitted if not available.

### 2. Sort Order When No Query
**Decision**: `created_at DESC` (newer first)

This is the default sort order when no search query is provided (list mode).

### 3. Description Truncation
**Decision**: Not explicitly discussed. Will keep it simple - include if available from spec.

## Additional Notes

- Single RPC design approved
- `SearchResult` display attributes approach approved
- `exclude_public` (default false) approved
- Backend handler flow approved
- CLI command mapping approved
- 1-week timeline approved

## Status

Ready to create revised plan with incorporated feedback.
