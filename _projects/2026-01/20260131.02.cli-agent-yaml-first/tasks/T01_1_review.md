# Task T01: Developer Review Feedback

**Reviewed**: 2026-02-01
**Reviewer**: Suresh
**Status**: FEEDBACK PROVIDED → PLAN REVISED

---

## Feedback Summary

### 1. Command Naming: "create" doesn't convey agentic nature

**Issue**: `stigmer skill create` uses CRUD terminology for what is actually a collaborative drafting session.

**Resolution**: Use `draft` as the verb.
- Accurately describes output as a starting point
- Implies collaboration and refinement
- Domain-honest: agents draft, humans approve

### 2. Search Functionality Required

**Issue**: Plan lacked search capabilities.

**Resolution**: Add two distinct operations:
- **Per-resource search**: `stigmer <resource> search <query>` - typed search within aggregate
- **Cross-cutting discovery**: `stigmer discover <query>` - exploratory search across all types

**Note**: Backend `Search` RPC needs implementation for each resource.

### 3. Template Cleanup Required

**Issue**: Existing template-based scaffolding (`stigmer new`, SDK templates) should be removed when agentic drafting lands.

**Resolution**: Add explicit cleanup tasks:
- Remove `sdk/go/templates/` directory
- Remove `stigmer new` command
- Document migration path

### 4. Platform Capabilities Should Be Embedded

**Issue**: Foundation skills (skill-drafter, agent-drafter, etc.) need deployment strategy.

**Decision**: Embed in CLI binary using `go:embed`.

**Rationale**:
- Skill size is negligible (~100KB total)
- Offline functionality required
- Zero first-use friction
- Version compatibility guaranteed
- Simpler architecture (no fetch/cache logic)

**Architecture**:
- Platform capabilities are NOT user skills
- Not visible in `stigmer skill list`
- Embedded in `cli/embedded/capabilities/`
- Versioned with CLI releases

---

## Domain Analysis Corrections

### Platform Capabilities vs User Skills

**Distinction established**:

| Category | Description | Location | Visibility |
|----------|-------------|----------|------------|
| Platform Capabilities | Core drafting functions | Embedded in CLI | Not in skill list |
| User Skills | Domain knowledge artifacts | Registry (remote) | In skill list |

### Ubiquitous Language Updates

| Old Term | New Term | Reason |
|----------|----------|--------|
| `create` | `draft` | Reflects collaborative authoring |
| Root `search` | `discover` | Different semantic (exploratory vs typed) |

---

## Approval

- [x] Feedback provided
- [x] Domain analysis completed
- [x] Revised plan created (T01_2_revised_plan.md)
- [ ] Developer approval for execution
