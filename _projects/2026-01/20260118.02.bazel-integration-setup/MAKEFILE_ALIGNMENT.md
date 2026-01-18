# Makefile Alignment Summary

**Date**: 2026-01-18  
**Status**: ✅ Fully Aligned with Cloud Version

## Architecture Pattern

Both repositories follow the **same delegation pattern**:

```
Root Makefile (stigmer/)
    ↓ delegates to
APIs Makefile (stigmer/apis/)
    ↓ generates
Stubs (Go, Python, Java, etc.)
```

### Root Makefile Delegates to APIs

**Stigmer OSS:**
```makefile
protos:
	$(MAKE) -C apis build
```

**Stigmer Cloud:**
```makefile
protos:
	$(MAKE) -C apis build
```

✅ **Identical delegation pattern**

## Stub Generation Patterns

All language stubs follow the **universal pattern**:

```makefile
<lang>-stubs: <lang>-stubs-clean <lang>-stubs-init
	@echo "Generating <lang> stubs..."
	@$(BUF) generate --template buf.gen.<lang>.yaml
	@$(MAKE) <lang>-stubs-post-process
	@echo "✓ <lang> stubs generated successfully"
```

### Pattern Breakdown

Every language follows these steps:

1. **Clean** - Remove old generated code
2. **Init** - Create directories
3. **Generate** - Run `buf generate`
4. **Post-process** - Language-specific fixups
5. **Success message**

## Language-Specific Verification

### ✅ Go Stubs - ALIGNED

**Stigmer OSS:**
```makefile
go-stubs: go-stubs-clean go-stubs-init
	@$(BUF) generate --template buf.gen.go.yaml
	@$(MAKE) go-stubs-fix-structure
	@$(MAKE) go-stubs-ensure-gomod
	@$(MAKE) go-stubs-generate-build-files  # ← ADDED to match cloud
```

**Stigmer Cloud:**
```makefile
go-stubs: go-stubs-clean go-stubs-init
	@$(BUF) generate --template buf.gen.go.yaml
	@$(MAKE) go-stubs-fix-structure
	@$(MAKE) go-stubs-ensure-gomod
	@$(MAKE) go-stubs-generate-build-files
```

**Post-processing steps:**
1. Fix nested directory structure
2. Ensure go.mod exists
3. Generate BUILD.bazel files via Gazelle

### ✅ Python Stubs - ALIGNED

**Both repositories:**
```makefile
python-stubs: python-stubs-clean python-stubs-init
	@$(BUF) generate --template buf.gen.python.yaml
	@$(MAKE) python-stubs-add-py-typed-markers
```

**Post-processing:**
1. Add py.typed markers for type checking

### Cloud-Only Languages

Stigmer Cloud has additional languages (not needed in OSS):
- **Java** - For stigmer-service backend
- **Dart** - For mobile app
- **TypeScript** - For web console

These follow the same clean → init → generate pattern.

## Target Comparison

### Stigmer OSS (Go + Python only)

```
.PHONY targets:
  go-stubs
  go-stubs-clean
  go-stubs-init
  go-stubs-fix-structure
  go-stubs-ensure-gomod
  go-stubs-generate-build-files  ← Fixed!
  
  python-stubs
  python-stubs-clean
  python-stubs-init
  python-stubs-add-py-typed-markers
```

### Stigmer Cloud (Multi-language)

```
.PHONY targets:
  java-stubs + helpers
  dart-stubs + helpers
  ts-stubs + helpers
  go-stubs + helpers (same as OSS)
  python-stubs + helpers (same as OSS)
```

## Root Makefile Comparison

### Common Targets (Both)

✅ **Proto Generation:**
```makefile
protos:              # Generate all stubs
protos-release:      # Push to Buf + Git tag
```

✅ **Maintenance:**
```makefile
clean:               # Clean all artifacts
lint:                # Run linters
fmt:                 # Format code
```

### OSS-Specific Targets

```makefile
build:               # Build Stigmer CLI
test:                # Run Go tests
dev:                 # Run in development mode
```

### Cloud-Specific Targets

```makefile
build-java:          # Build Java services
build-go:            # Build Go services
build-python:        # Build Python services
build-mobile:        # Build mobile app
build-web:           # Build web app
port-forward:        # kubectl port-forwards
```

## Key Fixes Applied

### 1. Added Missing Gazelle Step to Go Stubs

**Before:**
```makefile
go-stubs: go-stubs-clean go-stubs-init
	@$(BUF) generate --template buf.gen.go.yaml
	@$(MAKE) go-stubs-fix-structure
	@$(MAKE) go-stubs-ensure-gomod
	# Missing BUILD file generation!
```

**After:**
```makefile
go-stubs: go-stubs-clean go-stubs-init
	@$(BUF) generate --template buf.gen.go.yaml
	@$(MAKE) go-stubs-fix-structure
	@$(MAKE) go-stubs-ensure-gomod
	@$(MAKE) go-stubs-generate-build-files  # ← ADDED
```

**Why:** Ensures BUILD.bazel files are generated after Go stubs, enabling Bazel builds.

## Verification

All patterns verified:

```bash
# Test Go stubs (with Gazelle)
$ cd apis && make go-stubs
✓ Go stubs generated successfully
✓ BUILD.bazel files generated

# Test Python stubs
$ cd apis && make python-stubs
✓ Python stubs generated successfully

# Test full build
$ make protos
✓ All stubs generated
```

## Pattern Consistency

Every language stub target follows this structure:

```makefile
# 1. Define directories
<LANG>_STUBS_DIR := stubs/<lang>

# 2. Clean target
.PHONY: <lang>-stubs-clean
<lang>-stubs-clean:
	rm -rf $(<LANG>_STUBS_DIR)

# 3. Init target
.PHONY: <lang>-stubs-init
<lang>-stubs-init:
	mkdir -p $(<LANG>_STUBS_DIR)

# 4. Main target with dependencies
.PHONY: <lang>-stubs
<lang>-stubs: <lang>-stubs-clean <lang>-stubs-init
	@$(BUF) generate --template buf.gen.<lang>.yaml
	@$(MAKE) <lang>-stubs-<post-process>
```

## Summary

✅ **Root Makefile** - Properly delegates to `apis/`  
✅ **APIs Makefile** - All stub patterns aligned  
✅ **Go Stubs** - Now includes Gazelle BUILD generation  
✅ **Python Stubs** - Already aligned  
✅ **Clean/Init Pattern** - Consistent across all languages  
✅ **Post-processing** - Language-specific steps match cloud  

**Conclusion**: The stigmer OSS build system is now **fully aligned** with stigmer-cloud's working patterns and best practices.
