# .stigmerignore Design Notes

## Research Summary (Deep Dive - 2026-01-27)

### How Other Tools Handle Ignores

| Tool | File Name | Pattern Syntax | Where Filtered | Git Integration | Negation |
|------|-----------|----------------|----------------|-----------------|----------|
| **Git** | `.gitignore` | wildmatch (custom) | Client-side | N/A | ✅ `!pattern` |
| **Docker** | `.dockerignore` | Go `filepath.Match` + `**` | Client-side (CLI) | None | ✅ `!pattern` |
| **Buf** | `buf.yaml` excludes | Exact paths only | Client-side (CLI) | None | ❌ |
| **npm** | `.npmignore` | gitignore-style | Client-side | Falls back to `.gitignore` | ✅ `!pattern` |

### Critical Finding: All Use Client-Side Filtering

**Git**: `.gitignore` is evaluated locally during `git status`, `git add`, etc. The server never participates in ignore logic. Committed files remain tracked even if later added to `.gitignore`.

**Docker**: The CLI reads `.dockerignore` BEFORE creating the build context tar. Excluded files never reach the daemon. This is essential for remote daemon scenarios (reduces network transfer).

**Buf**: The CLI applies `excludes` during file discovery before uploading to BSR. The server receives already-filtered module content.

**Implication for Stigmer**: Follow the same pattern. CLI filters for local push. Backend filters for remote git push (since it fetches files).

---

### Git Implementation Details

**Pattern Matching Algorithm**: Git uses `wildmatch` (derived from rsync), NOT standard `fnmatch`. It's linear-time and avoids exponential behavior with complex patterns.

**Hierarchical Support**:
- Each directory can have its own `.gitignore`
- Patterns are relative to the `.gitignore` file's location
- Lower-level files override higher-level ones
- **Critical limitation**: If parent directory is ignored, nested `.gitignore` files are NOT consulted (performance optimization)

**Precedence Order** (highest to lowest):
1. Command-line patterns (`git add --force`)
2. `.gitignore` files (closer to file = higher priority)
3. `$GIT_DIR/info/exclude` (repo-specific, not committed)
4. `core.excludesFile` (global, typically `~/.config/git/ignore`)

**Pattern Processing**: Sequential, top-to-bottom. **Last matching pattern wins**.

**Negation Gotcha**: Cannot re-include a file if its parent directory is excluded. Git stops traversing ignored directories.

```gitignore
# This DOES NOT work:
aaafolder/
!aaafolder/important.txt  # Never evaluated - parent is ignored

# This DOES work:
aaafolder/*
!aaafolder/important.txt
```

**Performance**: Lazy evaluation - stops recursing into ignored directories. Uses untracked cache with mtime checks.

---

### Docker Implementation Details

**Key Difference from Git**: `*.txt` in `.dockerignore` matches root only. Use `**/*.txt` for recursive matching.

**Leading Slash**: Has NO special meaning in Docker (unlike shell globs). `/foo` and `foo` behave the same.

**Pattern Matching**: Uses Go's `filepath.Match` with added `**` support (via `moby/patternmatcher` library).

**Build Context Filtering**: Happens before tar creation. Excluded files never leave the client machine.

**Lesson Learned**: Documentation gaps around leading slash and recursive matching caused significant user confusion.

---

### Buf Implementation Details

**Different Philosophy**: No glob/wildcard support at all. Only exact paths.

**Rationale**: Prevents accidental exclusions; enforces explicit intent. Good for protobuf APIs where you want precision.

**Not Suitable for Stigmer**: Skills can have many file types; exact paths would be tedious.

---

### Key Insights

1. **Client-side filtering is the industry standard**: Reduces network transfer, enables local customization.

2. **Git syntax is the de facto standard**: Developers already know it - no learning curve.

3. **Negation is powerful but has gotchas**: Parent directory exclusion breaks child negation.

4. **npm's fallback pattern is elegant**: If `.npmignore` missing, use `.gitignore`. Reduces duplication.

5. **Shared library enables consistency**: Same logic in CLI and backend for remote git push.

---

## ADR-000: CLI vs Backend - Where Should Filtering Happen?

**Question**: Should ignore logic be in CLI (client-side) or Backend (server-side)?

**Decision**: **Both, via shared library**

**Rationale**:

Stigmer has two push modes:
1. **Local push**: Files are on user's machine → CLI must filter
2. **Remote git push**: Backend fetches from git → Backend must filter

```
┌─────────────────────────────────────────────────────────────────┐
│                      LOCAL PUSH FLOW                            │
│  User's Machine           Network              Backend          │
│  ┌─────────────┐         ┌─────┐         ┌──────────────────┐  │
│  │ Local Files │───▶ CLI │     │───▶     │ Store ZIP as-is  │  │
│  │             │  Filter │ ZIP │         │ (no filtering)   │  │
│  └─────────────┘   Here  └─────┘         └──────────────────┘  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    REMOTE GIT PUSH FLOW                         │
│  CLI                     Backend                                │
│  ┌─────────────┐   ┌─────────────────────────────────────────┐ │
│  │ git-url +   │──▶│ Git Clone → Filter Here → ZIP → Store  │ │
│  │ git-ref     │   │          (uses same library)            │ │
│  └─────────────┘   └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

**Why not backend-only?**
- Network overhead: Sending unfiltered files wastes bandwidth
- Privacy: Sensitive files (`.env`) leave user's machine
- Industry standard: Git, Docker, Buf all filter client-side

**Why not CLI-only?**
- Remote git push mode: Backend fetches files, CLI doesn't have them
- Backend needs filtering capability for this mode

**Solution**: Create `pkg/ignore` as a shared Go package that both CLI and backend can use.

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
   - **Recommendation**: Skip symlinks in v1, document behavior---## Appendix: Library Evaluation### go-git/go-git gitignore package
- **Pros**: Full gitignore spec, actively maintained, well-documented
- **Cons**: Depends on billy filesystem abstraction
- **Verdict**: ✅ Use this### denormal/go-gitignore
- **Pros**: Standalone, simple API
- **Cons**: Last updated 2018, may have bugs
- **Verdict**: ❌ Too old### Custom implementation
- **Pros**: No dependencies, full control
- **Cons**: Complex to get right, maintenance burden
- **Verdict**: ❌ Don't reinvent the wheel
