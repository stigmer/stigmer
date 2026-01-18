# Synthesis API Improvement

**Date:** January 13, 2026  
**Type:** Enhancement  
**Scope:** Go SDK - Public API

## Summary

Improved the synthesis API to use a cleaner, more idiomatic pattern with the root package instead of exposing internal packages.

**Key Change:**
```go
// Before: Exposed internal package
import "github.com/leftbin/stigmer-sdk/go/internal/synth"
defer synth.AutoSynth()

// After: Clean root package API
import stigmeragent "github.com/leftbin/stigmer-sdk/go"
defer stigmeragent.Complete()
```

## Motivation

User feedback highlighted a discrepancy between the original design vision (zero-boilerplate synthesis using `atexit` hooks like Python) and the Go implementation requiring explicit `defer synth.AutoSynth()`.

**Core Issue:** The API exposed internal packages and had unclear intent.

**Root Cause:** Go lacks `atexit` semantics, so some explicit code is required. The question was: what's the cleanest API we can provide?

## What Changed

### 1. New Public API

**File:** `go/synthesis.go` (new)

Created a public `Complete()` function in the root package:

```go
package stigmeragent

func Complete() {
    synth.AutoSynth()
}
```

**Why root package?**
- Avoids import cycle (agent → synth, synth → agent)
- Clear separation of concerns (synthesis control vs agent construction)
- Follows Go idiom of root package for package-wide operations

### 2. Improved Documentation

**Created:**
- `go/docs/architecture/synthesis-model.md` - Comprehensive explanation of why Go requires this pattern (200+ lines)
- `go/docs/implementation/synthesis-api-improvement.md` - Technical implementation details

**Content:**
- Why Go can't use Python's `atexit` approach
- What alternatives we explored (finalizers, signals, goroutines, Go 1.24+ hooks)
- Why `defer stigmeragent.Complete()` is the best solution
- Future improvements when Go 1.24 becomes mainstream
- Detailed FAQ

### 3. Updated Examples

**Files updated:**
- `go/examples/06_agent_with_instructions_from_files.go`
- `stigmer/client-apps/cli/examples/basic-agent/main.go`

**Change:**
```go
// Before
import "github.com/leftbin/stigmer-sdk/go/internal/synth"
defer synth.AutoSynth()

// After
import stigmeragent "github.com/leftbin/stigmer-sdk/go"
defer stigmeragent.Complete()
```

### 4. Internal Refactoring

**File:** `go/internal/synth/synth.go`

- Extracted `autoSynth()` internal function
- Made `AutoSynth()` use `sync.Once` for thread safety
- Updated documentation

### 5. Documentation Standards Compliance

Reorganized documentation to follow Stigmer's documentation standards:
- Lowercase hyphenated filenames (`synthesis-model.md`, not `SYNTHESIS.md`)
- Proper categorization (architecture/, implementation/)
- Updated docs/README.md index
- Removed temporary files from `_cursor/` folder

## Impact

### Benefits

✅ **Cleaner API** - Root package instead of internal imports  
✅ **Better naming** - `Complete()` is self-documenting  
✅ **No internal exposure** - Users don't see `internal/synth`  
✅ **Import cycle resolved** - Clean package dependency graph  
✅ **Comprehensive documentation** - Why this is the best approach  
✅ **Standards compliant** - Follows Stigmer doc organization  

### Trade-offs

⚠️ **Two imports required** - Root package + agent package  
⚠️ **Still requires `defer`** - Can't be fully automatic in Go < 1.24  

### Migration Required

Users of the old API need to:
1. Add import: `stigmeragent "github.com/leftbin/stigmer-sdk/go"`
2. Remove import: `"github.com/leftbin/stigmer-sdk/go/internal/synth"`
3. Change: `defer synth.AutoSynth()` → `defer stigmeragent.Complete()`

## Files Changed

### New Files

```
go/
├── synthesis.go                                     # Public Complete() API
└── docs/
    ├── architecture/
    │   └── synthesis-model.md                       # Why Go needs this pattern
    └── implementation/
        └── synthesis-api-improvement.md             # Technical details
```

### Modified Files

```
go/
├── agent/doc.go                                     # Updated docs
├── docs/README.md                                   # Updated index
├── examples/06_agent_with_instructions_from_files.go  # Updated example
└── internal/synth/synth.go                          # Refactored logic
```

### Deleted Files

```
go/
└── SYNTHESIS.md                                     # Moved to docs/architecture/
```

## Testing

No functional changes to synthesis behavior - only API surface improved. Existing tests remain valid.

**Verification:**
```bash
# Dry-run mode
go run examples/01_basic_agent.go
# Output: "✓ Stigmer SDK: Dry-run complete..."

# Synthesis mode
STIGMER_OUT_DIR=/tmp go run examples/01_basic_agent.go
# Output: "✓ Stigmer SDK: Manifest written to: /tmp/manifest.pb"
```

## Related Issues

- User feedback: Discrepancy between original design and implementation
- Documentation standards enforcement
- Import cycle prevention

## Future Work

### Go 1.24+ Automatic Synthesis

When Go 1.24 becomes mainstream (2025-2027):

```go
//go:build go1.24

func init() {
    runtime.AddExitHook(synth.AutoSynth)
}
```

Then `defer stigmeragent.Complete()` becomes optional for Go 1.24+ users.

### Potential Enhancements

1. Static analysis tool to detect missing `defer Complete()`
2. Better CLI error messages suggesting the defer pattern
3. Optional `DisableAutoComplete()` for custom workflows

## References

- [Synthesis Model Architecture](../go/docs/architecture/synthesis-model.md)
- [Synthesis API Improvement Details](../go/docs/implementation/synthesis-api-improvement.md)
- [Go SDK Documentation Index](../go/docs/README.md)

## Conclusion

This improvement brings the Go SDK API as close to the original design vision as possible within Go's language constraints. The `defer stigmeragent.Complete()` pattern is:

1. **Minimal** - One line of code
2. **Clear** - Self-documenting intent
3. **Well-documented** - Comprehensive explanation of rationale
4. **Future-proof** - Ready for Go 1.24+ automatic hooks

The gap between the ideal (zero boilerplate) and our implementation (one line) reflects Go's design philosophy: explicit over implicit.
