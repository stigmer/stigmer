# Setup Proto Generation Infrastructure

**Date**: 2026-01-18 16:54  
**Type**: Infrastructure Setup  
**Scope**: Open Source Repository (stigmer/stigmer)  
**Impact**: Establishes consistent proto generation workflow matching Stigmer Cloud

## Summary

Implemented complete proto generation infrastructure in the open-source Stigmer repository (`stigmer/stigmer`) to match the proven approach from Stigmer Cloud (`leftbin/stigmer-cloud`). All proto build configuration moved from root to `apis/` directory with separate generation configs per language and comprehensive Makefile automation.

## What Changed

### 1. Moved Buf Configuration to `apis/` Directory

**Created**:
- `apis/buf.yaml` - Main buf module configuration with linting and breaking change detection
- `apis/buf.gen.go.yaml` - Go stub generation configuration
- `apis/buf.gen.python.yaml` - Python stub generation configuration
- `apis/buf.lock` - Dependency lock file (generated via `buf dep update`)
- `apis/.gitignore` - Excludes generated `stubs/` directory

**Deleted**:
- Root-level `buf.yaml`
- Root-level `buf.gen.yaml` 
- Root-level `buf.lock`

**Rationale**: Mirrors Stigmer Cloud's structure where all proto-related files live together in `apis/`, making the build system self-contained and easier to understand.

### 2. Created Comprehensive Makefile

New `apis/Makefile` provides unified interface for proto operations:

**Build Targets**:
- `make build` / `make protos` - Lint, format, and generate all stubs
- `make go-stubs` - Generate only Go stubs (with automatic go.mod creation)
- `make python-stubs` - Generate only Python stubs (with type hints)

**Quality Targets**:
- `make lint` - Run buf linting against style rules
- `make fmt` - Auto-format proto files

**Publishing Targets**:
- `make push` - Push to Buf Schema Registry (buf.build/stigmer/stigmer)
- `make release` - Full release workflow (lint + format + push)

**Maintenance Targets**:
- `make clean` - Remove all generated stubs
- `make update` - Update buf dependencies
- `make prep` - Clean and reinitialize stub directories

### 3. Configured Stub Generation Paths

**Go Stubs**:
- Output: `apis/stubs/go/`
- Module: `github.com/stigmer/stigmer/apis/stubs/go`
- Features:
  - Automatic nested directory flattening
  - Auto-generated `go.mod` with dependencies
  - Disabled `require_unimplemented_servers` for flexibility

**Python Stubs**:
- Output: `apis/stubs/python/stigmer/`
- Features:
  - Generates `.py`, `_grpc.py`, and `.pyi` (type stubs)
  - Includes imported protos (protovalidate, well-known types)
  - Auto-created `__init__.py` files
  - `py.typed` markers for mypy compatibility

### 4. Updated Documentation

**Created `apis/README.md`**:
- Comprehensive build instructions
- Directory structure explanation
- Prerequisites and dependencies
- Common workflows and commands
- Publishing workflow to Buf Schema Registry

**Updated Root `README.md`**:
- Added "Development" section
- Documented proto generation workflow
- Referenced `apis/README.md` for details
- Included build-from-source instructions

## Technical Details

### Buf Configuration Highlights

**Linting Rules** (`apis/buf.yaml`):
- Uses `STANDARD` lint set with targeted exceptions
- Disables overly strict rules:
  - `FIELD_NOT_REQUIRED` (allows optional fields)
  - `RPC_REQUEST_STANDARD_NAME` (flexible naming)
  - `ENUM_VALUE_PREFIX` (simpler enum values)
  - `PACKAGE_DIRECTORY_MATCH` (domain-based organization)
- Disallows comment-based lint ignores (forces clean code)

**Breaking Change Detection**:
- Uses `FILE` level detection
- Exceptions for extensions and field defaults
- Ensures backward compatibility

**Go Generation** (`apis/buf.gen.go.yaml`):
- Managed mode enabled for consistent package paths
- Optimized for `SPEED` (vs `CODE_SIZE`)
- go_package prefix: `github.com/stigmer/stigmer/apis/stubs/go`
- Uses latest buf remote plugins (protoc v1.36.6, grpc v1.5.1)

**Python Generation** (`apis/buf.gen.python.yaml`):
- Generates protobuf, gRPC, and type stubs (.pyi)
- Includes imports and well-known types
- Uses latest buf remote plugins (protoc v31.1, grpc v1.74.1)

### Directory Structure After Changes

```
stigmer/stigmer/
├── apis/
│   ├── ai/stigmer/...              # Proto definitions
│   ├── buf.yaml                    # Buf config
│   ├── buf.gen.go.yaml            # Go generation
│   ├── buf.gen.python.yaml        # Python generation
│   ├── buf.lock                   # Dependencies
│   ├── Makefile                   # Build automation
│   ├── README.md                  # Documentation
│   ├── .gitignore                 # Ignore stubs/
│   └── stubs/                     # Generated (gitignored)
│       ├── go/                    # Go stubs
│       └── python/stigmer/        # Python stubs
├── README.md                      # Updated with development section
└── ...
```

## Why This Matters

### 1. Consistency Across Projects

The open-source repo now uses **identical** proto generation patterns as Stigmer Cloud:
- Same Makefile structure and targets
- Same directory organization (`apis/` as root)
- Same stub output paths (`apis/stubs/`)
- Same buf configuration style

This reduces cognitive load when switching between codebases and ensures patterns learned in one project transfer directly to the other.

### 2. Developer Experience

**Before** (root-level buf.gen.yaml):
```bash
# Confusing - where do stubs go?
buf generate  # → internal/gen? sdk/python? unclear

# Multiple locations to check
ls internal/gen/
ls sdk/python/
```

**After** (apis/ structure):
```bash
cd apis
make build  # → Clear: everything in apis/stubs/

# Single location, obvious structure
ls stubs/go/
ls stubs/python/stigmer/
```

### 3. Language Separation

Separate generation configs (`buf.gen.go.yaml`, `buf.gen.python.yaml`) allow:
- Independent generation (`make go-stubs` vs `make python-stubs`)
- Language-specific optimizations
- Easier troubleshooting (which language failed?)
- Cleaner version control (no mixed changes)

### 4. Clean Repository

Generated code excluded from version control via `apis/.gitignore`:
- No accidental commits of stubs
- Smaller PR diffs (only proto changes)
- Faster CI/CD (no large generated files)
- Developers generate locally as needed

## Validation

Tested complete build workflow:

```bash
cd apis

# Linting passes
make lint
✓ No issues found

# Formatting applied
make fmt  
✓ Protos formatted

# Go stubs generated successfully
make go-stubs
✓ Directory structure fixed
✓ go.mod created
✓ Go stubs generated successfully

# Python stubs generated successfully  
make python-stubs
✓ Python stubs generated successfully

# Full build succeeds
make clean && make build
✓ All steps completed
```

**Verified outputs**:
- Go stubs: 80+ `.pb.go` files in `apis/stubs/go/ai/stigmer/...`
- Python stubs: 120+ files (`.py`, `_grpc.py`, `.pyi`) in `apis/stubs/python/stigmer/...`
- go.mod created with correct module path and dependencies
- All __init__.py and py.typed markers in place

## Impact

### Repository: stigmer/stigmer

**Configuration Changes**:
- ✅ 6 files created in `apis/`
- ✅ 3 files deleted from root
- ✅ 1 file updated (`README.md`)

**Build System**:
- ✅ Single command for all proto operations (`make build`)
- ✅ Language-specific targets for selective generation
- ✅ Automatic dependency management (go.mod, buf.lock)
- ✅ Clean/prep targets for fresh builds

**Documentation**:
- ✅ Comprehensive `apis/README.md` (100+ lines)
- ✅ Development section in root `README.md`
- ✅ Help menu via `make help`

### Future Work Simplified

With this infrastructure in place:

1. **Adding new proto files** → Just create `.proto`, run `make build`
2. **Updating dependencies** → Just run `make update`
3. **Publishing to Buf** → Just run `make push`
4. **Troubleshooting** → Check specific language target (`make go-stubs`)
5. **Onboarding new devs** → Read `apis/README.md`, run `make build`

## Implementation Matches Stigmer Cloud

This implementation is a **direct adaptation** of the proven approach from `leftbin/stigmer-cloud/apis/`:

| Feature | Stigmer Cloud | Open Source (Now) |
|---------|---------------|-------------------|
| Buf config location | `apis/buf.yaml` | ✅ `apis/buf.yaml` |
| Split generation configs | ✅ Per language | ✅ Per language |
| Makefile automation | ✅ Yes | ✅ Yes |
| Stub output path | `apis/stubs/` | ✅ `apis/stubs/` |
| go.mod auto-creation | ✅ Yes | ✅ Yes |
| Python type stubs | ✅ .pyi files | ✅ .pyi files |
| .gitignore stubs | ✅ Yes | ✅ Yes |

**Zero new patterns invented** - pure consistency with existing, battle-tested approach.

## Related Work

This setup enables Phase 2 of the open-source transition project:

**Project**: 20260118.03.open-source-stigmer  
**Phase 1**: ✅ Repository created, proto APIs copied, architecture docs written  
**Phase 2**: 🔜 **Proto generation** (this work) → Backend implementation → CLI wiring

Next steps now clear:
1. Generate Go stubs: `cd apis && make go-stubs`
2. Update imports in CLI code to use new stub paths
3. Implement BadgerDB backend using generated proto types
4. Wire CLI commands to backend via gRPC interfaces

## Files Changed

**Created**:
- `apis/buf.yaml`
- `apis/buf.gen.go.yaml`
- `apis/buf.gen.python.yaml`
- `apis/buf.lock`
- `apis/Makefile`
- `apis/README.md`
- `apis/.gitignore`

**Deleted**:
- `buf.yaml` (root)
- `buf.gen.yaml` (root)
- `buf.lock` (root)

**Modified**:
- `README.md` (added Development section)

**Generated** (gitignored):
- `apis/stubs/go/**/*.go` (80+ files)
- `apis/stubs/go/go.mod`
- `apis/stubs/python/stigmer/**/*.py` (120+ files)

---

**Related ADRs**: None (infrastructure setup, not architectural decision)  
**Related Checkpoints**: Phase 1 Complete (2026-01-18)  
**Next**: Phase 2 - Proto code generation and backend implementation
