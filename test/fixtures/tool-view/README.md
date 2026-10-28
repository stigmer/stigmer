# Tool-view golden fixtures

These files are the **single source of truth** for tool-call classification,
result normalization, and intent-title extraction across every surface: the
`@stigmer/client` TypeScript layer consumed by React, Ink, and the CLI's headless
renderers. (An earlier Go CLI `toolrender` package consumed them too; it was
retired by the CLI TypeScript migration, PR #203.)

They exist because tool *result* payloads are produced by third-party engines
(deepagents, the Claude Agent SDK) whose formats are version-fragile. Encoding every
format assumption here means a future engine/SDK bump fails one test and is fixed
in one place, instead of silently drifting across client implementations.

## Files

- `classification.json` — `name` (+ optional `mcpServerSlug`) -> `toolKind`.
  Validates `resolveToolKind`'s legacy name-fallback path.
- `result-views.json` — a `ToolCall` projection -> the expected `ToolResultView`
  discriminator and the deterministic scalar facts.
- `intent-title.json` — model-authored shell intent extraction (stigmer#276):
  the wire key, SHELL-kind scoping, and blank/non-string degradation to null.
  Asserted by BOTH the runner middleware tests (writer side) and the
  `@stigmer/client` tool-view tests (reader side).
- `secret-args.json` — the secret-keyed tool arguments (stigmer#1119): the key
  set, the redaction marker, and `args` -> redacted cases. The runner redacts
  them on a row's `args`, its preview and its approval message; clients hide
  them on rows persisted before that. Asserted by BOTH the runner's
  args-preview tests (writer side) and the `@stigmer/client` tool-view tests
  (reader side).

## Contract

`classification.json` case:

```json
{ "name": "Edit", "mcpServerSlug": "", "toolKind": "TOOL_KIND_FILE_EDIT" }
```

`result-views.json` case:

```json
{
  "name": "native_edit_success",
  "harness": "native",
  "toolName": "edit_file",
  "mcpServerSlug": "",
  "args": { "file_path": "/workspace/x.md", "old_string": "a", "new_string": "b" },
  "result": "Successfully replaced 1 occurrence in '/workspace/x.md'",
  "expected": { "type": "diff", "path": "/workspace/x.md" }
}
```

`expected.type` is the `ToolResultView` discriminant
(`diff | file | terminal | search | list | contentBlocks | text | json | error`).

Only **deterministic facts** are asserted across languages: `type`, `path`,
`exitCode`, `count`, `mcpServerSlug`, and `command` (the shell command echoed
back from args onto the terminal view). Diff line counts are computed from the
call's old/new text by each surface's diff implementation, so they are
**surface-local** — asserted in each surface's own unit tests, not here.

The `search` view also carries `kind` (`"files"` for a glob/file-name search,
`"content"` for a grep-style search). It is a presentation hint rather than a
cross-language scalar fact, so it is asserted in each surface's own unit tests
(e.g. `tool-view.search.test.ts`), not in this shared fixture.

## Consumers

- TS reader: `sdk/typescript/src/run/__tests__/tool-view.fixtures.test.ts`
- Runner writer (intent-title): `backend/services/runner/src/middleware/__tests__/tool-intent.test.ts`
- Runner writer (secret-args): `backend/services/runner/src/shared/__tests__/args-preview.test.ts`
- React reader (intent-title rendering): `sdk/react/src/run/__tests__/intent-title.test.tsx`
- Claude writer (result views): `backend/services/runner/src/activities/execute-claude/__tests__/tool-view-fixtures.test.ts`
  holds every `harness: "claude"` case equal to the row the real engine wrote
  in a hermetic run (`__tests__/hermetic/goldens/`); those cases are captured,
  never written by hand.

When you change an engine's result format, update the fixture here; the test
suite will guide the corresponding parser change.
