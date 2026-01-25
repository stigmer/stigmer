# Design Decision: ApiResourceReference Version Support

**Date**: 2026-01-25
**Status**: Approved
**Participants**: Developer, AI Assistant

## Context

`ApiResourceReference` is a common proto message used across Stigmer to reference other API resources (agents, skills, environments, etc.). With the introduction of versioned Skills, we need to add version support to this reference type.

## Current ApiResourceReference Structure

```protobuf
message ApiResourceReference {
  string kind = 1;      // "Skill", "Agent", etc.
  string name = 2;      // "acme/calculator"
  string namespace = 3; // Optional
  // ... other fields
}
```

## Decision: Add `version` Field

**Add an optional `version` field to `ApiResourceReference`**

```protobuf
message ApiResourceReference {
  string kind = 1;
  string name = 2;
  string namespace = 3;
  
  // Version of the resource (optional).
  // Supports three formats:
  // 1. Empty/unset → Resolves to "latest" (most recent version)
  // 2. Tag name → Resolves to version with this tag (e.g., "stable", "v1.0")
  // 3. Exact hash → Immutable reference to specific version (e.g., "abc123...")
  //
  // Default behavior: Empty means "latest" (current version in main table)
  //
  // Examples:
  // - version: ""        → Use latest version
  // - version: "latest"  → Use latest version (explicit)
  // - version: "stable"  → Use version tagged as "stable"
  // - version: "v1.0"    → Use version tagged as "v1.0"
  // - version: "abc123..." → Use exact version with this hash (immutable)
  string version = 4;
}
```

## Version Resolution Logic

```
ApiResourceReference resolution:
├─ version empty/unset → Use main table (latest)
├─ version == "latest" → Use main table (latest)
├─ version is tag → Check main, then audit (latest with this tag)
└─ version is hash → Check main, then audit (exact hash match)
```

## Default Behavior

**When version field is not specified:**
- Default to "latest" (current version)
- No breaking changes for existing usages
- Backward compatible with all existing ApiResourceReferences

**Implementation**:
```java
String effectiveVersion = reference.getVersion().isEmpty() 
    ? "latest" 
    : reference.getVersion();
```

## Use Cases

### Use Case 1: Always Use Latest (Mutable)
```yaml
agent:
  skills:
    - kind: Skill
      name: acme/calculator
      # version omitted → always uses latest
```

**Behavior**: Automatically picks up new versions when skill is updated

### Use Case 2: Pin to Stable Tag (Semi-Mutable)
```yaml
agent:
  skills:
    - kind: Skill
      name: acme/calculator
      version: stable  # Use whatever "stable" points to
```

**Behavior**: Uses "stable" tag, which can be updated by skill maintainer

### Use Case 3: Pin to Exact Version (Immutable)
```yaml
agent:
  skills:
    - kind: Skill
      name: acme/calculator
      version: abc123def456...  # Exact hash
```

**Behavior**: Always uses this specific version, never changes

## Impact on Other Resources

**Resources currently using ApiResourceReference**:
1. **Agent** → References Skills (primary use case)
2. **Workflow** → May reference Agents
3. **Environment** → May reference other resources

**Migration**: 
- All existing references work as-is (default to "latest")
- No breaking changes
- New version field is optional

## Validation Rules

```protobuf
message ApiResourceReference {
  string version = 4 [
    (buf.validate.field).string.pattern = "^$|^latest$|^[a-zA-Z0-9._-]+$|^[a-f0-9]{64}$"
  ];
  // Empty OR "latest" OR tag name OR SHA256 hash
}
```

**Valid versions**:
- Empty: `""` (defaults to latest)
- Explicit latest: `"latest"`
- Tag: `"stable"`, `"v1.0"`, `"beta-2"`
- Hash: `"abc123def456..."` (64 hex chars for SHA256)

**Invalid versions**:
- Special chars: `"v1.0!"`, `"stable@123"`
- Partial hashes: `"abc123"` (must be full 64 chars)

## Implementation Notes

### Backend Resolution
```java
public Skill resolveSkillReference(ApiResourceReference ref) {
    String version = ref.getVersion().isEmpty() ? "latest" : ref.getVersion();
    
    if (version.equals("latest")) {
        return skillRepo.findByName(ref.getName()); // Main table
    } else if (isHash(version)) {
        return skillRepo.findByHash(ref.getName(), version); // Main or audit
    } else {
        return skillRepo.findByTag(ref.getName(), version); // Main or audit
    }
}
```

### Agent Execution Flow
```
Agent has SkillAttachment: {name: "acme/calc", version: "stable"}
↓
Temporal Activity: ResolveSkillsActivity
↓
Resolve "stable" → Query DB → Get hash "abc123"
↓
Fetch SKILL.md content for prompt injection
↓
Download artifact from storage
↓
Mount at /bin/skills/acme_calc/
```

## Documentation Requirements

1. **User Docs**: Explain version field in ApiResourceReference
2. **Agent Docs**: Show how to reference skills with versions
3. **Migration Guide**: Explain default behavior (no changes needed)
4. **Best Practices**: 
   - Use latest for dev/staging
   - Use tags for production (stable, v1.0)
   - Use exact hash for critical deployments

## Future Considerations

**Other versioned resources**:
- If we version Agents, Workflows, etc., same pattern applies
- ApiResourceReference already prepared for it
- Just need to implement version resolution in respective handlers

**Version constraints** (future enhancement):
```protobuf
message ApiResourceReference {
  string version = 4;
  string version_constraint = 5; // e.g., ">=v1.0,<v2.0"
}
```

Not needed for initial implementation.

## References

- Skill Proto Structure: `design-decisions/01-skill-proto-structure.md`
- ADR Document: `/Users/suresh/scm/github.com/stigmer/stigmer/_cursor/adr-doc.md`
- ApiResourceReference Location: `apis/ai/stigmer/commons/apiresource/` (need to verify exact file)

---

**Status**: Ready for proto implementation
