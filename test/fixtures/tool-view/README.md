# Tool-view golden fixtures

These files are the **single source of truth** for tool-call classification,
result normalization, and intent-title extraction across every surface: the
`@stigmer/sdk` TypeScript layer consumed by React, Ink, and the CLI's headless
renderers. (An earlier Go CLI `toolrender` package consumed them too; it was
retired by the CLI TypeScript migration, PR #203.)

They exist because tool *result* payloads are produced by third-party engines
(deepagents, the Cursor SDK) whose formats are version-fragile. Encoding every
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
  `@stigmer/sdk` tool-view tests (reader side).

## Contract

`classification.json` case:

```json
{ "name": "StrReplace", "mcpServerSlug": "", "toolKind": "TOOL_KIND_FILE_EDIT" }
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
back from args onto the terminal view). Computed diff line counts depend on the
per-language diff implementation and are **surface-local** — they are asserted in
each surface's own unit tests, not here, except when the count is present in the
source data (e.g. the Cursor edit envelope's `linesAdded`/`linesRemoved`), in
which case `expected.linesAdded`/`linesRemoved` are included and asserted.

The `search` view also carries `kind` (`"files"` for a glob/file-name search,
`"content"` for a grep-style search) and `truncated` (the engine capped the
results). These are presentation hints rather than cross-language scalar facts,
so they are asserted in each surface's own unit tests (e.g.
`tool-view.search.test.ts`), not in this shared fixture.

## Consumers

- TS reader: `sdk/typescript/src/execution/__tests__/tool-view.fixtures.test.ts`
- Runner writer (intent-title): `backend/services/runner/src/middleware/__tests__/tool-intent.test.ts`
- React reader (intent-title rendering): `sdk/react/src/execution/__tests__/intent-title.test.tsx`

When you change an engine's result format, update the fixture here; the test
suite will guide the corresponding parser change.
