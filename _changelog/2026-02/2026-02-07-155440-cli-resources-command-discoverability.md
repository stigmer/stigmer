# CLI Resources Command: Discoverability for Verb-First Architecture

**Date**: February 7, 2026

## Summary

Implemented the `stigmer resources` command to provide CLI discoverability, enabling users to explore available resource types, their aliases, and supported verbs. This command completes the verb-first architecture by giving users a clear way to discover what operations they can perform on which resource types.

## Problem Statement

After migrating to a pure verb-first CLI architecture (T03-T04), users needed a way to discover:
- What resource types are available
- Which verbs (operations) each type supports
- What aliases can be used for convenience
- How to use different command combinations

Without this, users would need to rely on `--help` text or documentation to understand the CLI capabilities.

### Pain Points

- No central place to see all available resource types
- Unclear which verbs work with which resource types
- Aliases were hidden in individual command help text
- Difficult to filter and view only relevant information
- No programmatic way to query CLI capabilities

## Solution

Created a unified `stigmer resources` command that:

1. **Lists all resource types** with their supported verbs and aliases
2. **Supports filtering** by verb to show only relevant types
3. **Provides multiple output formats** (table, JSON, YAML) for both human and programmatic use
4. **Is fully registry-driven** - no hardcoded lists, scales automatically as new types are added
5. **Follows CLI patterns** established by kubectl (`kubectl api-resources`)

## Implementation Details

### Core Components

**1. resources.go Command (225 lines)**
- Clean separation: collect → filter → display
- Three display functions for different formats
- Verb filtering with helpful error messages
- Registry-driven data source

**2. Type Registry Enhancements**
Added to `types/verb.go`:
- `VerbFromString(string) (Verb, error)` - Parse verb names
- `AllVerbNames() []string` - List all available verbs

**3. Output Formats**

**Table (default):**
```
TYPE        ALIASES           VERBS
agent       agents, agt       apply, validate, get, list, delete, run, search
workflow    wfl, workflows    apply, validate, get, list, delete, run, search
skill       skills, skl       get, list, delete, push
mcpserver   mcp, mcpservers   apply, validate, get, list, delete
project     prj, projects     apply, validate, get, list, delete
```

**JSON/YAML:**
Full structured output with all metadata for programmatic consumption

### Key Design Decisions

1. **Command naming**: `resources` (kubectl-aligned, domain-appropriate)
2. **Verb terminology**: Kept "verbs" following kubectl and CLI design standards
3. **Alias display strategy**: Show only useful aliases in table (ID prefix + plural) but include all in JSON/YAML
4. **Filtering**: `--verb` flag enables focused discovery
5. **Registry-driven**: Zero hardcoded lists - automatically adapts as types are added

### File Structure

| File | Action | Lines |
|------|--------|-------|
| `cmd/stigmer/root/resources.go` | Created | 225 |
| `internal/cli/types/verb.go` | Modified | +36 |
| `cmd/stigmer/root.go` | Modified | +3 |
| `cmd/stigmer/root/BUILD.bazel` | Modified | +2 |

## Benefits

### For Users
- **Instant discovery** - See all capabilities at a glance
- **Reduced friction** - No need to search documentation
- **Contextual filtering** - Find types supporting specific verbs
- **Scriptable** - JSON/YAML output for automation

### For Developers
- **Self-documenting** - CLI advertises its own capabilities
- **Scales automatically** - New types appear without code changes
- **Consistent patterns** - Follows kubectl conventions

### For Platform
- **Professional UX** - Matches world-class CLIs
- **Reduced support burden** - Users can self-discover features
- **Integration-friendly** - Programmatic output for tooling

## Impact

### User Experience
- Developers can now explore the CLI without external documentation
- Clear understanding of verb-resource combinations
- Reduced learning curve for new users

### Developer Experience
- Adding new resource types automatically updates resources command
- No manual maintenance of resource lists
- Consistent with kubectl mental model

### Code Quality
- **Single Responsibility** - Each function < 50 lines
- **No duplication** - Registry is single source of truth
- **Clean separation** - Collect/filter/display pipeline
- **Well-tested** - All output formats verified

## Related Work

This command builds on the foundation laid in previous tasks:
- **T02**: Type Registry - provides the data source
- **T03**: Core Verbs - defines the operations
- **T04**: Specialized Verbs - completes the verb matrix

Together, these form a complete, discoverable, verb-first CLI architecture.

## Usage Examples

```bash
# List all resources
$ stigmer resources

# Find types that support running
$ stigmer resources --verb run

# Get structured output for tooling
$ stigmer resources --output json
```

---

**Status**: ✅ Production Ready
**Timeline**: T05 - Part of CLI Commands Completion project
**Commit**: 8e1eb6f6 - feat(cli): add resources command for CLI discoverability
