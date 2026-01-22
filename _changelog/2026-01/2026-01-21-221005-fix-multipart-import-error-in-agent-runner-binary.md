# Fix multipart import error in agent-runner binary

**Date:** 2026-01-21  
**Type:** Bug Fix  
**Component:** agent-runner (PyInstaller binary)  
**Impact:** High - Prevents agent-runner binary from starting

## Problem

The agent-runner binary was failing to start with the following error:

```
ImportError: cannot import name 'MultipartSegment' from 'multipart' 
(/var/folders/.../multipart/__init__.py)
```

The error occurred during initialization when the Daytona SDK tried to import `MultipartSegment` from the `multipart` package in `daytona/_async/filesystem.py`.

## Root Cause

PyInstaller was not properly bundling the `multipart` package (v1.3.0) that the Daytona SDK depends on. While the package was included as a transitive dependency in `poetry.lock`, PyInstaller's automatic dependency detection missed it because:

1. The import happens inside the Daytona SDK's async filesystem module
2. PyInstaller's static analysis couldn't detect the import path through nested SDK modules
3. The `multipart` package wasn't explicitly listed in the `hiddenimports` section

## Solution

### 1. Added explicit hidden imports to `agent-runner.spec`

```python
# Daytona sandbox support
'daytona',
'daytona._async',
'daytona._async.filesystem',
'daytona._sync',
'daytona._sync.filesystem',

# multipart package (required by daytona SDK)
'multipart',
'multipart.multipart',  # Contains MultipartSegment, PushMultipartParser

'deepagents_cli',
```

### 2. Created custom PyInstaller hook: `hooks/hook-multipart.py`

This hook ensures PyInstaller correctly handles the `multipart` package, which is a single-file module (not a package) that exports multiple classes.

### 3. Updated spec to use custom hooks directory

```python
hookspath=['hooks'],  # Custom PyInstaller hooks directory
```

## Technical Details

The `multipart` package is implemented as a single Python file (`multipart.py`) that exports classes like `MultipartSegment`, `PushMultipartParser`, and functions like `parse_options_header`. When code does `from multipart import MultipartSegment`, PyInstaller's static analysis incorrectly interprets this as importing a submodule `multipart.MultipartSegment`, which doesn't exist.

The fix ensures:
1. The complete `multipart.py` module is included in the bundle
2. The Daytona async/sync filesystem modules that depend on it are included
3. PyInstaller treats `multipart` as a single-file module, not a package

## Files Modified

```
backend/services/agent-runner/agent-runner.spec
backend/services/agent-runner/hooks/hook-multipart.py (new)
backend/services/agent-runner/test_multipart_import.py (new, for testing)
```

## Verification

To verify the fix:

```bash
cd backend/services/agent-runner
make rebuild-binary
./dist/agent-runner
```

The binary should now start without the `MultipartSegment` import error.

## Related Issues

- Daytona SDK dependency: `daytona>=0.113.0`
- Multipart package: `multipart>=1.0.0,<2.0.0` (transitive dependency)

## Impact

**Before:** Agent-runner binary failed to start, blocking all Graphton execution workflows.

**After:** Binary starts successfully and can execute Graphton workflows with Daytona sandbox support.
