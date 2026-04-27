# Fix make check Mypy and Typedoc Lint Failures

**Date**: April 27, 2026

## Summary

Resolved three lint/typecheck failures that caused `make check` to fail in the
stigmer OSS repository: a Python mypy `[valid-type]` error in the HTTP
checkpoint saver, two typedoc unresolved-link warnings in the React SDK, and
stale generated SDK documentation.

## Problem Statement

Running `make check` on the stigmer repo exited with code 2 due to cascading
lint failures across Python and TypeScript tooling.

### Pain Points

- mypy reported a `[valid-type]` error on
  `HttpCheckpointSaver._parse_writes()` because the class's `list()` method
  (overriding `BaseCheckpointSaver.list`) shadowed the built-in `list` type
  used in return-type annotations.
- typedoc's `--treatValidationWarningsAsErrors` flag turned two warnings into a
  hard failure in `@stigmer/react`:
  - `STALE_THRESHOLD_MS` (a non-exported module constant in `useDefaultAgent`)
    was referenced with `{@link}` but excluded from documentation output.
  - `Stigmer` was referenced with `{@link}` in `useRunnerCredential` but the
    type was not imported, so typedoc could not resolve it against the
    `externalSymbolLinkMappings`.
- After fixing the above, `gen-react-sdk-docs-check` failed because the
  generated SDK reference pages were stale relative to the updated exports.

## Solution

Applied minimal, targeted fixes to each failure without changing runtime
behavior:

1. **mypy** — Added `import builtins` and qualified the two `list[...]`
   annotations inside `_parse_writes()` as `builtins.list[...]`, cleanly
   disambiguating from the inherited `list()` method.
2. **typedoc link to `STALE_THRESHOLD_MS`** — Added the constant to the
   `@stigmer/react` section of `externalSymbolLinkMappings` in
   `typedoc.json` with a `"#"` target (suppress-only), matching the existing
   pattern for other non-exported symbols.
3. **typedoc link to `Stigmer`** — Added `import type { Stigmer } from
   "@stigmer/sdk"` to `useRunnerCredential.ts` so typedoc can trace the
   symbol back to the SDK package and resolve the existing mapping.
4. **Stale docs** — Ran `make gen-react-sdk-docs` to regenerate the 17 MDX
   reference pages and the summary JSON.

## Implementation Details

| File | Change |
|---|---|
| `backend/services/agent-runner/worker/checkpointer/http_saver.py` | `import builtins`; `builtins.list[...]` in return type and local variable |
| `sdk/react/src/runner/useRunnerCredential.ts` | Added `import type { Stigmer }` |
| `sdk/react/typedoc.json` | Added `"STALE_THRESHOLD_MS": "#"` to `@stigmer/react` mappings |
| `docs/sdk/react/*.mdx`, `site/src/data/react-sdk-summary.json` | Regenerated (no manual edits) |

## Benefits

- `make check` passes for all Go, Python, TypeScript, protobuf, and docs
  targets (the only remaining failure is a pre-existing Tauri desktop sidecar
  name collision unrelated to this work).
- No runtime behavior changes — all fixes are purely in type annotations,
  documentation config, and generated docs.

## Impact

- **CI gate**: Unblocks `make check` for all contributors working on the
  Python checkpointer or React SDK.
- **Developer experience**: New contributors won't encounter false-positive
  lint failures when running the local check suite.

## Related Work

- Prior `make check` fix sessions:
  `2026-04-24-182004-fix-make-check-ci-gate-failures.md`,
  `2026-04-16-165225-fix-make-check-lint-and-build-failures.md`
- The `useRunnerCredential` hook was introduced in
  `2026-04-27-131448-fix-runner-start-auth-sdk-credential-hook.md`

---

**Status**: ✅ Production Ready
