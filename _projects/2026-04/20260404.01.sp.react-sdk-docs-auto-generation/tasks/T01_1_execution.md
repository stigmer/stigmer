# Task T01: Execution Log — TypeDoc Setup + Proof of Concept

**Started**: 2026-04-04
**Status**: COMPLETE
**Plan**: T01_0_plan.md

## What Was Done

### 1. TypeDoc Installation

Added `typedoc@^0.28.18` as a devDependency in `sdk/react/package.json`.
Added `"typedoc:json": "typedoc"` script.

### 2. TypeDoc Configuration

Created `sdk/react/typedoc.json`:

```json
{
  "$schema": "https://typedoc.org/schema.json",
  "entryPoints": ["src/index.ts"],
  "tsconfig": "tsconfig.typedoc.json",
  "skipErrorChecking": true,
  "json": "dist/api.json",
  "pretty": true,
  "excludeInternal": true,
  "excludeExternals": true,
  "readme": "none"
}
```

Created `sdk/react/tsconfig.typedoc.json` (extends `tsconfig.json`, excludes
test files from compilation scope):

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["node_modules", "dist", "src/**/__tests__/**"]
}
```

### 3. Pre-existing TypeScript Errors

The project has 5 pre-existing TypeScript errors:

- 3 in test files (`__tests__/`): missing `screen`/`waitFor` imports from
  `@testing-library/react`.
- 2 in `src/environment/systemEnvVars.ts`: `getAuthCredential` and `baseUrl`
  properties don't exist on `Stigmer` type (likely an SDK interface drift).

**Mitigations applied:**

- `tsconfig.typedoc.json` excludes `src/**/__tests__/**` — test files are not
  part of the public API and should not be compiled for doc generation.
- `skipErrorChecking: true` in `typedoc.json` handles the remaining source
  error. TypeDoc still extracts all type information correctly despite the two
  property-access errors in `systemEnvVars.ts`.

### 4. Successful Run

TypeDoc produces `dist/api.json` (1.9 MB, 76,661 lines) in ~3 seconds.
Exit code 0 with 61 warnings (all about external symbol link resolution,
expected with `excludeExternals: true`).

---

## Findings: JSON Output Analysis

### Summary Statistics

| Category         | Count | With TSDoc | Coverage |
|------------------|------:|----------:|---------:|
| Functions        |   159 |       157 |    98.7% |
| Interfaces       |   159 |        32 |    20.1% |
| Type Aliases     |    29 |        24 |    82.8% |
| Variables        |     7 |         4 |    57.1% |
| **Total exports** | **354** | **204** | **57.6%** |

**Key insight:** Functions (hooks + components) are almost universally
documented (98.7%). Interfaces — particularly props interfaces and return-type
interfaces — are the main gap (20.1%). This makes sense: the TSDoc convention
puts the description on the function, not on its associated `*Props` or
`*Return` interface. The interface _fields_ often have per-property docs, but
the interface itself has no top-level summary.

### What's Present and Usable

1. **Hook signatures**: Full function signature with parameter names, types
   (including `string | null` unions), and return type reference. Example:
   `useSession(id: string | null): UseSessionReturn`.

2. **TSDoc descriptions**: Rich comment data with `kind` segments (`text`,
   `code`, `inline-tag`). The generator can reconstruct markdown from these
   segments. `{@link}` tags include target IDs for internal references and
   `packageName`/`qualifiedName` for external references.

3. **`@example` blocks**: Present on 116 of 354 exports (32.8%). All hooks
   and most components have examples. Stored in `comment.blockTags` with
   `tag: "@example"` and fenced code block content.

4. **Component props**: React components appear as `kind: 64` (Function) with
   a single `__namedParameters` parameter referencing the props interface.
   The props interface has typed children with field-level TSDoc.

5. **Source file paths**: Every export has `sources[0].fileName` like
   `"session/useSession.ts"` or `"execution/MessageThread.tsx"`. The first
   path segment reliably maps to the domain folder. This is the basis for
   domain grouping in the generator.

6. **Type detail**: Intrinsic types (`string`, `boolean`), union types,
   intersection types, array types, reflection types (inline callbacks),
   and cross-package references are all fully resolved.

7. **Interface fields**: `children` array on interfaces provides each
   property with name, type, `isOptional`/`isReadonly` flags, source
   location, and optional per-field TSDoc.

### Domain Grouping (from source paths)

| Domain           | Exports |
|------------------|--------:|
| execution        |      88 |
| environment      |      37 |
| mcp-server       |      37 |
| agent            |      29 |
| session          |      29 |
| library          |      28 |
| skill            |      15 |
| github           |      13 |
| workspace        |      13 |
| api-key          |      12 |
| attachment       |      11 |
| agent-instance   |       9 |
| models           |       9 |
| composer         |       6 |
| root             |       6 |
| error            |       5 |
| internal         |       2 |
| search           |       1 |
| **Total**        | **354** |

"root" = exports from files directly in `src/` (provider.tsx, hooks.ts,
context.ts, deployment-mode.ts). These are the core exports and should map
to a "core" page.

"internal" = `CloudFeatureNotice` from `src/internal/`. Should fold into
the core page.

"search" = `ResourceListScope` from `src/search/`. Should fold into the
library page.

### What's Missing or Incomplete

1. **Interface-level summaries**: 127 of 159 interfaces have no top-level
   TSDoc summary. The individual fields usually are documented, but there's
   no `/** ... */` above the `interface` declaration itself. This affects
   the generated page: the generator can render a TypeTable for the fields
   but won't have a description paragraph above it.

2. **Props interfaces undocumented as a group**: Nearly all `*Props`
   interfaces (e.g., `MessageThreadProps`, `AgentPickerProps`) have no
   top-level comment. Their individual props DO have field-level docs though.

3. **Return-type interfaces undocumented**: All `Use*Return` interfaces lack
   top-level summaries. Since the hook's own TSDoc describes what it returns,
   this is less critical — the generator can pull context from the hook.

4. **Re-exported external types excluded**: `DeploymentMode`,
   `isResourceAvailable`, `ApiResourceKind`, `ExecutionArtifact`, and
   `ExecutionArtifactKind` are re-exported from `@stigmer/sdk` and
   `@stigmer/protos`. With `excludeExternals: true`, they don't appear in
   the JSON. The generator will need to decide: render them inline (requires
   removing `excludeExternals`), or link to the existing proto-based
   resource pages.

5. **External link warnings**: 61 warnings about `{@link Stigmer}`,
   `{@link Session}`, etc. referencing types from `@stigmer/protos` and
   `@stigmer/sdk`. The `externalSymbolLinkMappings` config option can map
   these to URLs (e.g., the proto-based SDK docs pages).

### Surprises

1. **No separate "hook" vs "component" distinction in TypeDoc**: Both hooks
   and React components are `kind: 64` (Function). The generator must
   distinguish them by naming convention (`use*` = hook, others = component)
   or by return type (`JSX.Element` = component).

2. **Props destructuring**: React components that destructure props have their
   parameter named `__namedParameters` instead of `props`. The generator
   must look up the type reference to find the props interface.

3. **SharedSessionFields not exported**: Some internal types referenced by
   exported types (e.g., `SharedSessionFields` used in `CreateSessionInput`)
   appear as external references rather than inline definitions. The
   generator must handle missing type definitions gracefully.

---

## Recommendations for T02 (TSDoc Audit + Guidelines)

1. **Priority: Interface summaries.** The biggest gap is missing top-level
   summaries on `*Props` and `*Return` interfaces. Adding a one-line
   `/** Props for {@link ComponentName}. */` to each props interface is
   quick and closes the largest documentation hole.

2. **Fields are in good shape.** Individual prop and return-type fields
   already have inline docs. The audit should focus on interfaces, not
   fields.

3. **`@example` coverage is strong (116/354).** Focus on adding examples to
   the remaining hooks and key utility functions, not on interfaces.

## Recommendations for T03 (MDX Generator)

1. **Domain grouping**: Use `sources[0].fileName.split('/')[0]` to determine
   the domain. Map `root` → `core`, fold `internal` → `core`, fold
   `search` → `library`.

2. **Hook vs component detection**: Use naming convention (`use*` prefix) or
   check if the return type is `JSX.Element`.

3. **Comment rendering**: Walk the `comment.summary` array, emitting `text`
   segments as-is, `code` segments as inline code, and `inline-tag` segments
   as links (resolve internal IDs from `symbolIdMap`, map externals to
   resource page URLs).

4. **Props resolution**: For components with `__namedParameters`, follow the
   type reference ID to find the props interface, then render its children
   as a TypeTable.

5. **External type links**: Configure `externalSymbolLinkMappings` in
   `typedoc.json` to map `@stigmer/protos` and `@stigmer/sdk` types to
   their existing proto-based doc pages under `/docs/sdk/resources/`.

6. **Re-exported externals**: Keep `excludeExternals: true`. For the 5
   re-exported types, the generator should render a brief mention with a
   link to the canonical resource page rather than duplicating documentation.

## Files Changed in This Task

| File | Change |
|------|--------|
| `sdk/react/package.json` | Added `typedoc@^0.28.18` devDep, added `typedoc:json` script |
| `sdk/react/typedoc.json` | New — TypeDoc configuration |
| `sdk/react/tsconfig.typedoc.json` | New — extends tsconfig.json, excludes test files |
| `sdk/react/dist/api.json` | Generated output (gitignored) |
