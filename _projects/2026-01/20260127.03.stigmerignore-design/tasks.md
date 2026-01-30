# Tasks: 20260127.03.stigmerignore-design

**Created**: 2026-01-27

## How to Use This File

Update task status as you progress:
- **⏸️ TODO** - Not started yet
- **🚧 IN PROGRESS** - Currently working on this
- **✅ DONE** - Completed

Add timestamps and notes to track your progress.

---

## Task 1: Research and architectural design

**Status**: ✅ DONE
**Created**: 2026-01-27 00:27
**Completed**: 2026-01-27

### Subtasks
- [x] Research Git .gitignore implementation (wildmatch algorithm, hierarchical support, precedence rules)
- [x] Research Docker .dockerignore implementation (client-side filtering, pattern matching)
- [x] Research Buf buf.yaml excludes (exact paths only, no globs)
- [x] Analyze current Stigmer CLI skill push implementation (`shouldExclude` in skill.go)
- [x] Analyze backend skill processing (stores ZIP as-is, only extracts SKILL.md)
- [x] Document architectural decisions (ADR-001 through ADR-004)
- [x] Design package structure and core API
- [x] Select library: `go-git/go-git/v5/plumbing/format/gitignore`

### Key Decisions Made
1. **Client-side filtering** (industry standard - Git, Docker, Buf all do this)
2. **Shared library in `pkg/ignore`** for both CLI and backend (remote git push)
3. **Respect .gitignore** with higher priority `.stigmerignore` for overrides
4. **Git-compatible syntax** using go-git library
5. **Built-in defaults** for security (never distribute .env, *.pem, etc.)

---

## Task 2: Implement ignore package in pkg/

**Status**: ✅ DONE
**Created**: 2026-01-27 00:27
**Completed**: 2026-01-30

### Package Location
`client-apps/cli/pkg/ignore/`

### Subtasks
- [x] Create package structure with BUILD.bazel
- [x] Implement `defaults.go` with built-in patterns (60+ security-first patterns)
- [x] Implement `pattern.go` for path conversion and parsing helpers
- [x] Implement `source.go` for .gitignore, .stigmerignore, and CLI pattern loading
- [x] Implement `result.go` with MatchResult and Reason types for diagnostics
- [x] Implement `matcher.go` with main Matcher type, New(), Match(), MatchWithReason()
- [x] Implement precedence resolution: defaults < .gitignore < .stigmerignore < CLI
- [x] Add lenient pattern parsing (invalid patterns skipped, not errors)
- [x] Write comprehensive unit tests in `matcher_test.go` (30+ test cases)
- [x] All tests passing with zero linter errors

### Core Interface
```go
type Matcher struct { ... }

type Options struct {
    RespectGitignore  bool     // Load .gitignore patterns (default: true)
    StigmerignoreFile string   // Path to .stigmerignore (optional)
    IncludeDefaults   bool     // Include built-in patterns (default: true)
}

func NewMatcher(rootDir string, opts Options) (*Matcher, error)
func (m *Matcher) Match(path string, isDir bool) bool
func (m *Matcher) ShouldInclude(path string, isDir bool) bool
```

### Files to Create
- `pkg/ignore/BUILD.bazel`
- `pkg/ignore/ignore.go` (main API)
- `pkg/ignore/defaults.go` (built-in patterns)
- `pkg/ignore/parser.go` (file parsing)
- `pkg/ignore/ignore_test.go` (tests)
- `pkg/ignore/doc.go` (package documentation)

### Notes
- Use `github.com/go-git/go-git/v5/plumbing/format/gitignore` for pattern matching
- Add to go.mod dependencies

---

## Task 3: Integrate with skill push

**Status**: ✅ DONE
**Created**: 2026-01-27 00:27
**Completed**: 2026-01-30 (Session 3)

### Files to Modify
- `client-apps/cli/internal/cli/artifact/skill.go`
- `client-apps/cli/cmd/stigmer/root/skill.go`
- `client-apps/cli/internal/cli/artifact/BUILD.bazel`

### Subtasks
- [x] Import `pkg/ignore` in skill.go
- [x] Modify `createSkillZip()` to create Matcher with options
- [x] Replace `shouldExclude()` calls with `matcher.Match()` calls
- [x] Handle directory-level filtering (skip entire directories that match)
- [x] Add `--dry-run` enhancement to show ignored files
- [x] Remove hardcoded `shouldExclude()` function (fully replaced)
- [x] Add CLI flags (--ignore, --include, --no-gitignore, --verbose)
- [x] Wire options through option structs
- [x] Add statistics and dry-run analysis
- [x] All tests passing

### Code Changes
```go
// BEFORE (hardcoded)
if shouldExclude(relPath) {
    return nil
}

// AFTER (configurable)
matcher, err := ignore.NewMatcher(sourceDir, ignore.Options{
    RespectGitignore:  true,
    StigmerignoreFile: filepath.Join(sourceDir, ".stigmerignore"),
    IncludeDefaults:   true,
})
if matcher.Match(relPath, info.IsDir()) {
    return nil // or filepath.SkipDir for directories
}
```

### Notes
- Consider adding CLI flags: `--ignore`, `--include`, `--no-gitignore`
- Show summary of ignored files in verbose mode

---

## Task 4: Add tests and documentation

**Status**: ✅ DONE
**Created**: 2026-01-27 00:27
**Completed**: 2026-01-30 (Session 4)

### Subtasks

**Tests (in `client-apps/cli/internal/cli/artifact/skill_test.go`):**
- [x] Unit tests for pattern parsing (all gitignore syntax variants) - covered in pkg/ignore tests
- [x] Unit tests for precedence resolution - covered in pkg/ignore tests
- [x] Unit tests for negation patterns (including parent-excluded gotcha)
- [x] Integration test: skill push with .gitignore only (`TestCreateSkillZip_WithGitignore`)
- [x] Integration test: skill push with .stigmerignore only (`TestCreateSkillZip_WithStigmerignore`)
- [x] Integration test: skill push with both files (multiple tests)
- [x] Integration test: .stigmerignore overriding .gitignore with !pattern (`TestCreateSkillZip_StigmerignoreOverridesGitignore`)
- [x] Edge case: empty .stigmerignore (`TestCreateSkillZip_EmptyStigmerignore`)
- [x] Edge case: invalid pattern syntax (should warn, not fail) (`TestCreateSkillZip_InvalidPatternSyntax`)
- [x] Edge case: Unicode filenames (`TestCreateSkillZip_UnicodeFilenames`)
- [x] Real-world scenarios: Python, Node.js, Go skills

**Documentation:**
- [x] Update CLI help text for `stigmer skill push` (done in Session 3)
- [x] Create `.stigmerignore` reference documentation (`docs/guides/stigmerignore-reference.md`)
- [x] Add examples for common scenarios (Python skill, Node.js skill, Go skill)
- [x] Document precedence rules clearly

### Test Files Created
- `client-apps/cli/internal/cli/artifact/skill_test.go` - 25+ integration tests
- `client-apps/cli/internal/cli/artifact/BUILD.bazel` - Updated with test target

### Documentation Created
- `docs/guides/stigmerignore-reference.md` - Comprehensive reference guide

---

## Task 5: Backend support (remote git push) - Optional/Future

**Status**: ⏸️ TODO (Future Phase)
**Created**: 2026-01-27 00:27

### Context
When using `stigmer skill push --git-url`, the backend fetches files directly. The same ignore logic should apply.

### Subtasks
- [ ] Extract `pkg/ignore` to a shared Go module (or copy to stigmer-cloud)
- [ ] Modify backend skill push handler to apply ignore filtering
- [ ] Test remote git push with .stigmerignore

### Notes
This is lower priority since local push is the primary use case. Can be done in a future phase.

---

## Project Completion Checklist

When all tasks are done:
- [x] Research and architecture complete
- [x] pkg/ignore package implemented with tests
- [x] skill push integration complete
- [x] All tests passing (30+ ignore package tests)
- [x] Integration tests for real-world scenarios (25+ tests in skill_test.go)
- [x] Documentation updated (.stigmerignore reference docs)
- [ ] Code reviewed/validated
- [x] Ready for use

---

**Quick Tip**: Keep this file updated as your single source of truth for project progress!

