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

**Status**: ⏸️ TODO
**Created**: 2026-01-27 00:27

### Package Location
`client-apps/cli/pkg/ignore/`

### Subtasks
- [ ] Create package structure with BUILD.bazel
- [ ] Implement `defaults.go` with built-in patterns
- [ ] Implement `parser.go` for .stigmerignore file parsing
- [ ] Implement `gitignore.go` for .gitignore integration using go-git library
- [ ] Implement `ignore.go` with main `Matcher` interface and `NewMatcher()` factory
- [ ] Implement precedence resolution: defaults < .gitignore < .stigmerignore
- [ ] Add warning handling for invalid patterns (lenient like Git)
- [ ] Write comprehensive unit tests in `ignore_test.go`

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

**Status**: ⏸️ TODO
**Created**: 2026-01-27 00:27

### Files to Modify
- `client-apps/cli/internal/cli/artifact/skill.go`

### Subtasks
- [ ] Import `pkg/ignore` in skill.go
- [ ] Modify `createSkillZip()` to create Matcher with options
- [ ] Replace `shouldExclude()` calls with `matcher.Match()` calls
- [ ] Handle directory-level filtering (skip entire directories that match)
- [ ] Add `--dry-run` enhancement to show ignored files
- [ ] Remove hardcoded `shouldExclude()` function (or keep as fallback temporarily)
- [ ] Test with real skill directories

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

**Status**: ⏸️ TODO
**Created**: 2026-01-27 00:27

### Subtasks

**Tests:**
- [ ] Unit tests for pattern parsing (all gitignore syntax variants)
- [ ] Unit tests for precedence resolution
- [ ] Unit tests for negation patterns (including parent-excluded gotcha)
- [ ] Integration test: skill push with .gitignore only
- [ ] Integration test: skill push with .stigmerignore only
- [ ] Integration test: skill push with both files
- [ ] Integration test: .stigmerignore overriding .gitignore with !pattern
- [ ] Edge case: empty .stigmerignore
- [ ] Edge case: invalid pattern syntax (should warn, not fail)
- [ ] Edge case: Unicode filenames

**Documentation:**
- [ ] Update CLI help text for `stigmer skill push`
- [ ] Create `.stigmerignore` reference documentation
- [ ] Add examples for common scenarios (Python skill, Node.js skill, etc.)
- [ ] Document precedence rules clearly

### Test Fixtures to Create
```
test/fixtures/ignore/
├── basic/                 # Simple patterns
├── gitignore-only/        # Only .gitignore, no .stigmerignore
├── stigmerignore-only/    # Only .stigmerignore
├── both-files/            # Both files with overrides
├── negation/              # Negation patterns
└── invalid-syntax/        # Invalid patterns (should warn)
```

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
- [ ] pkg/ignore package implemented with tests
- [ ] skill push integration complete
- [ ] All tests passing
- [ ] Documentation updated
- [ ] Code reviewed/validated
- [ ] Ready for use

---

**Quick Tip**: Keep this file updated as your single source of truth for project progress!

