# Fix Proto-Generated TypeScript Import Extensions for NodeNext

**Date**: April 30, 2026

## Summary

Added `import_extension=js` to the buf codegen configuration so that generated TypeScript protobuf stubs include explicit `.js` file extensions on relative imports. This resolves TS2835 compilation errors when building cursor-runner with `moduleResolution: "NodeNext"` (used by the desktop sidecar embed pipeline).

## Problem Statement

Running `make desktop-dev` failed with hundreds of TS2835 errors during the cursor-runner embed sync step. The errors came from generated TypeScript proto stubs using extensionless relative imports.

### Pain Points

- `make desktop-dev` was completely broken — could not start desktop development
- The issue was invisible to `make check` because the CI gate typechecks cursor-runner with `moduleResolution: "bundler"` (lenient), while the embed build uses `moduleResolution: "NodeNext"` (strict)
- All ~170 generated proto stub files had extensionless imports that are invalid under NodeNext resolution

## Solution

Configured `protoc-gen-es` and `protoc-gen-connect-es` to emit `.js` extensions on relative import paths by adding the officially supported `import_extension=js` plugin option to `apis/buf.gen.ts.yaml`, then regenerated all TypeScript stubs.

## Implementation Details

Single configuration change in `apis/buf.gen.ts.yaml` — added `import_extension=js` to both the `bufbuild/es` and `connectrpc/es` plugins. This causes the codegen to produce imports like `from "../../environment/v1/spec_pb.js"` instead of `from "../../environment/v1/spec_pb"`.

After the config change, ran `make ts-stubs` to regenerate all TypeScript protobuf stubs with the corrected import paths.

## Benefits

- `make desktop-dev` builds successfully again
- `make check` continues to pass (bundler resolution handles `.js` extensions without issue)
- Future proto regenerations will automatically include correct extensions
- No runtime behavior change — `.js` extensions are the correct ESM import convention

## Impact

- **Desktop development**: Unblocked — developers can run `make desktop-dev` again
- **CI**: No regression — `make check` passes as before
- **Proto stubs**: All ~170 generated TypeScript files updated with `.js` import extensions

## Related Work

- Cursor-runner TypeScript service: `backend/services/cursor-runner/`
- Desktop sidecar embed pipeline: `client-apps/cli/embedded/cursorrunner/sync.sh`

---

**Status**: ✅ Production Ready
