---
name: ""
overview: ""
todos: []
isProject: false
---

---

name: Build System Unification

overview: Unify and document the build system by establishing Go as the canonical build tool, removing dead GoReleaser configuration, and standardizing Go version across all configuration files.

todos:

  - id: doc-build-system

content: Create docs/architecture/build-system.md documenting Go + Make as canonical build system

status: pending

  - id: delete-goreleaser

content: Delete .goreleaser.yml (dead configuration referencing non-existent files)

status: pending

  - id: standardize-go-ci

content: Update CI workflows to use Go 1.25

status: pending

  - id: standardize-go-bazel

content: Update MODULE.bazel Go SDK version to 1.25.6

status: pending

  - id: standardize-go-mods

content: Update all 9 go.mod files to go 1.25.6

status: pending

- id: verify-build

content: Verify build compiles with standardized Go version (go build ./...)

status: pending

isProject: false

---

# Phase 2: Build System Unification

## Problem Analysis

The build system has accumulated technical debt with inconsistent configurations and dead code:

### Issue 1: Go Version Fragmentation (SEVERE)

Four different Go versions in use:

| Location | Version | Purpose |

|----------|---------|---------|

| [.github/workflows/release-embedded.yml](.github/workflows/release-embedded.yml) | **1.22** | CI builds |

| [go.work](go.work) | **1.25.6** | Workspace |

| [MODULE.bazel](MODULE.bazel) | **1.24.6** | Bazel SDK |

| [sdk/go/go.mod](sdk/go/go.mod) | **1.25.0** | SDK module |

This creates:

- Potential build failures in CI vs local
- Different language feature availability
- Dependency resolution inconsistencies

### Issue 2: Dead GoReleaser Configuration (CRITICAL)

[.goreleaser.yml](.goreleaser.yml) is completely broken and unused:

1. **References non-existent `Dockerfile.server`** (line 110) - file does not exist
2. **Obsolete `stigmer-server` build target** (lines 32-48) - architecture changed to BusyBox pattern where server is embedded in CLI
3. **CI does NOT use GoReleaser** - [release-embedded.yml](.github/workflows/release-embedded.yml) has custom build logic

### Issue 3: Undocumented Build System Decision

Two build systems coexist without clear documentation:

- **Go (Makefile + CI)**: Actually used for production
- **Bazel**: Set up but not used for releases

## Recommended Go Version

**Go 1.25.x** (latest stable as of Jan 2026)

Rationale:

- Already used in go.work and go.mod files
- Provides latest language features and security patches
- CI should match development environment

## Implementation Plan

### Task 2.1: Document Build System Decision

Create [docs/architecture/build-system.md](docs/architecture/build-system.md):

```markdown
# Build System Architecture

## Canonical Build System: Go + Make

Stigmer uses **Go toolchain + Make** as the primary build system.

### Production Builds
- `make build` - Build CLI
- `make test` - Run tests
- GitHub Actions workflows for releases

### Why Not Bazel for Releases?
Bazel configuration exists for:
- Local development convenience
- Proto stub generation (gazelle)
- Future migration path

But releases use Go directly because:
- Simpler CI configuration
- Faster build times for small codebase
- No Bazel cache infrastructure needed
```

### Task 2.2: Remove Dead GoReleaser Configuration

**Decision: DELETE `.goreleaser.yml`**

Rationale:

- File is completely broken (references non-existent Dockerfile)
- Build architecture has fundamentally changed (BusyBox pattern)
- CI already has working release process in [release-embedded.yml](.github/workflows/release-embedded.yml)
- Keeping dead config creates confusion and maintenance burden

The existing CI workflow handles:

- Multi-platform builds (darwin-arm64, darwin-amd64, linux-amd64)
- Docker image publishing (ghcr.io)
- GitHub releases
- Homebrew tap updates

### Task 2.3: Standardize Go Version to 1.25.6

Update ALL configuration files to use **Go 1.25.6**:

| File | Change |

|------|--------|

| [.github/workflows/release-embedded.yml](.github/workflows/release-embedded.yml) | `go-version: '1.22'` -> `go-version: '1.25'` |

| [.github/workflows/publish-sandbox.yml](.github/workflows/publish-sandbox.yml) | No Go version (OK) |

| [MODULE.bazel](MODULE.bazel) | `version = "1.24.6"` -> `version = "1.25.6"` |

| [go.work](go.work) | Already `go 1.25.6` (OK) |

| All `go.mod` files | `go 1.25.0` -> `go 1.25.6` |

**Note:** CI uses `'1.25'` (without patch) to automatically get latest patch version.

### Task 2.4: Clean Up Bazel Configuration (Housekeeping)

Remove unused Bazel artifacts:

- Delete `gazelle:exclude sdk` from [BUILD.bazel](BUILD.bazel) (SDK should be included)
- Update `.bazelrc` comments to clarify auxiliary nature

## File Changes Summary

| Action | File |

|--------|------|

| **CREATE** | `docs/architecture/build-system.md` |

| **DELETE** | `.goreleaser.yml` |

| **EDIT** | `.github/workflows/release-embedded.yml` (Go version) |

| **EDIT** | `MODULE.bazel` (Go version) |

| **EDIT** | All 9 `go.mod` files (Go version to 1.25.6) |

## Verification Steps

After implementation:

```bash
# 1. Verify Go version consistency
grep -r "go 1\." --include="*.mod" --include="*.work"
grep "go-version" .github/workflows/*.yml
grep "version.*1\." MODULE.bazel

# 2. Verify build passes (tests are fixed in Task 5a at project end)
go build ./...

# 3. Verify no GoReleaser references remain
grep -r "goreleaser" .
```

**Note:** Full test fixes are handled in Task 5a at the end of this project. Phase 2 only verifies build compilation.

## Risk Assessment

| Task | Risk | Mitigation |

|------|------|------------|

| Delete GoReleaser | Low | File is completely unused; CI has independent release process |

| Bump Go version in CI | Medium | Test workflow before merging; Go 1.25 is stable |

| Update go.mod files | Low | Patch version bump; run `go mod tidy` to verify |