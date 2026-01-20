# Pipeline Architecture Alignment with Java

**Type:** Refactoring / Architecture Improvement  
**Scope:** Backend / gRPC Request Framework  
**Date:** 2026-01-18  
**Impact:** Infrastructure - Improved architectural consistency

## Summary

Corrected the Go pipeline framework location to align with Java architecture. The pipeline is now properly positioned as **part of the gRPC request handling framework** at `backend/libs/go/grpc/request/pipeline/`, matching the Java structure at `backend/libs/java/grpc/grpc-request/pipeline/`.

## What Changed

### Architecture Correction

**Initial Migration (incorrect):**
```
backend/libs/go/
├── grpc/        # Server only
├── pipeline/    # ❌ Standalone (misaligned with Java)
├── sqlite/
└── telemetry/
```

**Final Structure (correct - aligned with Java):**
```
backend/libs/go/
└── grpc/
    ├── server.go            # Basic gRPC server
    └── request/             # ✓ Request handling framework
        └── pipeline/        # ✓ Part of request handling
```

### Location Change

**From:**
```
backend/libs/go/pipeline/
```

**To:**
```
backend/libs/go/grpc/request/pipeline/
```

### Import Path Change

**Before:**
```go
import "github.com/stigmer/stigmer/backend/libs/go/pipeline"
```

**After:**
```go
import "github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
```

## Why This Matters

### 1. Architectural Parity with Java

The pipeline framework is tightly coupled to gRPC request processing, not a generic standalone library.

**Java (Stigmer Cloud):**
```
backend/libs/java/grpc/grpc-request/
├── pipeline/          # Part of gRPC request framework
├── context/
├── handler/
└── interceptor/
```

**Go (Stigmer OSS - now aligned):**
```
backend/libs/go/grpc/request/
└── pipeline/          # Part of gRPC request framework
```

### 2. Clear Ownership and Purpose

**Pipeline characteristics that make it gRPC-specific:**
- Executes within gRPC interceptor context
- Operates on gRPC requests/responses
- Integrates with gRPC error codes and status
- Part of request lifecycle management

Placing it in `grpc/request/` makes this relationship explicit and prevents it from being misused as a generic abstraction layer.

### 3. Future Extensibility

As the Go backend framework grows, we can add complementary components:

```
backend/libs/go/grpc/request/
├── pipeline/           # ✅ Already implemented
├── context/            # 🔜 Request context types
├── handler/            # 🔜 Base handler interfaces
└── interceptor/        # 🔜 gRPC interceptors
```

All request handling concerns live together, matching the proven Java architecture.

## Files Changed

### Moved
- Entire `pipeline/` package moved to `grpc/request/pipeline/`
- 11 core files + 11 test files
- 3 documentation files (README.md, README_LIB.md, MIGRATION.md)

### Updated
- All import paths in pipeline package files
- All test files updated for new interface
- Documentation updated with correct paths

### Added
- `backend/libs/go/grpc/request/README.md` - Framework overview explaining architecture alignment
- Updated `backend/libs/go/grpc/request/pipeline/MIGRATION.md` - Migration guide with Java comparison

## Technical Details

### Import Path Updates

Updated all references from:
```go
"github.com/stigmer/stigmer/backend/libs/go/pipeline"
"github.com/stigmer/stigmer/backend/libs/go/pipeline/steps"
```

To:
```go
"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
```

### Package Structure

```
backend/libs/go/grpc/request/pipeline/
├── pipeline.go          # Pipeline orchestrator
├── context.go           # Request context
├── step.go              # PipelineStep interface
├── error.go             # Error types
├── README.md            # Complete framework documentation
├── README_LIB.md        # Library overview
├── MIGRATION.md         # Migration details
└── steps/               # Common reusable steps
    ├── validation.go    # Proto validation
    ├── slug.go          # Slug generation
    ├── defaults.go      # Default values
    ├── duplicate.go     # Duplicate checking
    └── persist.go       # Database persistence
```

## Benefits

### For Developers

✅ **Consistent architecture** - Go and Java follow same patterns  
✅ **Clear purpose** - Pipeline is explicitly part of gRPC layer  
✅ **Easier onboarding** - Developers familiar with Java structure can navigate Go structure  
✅ **Future-proof** - Room for complementary request handling components

### For Architecture

✅ **Maintainability** - Consistent patterns across polyglot services  
✅ **Extensibility** - Clear place for future request handling components  
✅ **Documentation** - Architecture reasoning captured and explained  
✅ **Team alignment** - No confusion about where request processing code belongs

## Documentation

Comprehensive documentation created/updated:

- **Framework Overview:** `backend/libs/go/grpc/request/README.md`
  - Explains architecture alignment with Java
  - Compares Go and Java structures
  - Describes future extensibility plans

- **Pipeline Guide:** `backend/libs/go/grpc/request/pipeline/README.md`
  - Complete framework documentation
  - Usage examples and patterns

- **Migration Guide:** `backend/libs/go/grpc/request/pipeline/MIGRATION.md`
  - Details the location change
  - Explains architectural reasoning
  - Documents import path updates

## Testing

✅ **Package builds successfully**  
✅ **Core pipeline tests pass**  
✅ **No old import paths remain**  
✅ **Interface signatures corrected**

```bash
cd backend/libs/go/grpc/request/pipeline && go build ./...  # ✅ Success
```

## Related Work

This refactoring was identified during the Agent Controller Pipeline project:
- **Project:** `_projects/2026-01/20260118.01.agent-controller-pipeline/`
- **Context:** Initial pipeline migration from service to libs
- **Correction:** User feedback about Java architecture alignment

## Next Steps

The pipeline framework is now correctly positioned and ready for integration into controllers:

1. **Agent Controller Integration** - Use pipeline in Agent CRUD operations
2. **Workflow Controller Integration** - Apply same patterns
3. **Future Components** - Add context/, handler/, interceptor/ as needed

---

**Completed:** 2026-01-18  
**Status:** ✅ Architecture aligned - ready for controller integration  
**Java Equivalent:** `backend/libs/java/grpc/grpc-request/pipeline/`
