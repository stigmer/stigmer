# .stigmerignore Design Notes

## Research Summary

### How Other Tools Handle Ignores

| Tool | File Name | Pattern Syntax | Git Integration | Negation Support |
|------|-----------|----------------|-----------------|------------------|
| **Git** | `.gitignore` | fnmatch + `**` | N/A | ✅ `!pattern` |
| **Docker** | `.dockerignore` | Go `filepath.Match` + `**` | None | ✅ `!pattern` |
| **npm** | `.npmignore` | gitignore-style | Falls back to `.gitignore` | ✅ `!pattern` |
| **Helm** | `.helmignore` | Go `filepath.Match` | None | ❌ |
| **Buf** | `buf.yaml` | Path lists in YAML | None | ❌ |

### Key Insights

1. **npm's approach is elegant**: If `.npmignore` exists, use it; otherwise fall back to `.gitignore`. This reduces cognitive overhead.

2. **Git's pattern syntax is the de facto standard**: Most developers already know gitignore syntax.

3. **Negation patterns are powerful**: They allow "exclude everything except X" workflows.

4. **Buf uses structured config**: More machine-readable but less intuitive for simple exclusions.

5. **Docker's `**` support is expected**: Developers expect recursive wildcards to work.

---

## Current Problem

The `shouldExclude` function in `skill.go` has **hardcoded patterns**:

```go
excludePatterns := []string{
    ".git/", "node_modules/", ".venv/", "__pycache__/",
    ".idea/", ".vscode/", ".DS_Store", "*.pyc", "*.log",
    ".env", ".env.local", ".env.*",
}
```

**Problems:**
1. Not configurable by users
2. No way to include files that match default excludes
3. No awareness of `.gitignore`
4. Duplicates what Git already knows to exclude
5. Hardcoded list will always be incomplete

---

## Architectural Decision Record

### ADR-001: Should `.stigmerignore` respect `.gitignore`?

**Context**: When pushing skills, should files already ignored by Git also be ignored by Stigmer?

**Decision**: **Yes, with layered override capability**

**Rationale**:
- If a file is in `.gitignore`, it's almost certainly not meant to be distributed
- `.gitignore` already contains carefully curated lists (node_modules, __pycache__, etc.)
- Reduces duplication - users don't need to maintain two identical ignore lists
- Follows npm's proven pattern

**Exception Mechanism**: `.stigmerignore` can explicitly include gitignored files using `!` negation patterns.

### ADR-002: Should we create a new file or use existing config?

**Decision**: **Create `.stigmerignore` file + support in `stigmer.yaml`**

**Rationale**:
- `.stigmerignore` is familiar (mirrors `.gitignore`, `.dockerignore`)
- File-based allows per-directory overrides (like Git)
- `stigmer.yaml` provides programmatic alternative for advanced users
- Both approaches can coexist (file takes precedence)

### ADR-003: Which pattern syntax to use?

**Decision**: **Full gitignore syntax via go-git library**

**Rationale**:
- `github.com/go-git/go-git/v5/plumbing/format/gitignore` is well-maintained
- Supports all gitignore features: `**`, `!`, trailing `/`, comments
- Developers already know this syntax
- Actively maintained (v5.16.4 released Nov 2025)

### ADR-004: Pattern resolution order (priority)

**Decision**: From lowest to highest priority:

1. **Built-in defaults** (always exclude `.git/`, sensitive files)
2. **`.gitignore`** patterns (if in git repo)
3. **`.stigmerignore`** at repo root
4. **`.stigmerignore`** in subdirectories (closer = higher priority)
5. **Command-line flags** (`--ignore`, `--include`)

**Rationale**:
- Mirrors Git's own resolution order
- Most specific rule wins
- CLI always wins for one-off overrides

---

## Proposed Design

### Package Structure

```
client-apps/cli/
├── pkg/
│   └── ignore/                    # Reusable ignore logic
│       ├── BUILD.bazel
│       ├── matcher.go             # Core pattern matching interface
│       ├── patterns.go            # Pattern parsing and validation
│       ├── gitignore.go           # .gitignore integration
│       ├── stigmerignore.go       # .stigmerignore loading
│       ├── defaults.go            # Built-in default patterns
│       └── matcher_test.go        # Comprehensive tests
└── internal/cli/artifact/
    └── skill.go                   # Uses pkg/ignore
```

### Core Interface

```go
// pkg/ignore/matcher.go

// Matcher determines if a path should be ignored during artifact creation.
// It supports layered ignore sources with proper precedence.
type Matcher interface {
    // ShouldIgnore returns true if the given path should be excluded.
    // path is relative to the artifact root directory.
    // isDir indicates if the path is a directory.
    ShouldIgnore(path string, isDir bool) bool
}

// MatcherOptions configures how the Matcher is built.
type MatcherOptions struct {
    // RootDir is the artifact root directory (where .stigmerignore is located)
    RootDir string
    
    // RespectGitignore enables .gitignore pattern loading (default: true)
    RespectGitignore bool
    
    // ExtraIgnore adds additional patterns to ignore (CLI --ignore flags)
    ExtraIgnore []string
    
    // ExtraInclude adds patterns to explicitly include (CLI --include flags)
    // Takes precedence over ignore patterns
    ExtraInclude []string
    
    // NoDefaults disables built-in default patterns (advanced use)
    NoDefaults bool
}

// NewMatcher creates a Matcher with the given options.
func NewMatcher(opts MatcherOptions) (Matcher, error)
```

### .stigmerignore File Format

```gitignore
# .stigmerignore - Controls which files are included in stigmer artifacts
#
# Syntax follows .gitignore conventions:
#   - Blank lines and lines starting with # are ignored
#   - Standard glob patterns work: *, ?, [abc]
#   - ** matches any number of directories
#   - ! negates a pattern (include a previously excluded file)
#   - Trailing / only matches directories

# Exclude test fixtures
tests/fixtures/

# Exclude documentation source (keep generated docs)
docs/src/
!docs/src/api.md

# Exclude development scripts
scripts/*.sh

# Include specific config that might be gitignored
!.env.example

# Language-specific (supplement defaults)
*.test.js
*.spec.ts
```

### Built-in Defaults

```go
// pkg/ignore/defaults.go

// DefaultPatterns returns patterns that should always be excluded.
// These are files that should never appear in distributed artifacts.
var DefaultPatterns = []string{
    // Version control
    ".git/",
    ".svn/",
    ".hg/",
    
    // IDE and editor
    ".idea/",
    ".vscode/",
    "*.swp",
    "*.swo",
    "*~",
    
    // OS files
    ".DS_Store",
    "Thumbs.db",
    "desktop.ini",
    
    // Security-sensitive (never distribute)
    ".env",
    ".env.*",
    "!.env.example",      // Allow .env.example
    "!.env.template",     // Allow .env.template
    "*.pem",
    "*.key",
    "*.p12",
    "*.keystore",
    ".secrets",
    "credentials.json",
    ".credentials/",
    
    // Build artifacts (large, reproducible)
    "node_modules/",
    "__pycache__/",
    "*.pyc",
    "*.pyo",
    ".pytest_cache/",
    ".venv/",
    "venv/",
    "dist/",
    "build/",
    "target/",
    "*.egg-info/",
}
```

### CLI Integration

```bash
# Push with default behavior (respects .gitignore + .stigmerignore)
stigmer skill push

# Ignore additional patterns
stigmer skill push --ignore "*.test.ts" --ignore "docs/"

# Include something that would normally be ignored
stigmer skill push --include ".env.example"

# Don't respect .gitignore (include all non-ignored files)
stigmer skill push --no-gitignore

# Dry run - show what would be included
stigmer skill push --dry-run
```

### Error Handling

```go
// Invalid patterns should produce clear errors
error: invalid pattern in .stigmerignore line 15: "[unclosed"
       patterns must follow gitignore syntax

// Warnings for patterns that match nothing (optional, behind flag)
warning: pattern "*.xyz" in .stigmerignore matches no files
```

---

## Implementation Plan

### Phase 1: Core Package (pkg/ignore)
1. Define `Matcher` interface
2. Implement default patterns
3. Implement `.stigmerignore` file parsing using go-git
4. Implement `.gitignore` integration
5. Implement pattern precedence resolution
6. Comprehensive unit tests

### Phase 2: CLI Integration
1. Update `createSkillZip` to use new Matcher
2. Add `--ignore`, `--include`, `--no-gitignore`, `--dry-run` flags
3. Remove hardcoded `shouldExclude` function
4. Update help text and documentation

### Phase 3: Advanced Features (Optional)
1. Per-directory `.stigmerignore` support (like Git)
2. `stigmer.yaml` ignore configuration
3. Verbose mode showing which files matched which patterns

---

## Test Strategy

### Unit Tests
- Pattern parsing correctness
- Gitignore syntax compliance
- Negation pattern handling
- Directory vs file matching
- Precedence resolution

### Integration Tests
- Push with various ignore configurations
- Git repo vs non-git repo behavior
- CLI flag combinations

### Edge Cases
- Empty `.stigmerignore`
- Invalid syntax handling
- Unicode filenames
- Deeply nested directories
- Symlinks (follow or ignore?)

---

## Security Considerations

1. **Default-deny sensitive files**: Credentials should never be included unless explicitly allowed
2. **Warning on sensitive patterns**: Warn if user tries to `--include` known credential patterns
3. **Audit logging**: Log what files are included for debugging

---

## Migration Path

1. **v1.0**: Implement with sensible defaults, backwards compatible
2. **Deprecation notice**: Log info message about new ignore system
3. **v1.1**: Remove hardcoded patterns, rely entirely on new system

---

## Open Questions

1. **Should we support `.stigmerignore` in subdirectories?**
   - Pro: Matches Git behavior exactly
   - Con: Added complexity, may not be needed initially
   - **Recommendation**: Start with root-only, add later if needed

2. **Should `stigmer.yaml` also support ignore patterns?**
   - Pro: Programmatic, can be generated
   - Con: Two places to configure same thing
   - **Recommendation**: Support both, file takes precedence

3. **Symlink handling?**
   - Git ignores symlinks by default
   - **Recommendation**: Skip symlinks in v1, document behavior

---

## Appendix: Library Evaluation

### go-git/go-git gitignore package
- **Pros**: Full gitignore spec, actively maintained, well-documented
- **Cons**: Depends on billy filesystem abstraction
- **Verdict**: ✅ Use this

### denormal/go-gitignore
- **Pros**: Standalone, simple API
- **Cons**: Last updated 2018, may have bugs
- **Verdict**: ❌ Too old

### Custom implementation
- **Pros**: No dependencies, full control
- **Cons**: Complex to get right, maintenance burden
- **Verdict**: ❌ Don't reinvent the wheel
