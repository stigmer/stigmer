# Task T02: Execution Log — TSDoc Coverage Audit + Writing Guidelines

**Started**: 2026-04-04
**Status**: IN PROGRESS
**Plan**: T01_0_plan.md (T02 section)

## Step 1: Coverage Analysis Tooling

Created `sdk/react/scripts/tsdoc-coverage.ts` — a reusable TypeScript script
that reads the TypeDoc JSON output and produces structured coverage reports.

**Files created/modified:**

| File | Change |
|------|--------|
| `sdk/react/scripts/tsdoc-coverage.ts` | New — coverage analysis script |
| `sdk/react/package.json` | Added `tsx` devDep, `tsdoc:coverage` script |

**Usage:**

```bash
cd sdk/react
npm run tsdoc:coverage                    # summary report
npm run tsdoc:coverage -- --undocumented  # include undocumented exports list
npm run tsdoc:coverage -- --fields        # include interface field coverage
npm run tsdoc:coverage -- --undocumented --fields  # full report
```

**Classification logic:**

- Hook = Function (kind 64) with name starting with `use`
- Component = Function (kind 64) not starting with `use`
- Props Interface = Interface with name ending in `Props`
- Return Interface = Interface with name matching `Use*Return`
- Domain = `sources[0].fileName.split('/')[0]`, with `root` → `core`,
  `internal` → `core`, `search` → `library`

---

## Step 2: Audit Results

### Overall Summary

| Metric | Value |
|--------|-------|
| Total exports | 354 |
| Documented (has summary) | 204 (57.6%) |
| With @example | 116 (32.8%) |

### Coverage by Category

| Category | Count | Documented | Doc % | Examples | Ex % |
|----------|------:|----------:|------:|---------:|-----:|
| Hooks | 67 | 67 | 100.0% | 55 | 82.1% |
| Components | 92 | 90 | 97.8% | 61 | 66.3% |
| Props Interfaces | 57 | 1 | 1.8% | 0 | 0.0% |
| Return Interfaces | 60 | 0 | 0.0% | 0 | 0.0% |
| Other Interfaces | 42 | 20 | 47.6% | 0 | 0.0% |
| Type Aliases | 29 | 22 | 75.9% | 0 | 0.0% |
| Variables | 7 | 4 | 57.1% | 0 | 0.0% |

### Coverage by Domain

| Domain | Exports | Documented | Doc % | Hooks | Comps | Ifaces | Iface Doc % |
|--------|--------:|----------:|------:|------:|------:|-------:|------------:|
| execution | 88 | 53 | 60.2% | 7 | 43 | 34 | 5.9% |
| mcp-server | 37 | 19 | 51.4% | 8 | 6 | 18 | 11.1% |
| environment | 37 | 23 | 62.2% | 9 | 8 | 19 | 26.3% |
| agent | 29 | 16 | 55.2% | 6 | 3 | 11 | 0.0% |
| library | 29 | 22 | 75.9% | 4 | 10 | 9 | 22.2% |
| session | 29 | 16 | 55.2% | 10 | 1 | 17 | 23.5% |
| skill | 15 | 6 | 40.0% | 4 | 2 | 7 | 0.0% |
| workspace | 13 | 5 | 38.5% | 2 | 3 | 8 | 0.0% |
| github | 13 | 8 | 61.5% | 3 | 1 | 8 | 37.5% |
| api-key | 12 | 6 | 50.0% | 3 | 3 | 6 | 0.0% |
| attachment | 11 | 8 | 72.7% | 1 | 4 | 4 | 25.0% |
| agent-instance | 9 | 5 | 55.6% | 4 | 0 | 5 | 20.0% |
| models | 9 | 3 | 33.3% | 1 | 1 | 3 | 0.0% |
| core | 8 | 6 | 75.0% | 3 | 2 | 2 | 0.0% |
| composer | 6 | 3 | 50.0% | 1 | 1 | 4 | 25.0% |
| error | 5 | 3 | 60.0% | 0 | 3 | 2 | 0.0% |
| organization | 4 | 2 | 50.0% | 1 | 1 | 2 | 0.0% |

### Hook Documentation Depth

| Metric | Count | Percentage |
|--------|------:|----------:|
| Has summary | 67 | 100.0% |
| Has @param docs | 31 | 46.3% |
| Has @returns tag | 1 | 1.5% |
| Has @example | 55 | 82.1% |

### Key Findings

#### 1. The gap is entirely in interfaces

Functions (hooks + components) are at **98.7%** coverage. The overall
57.6% is dragged down entirely by interfaces:

- **Props Interfaces**: 1 of 57 documented (1.8%)
- **Return Interfaces**: 0 of 60 documented (0.0%)
- **Other Interfaces**: 20 of 42 documented (47.6%)

The pattern is consistent across every domain: hooks and components have
detailed TSDoc, but their associated `*Props` and `*Return` interfaces
do not have top-level summaries.

#### 2. Interface fields are better than interface summaries

Many interfaces have field-level documentation despite missing a
top-level summary. For example, `UseExecutionStreamReturn` has no
interface-level `/** ... */` but all 6 fields are documented. The
backfill for these cases is a single line: adding
`/** Return value of {@link useExecutionStream}. */` above the
`export interface` declaration.

However, 48 interfaces have <50% field-level coverage, and 37 of those
have 0% (no field docs at all). These need more substantial work.

#### 3. @param is documented inconsistently

Only 31 of 67 hooks (46.3%) have any parameter documentation. In
TypeDoc's output, `@param` tags appear as comments on
`signatures[0].parameters[i].comment` rather than as `blockTags`. Most
hooks have descriptive parameter names (`sessionId`, `org`, `slug`) that
are somewhat self-documenting, but this is still a gap for the generated
reference pages.

#### 4. @returns is essentially absent

Only 1 of 67 hooks has a `@returns` tag. This is low priority because:
(a) the return type name is always visible in the signature, and (b)
the return interface's fields describe what's returned. Adding `@returns`
tags is nice-to-have, not critical.

#### 5. @example coverage is strong where it matters

55 of 67 hooks (82.1%) have `@example` blocks. 61 of 92 components
(66.3%) have examples. The missing examples are mostly on small utility
components rather than primary domain components.

#### 6. Two components lack documentation entirely

`McpArgsView` and `McpMetadataRow` in `execution/McpToolDetail.tsx` are
the only undocumented functions. These are small presentational
components co-located with `McpToolDetail`.

### Undocumented Exports: 150 Total

Breakdown by category:

| Category | Undocumented | Total | % Missing |
|----------|------------:|------:|----------:|
| Props Interfaces | 56 | 57 | 98.2% |
| Return Interfaces | 60 | 60 | 100.0% |
| Other Interfaces | 22 | 42 | 52.4% |
| Type Aliases | 7 | 29 | 24.1% |
| Variables | 3 | 7 | 42.9% |
| Components | 2 | 92 | 2.2% |
| Hooks | 0 | 67 | 0.0% |

The 150 undocumented exports break down into tiers:

**Tier A — Mechanical backfill (116 items):**
Props Interfaces (56) and Return Interfaces (60) each need a one-line
top-level summary. These are formulaic and quick:
- `/** Props for {@link ComponentName}. */`
- `/** Return value of {@link useHookName}. */`

**Tier B — Light authoring (22 items):**
Other Interfaces need a meaningful top-level summary describing what the
type represents. Examples: `CreateAgentExecutionInput`,
`GitHubConnectOptions`, `FolderEntry`.

**Tier C — Minor gaps (12 items):**
Type aliases (7), variables (3), and components (2) with missing docs.
These are small and isolated.

### Interfaces with <50% Field-Level Coverage: 48 Total

37 interfaces have 0% field coverage (no field docs at all). Most are
Return Interfaces with the standard `session`, `isLoading`, `error`,
`refetch` shape — once the guideline defines the pattern for these
fields, backfill is formulaic.

11 interfaces have partial field coverage (1-49%). These need targeted
attention to fill in the remaining fields.

---

## Step 3: TSDoc Writing Guidelines

Created `coding-guidelines/tsdoc-standards.md` — the reference standard
for TSDoc backfill and future SDK contributions.

**Covers:**

- Writing register (aligned with Document Writer role's "Reference / SDK"
  context from `docs/vocabulary.md`)
- Required tags per export type: hooks, components, props interfaces,
  return interfaces, other interfaces, type aliases, variables
- Good/bad examples pulled from the actual codebase
- Patterns for tricky cases: `{@link}` to external types, callback props,
  union types, `__namedParameters`, standard data hook shape
- Coverage targets per category
- Field templates for the standard `{ data, isLoading, error, refetch }`
  return interface shape

---

## Step 4: TypeDoc Validation Configuration

Updated `sdk/react/typedoc.json` with validation flags:

```json
{
  "validation": {
    "notExported": true,
    "invalidLink": true,
    "notDocumented": true,
    "unusedMergeModuleWith": true
  },
  "requiredToBeDocumented": [
    "Variable",
    "Function",
    "Interface",
    "Property",
    "TypeAlias"
  ]
}
```

**What this does:**

- TypeDoc now emits warnings for every undocumented export and every
  undocumented interface field. Current run shows 615 warnings (61
  external link warnings + 554 missing-doc warnings).
- JSON generation is NOT blocked — warnings are informational.
- `treatValidationWarningsAsErrors` is NOT set. It will be enabled in
  T04 (CI integration) once backfill reaches target coverage.

**Scripts added:**

- `npm run tsdoc:check` — runs TypeDoc with
  `--treatValidationWarningsAsErrors`, failing on any missing docs.
  Currently fails (expected). Will pass after T05/T07 backfill.

---

## Step 5: Domain Prioritization for Backfill

### Prioritization Criteria

1. **User-facing importance**: Which domains do platform builders use
   most when building with the React SDK?
2. **Generator test fixture**: Which domains are best for developing
   and testing the MDX generator (T03)?
3. **Export count**: Larger domains yield more value per backfill session.
4. **Current state**: How much work remains?

### Recommended Backfill Order

#### T05: Priority domains (5 domains, 191 exports)

| Priority | Domain | Exports | Undoc | Why |
|----------|--------|--------:|------:|-----|
| 1 | session | 29 | 13 | Core user-facing domain. Every app needs sessions. Good T03 test fixture — has hooks, 1 component, rich interfaces. |
| 2 | execution | 88 | 35 | Largest domain. MessageThread, ApprovalCard, ToolCallGroup — the conversation UI. Critical for demos. |
| 3 | agent | 29 | 13 | Agent blueprint CRUD. AgentDetailView is a key detail component. |
| 4 | composer | 6 | 3 | SessionComposer is the primary input mechanism. Small domain, quick win. |
| 5 | core | 8 | 2 | StigmerProvider and deployment mode. Entry point for every app. Only 2 undocumented (both Props Interfaces). |

**Rationale**: These 5 domains cover the core loop (create session →
send message → stream execution → display results) plus the provider
setup. Together they represent 54% of all exports and contain the most
user-facing components. Session is first because it's the smallest of
the critical domains and makes a good T03 test fixture.

#### T07: Remaining domains (12 domains, 163 exports)

| Priority | Domain | Exports | Undoc | Notes |
|----------|--------|--------:|------:|-------|
| 6 | mcp-server | 37 | 18 | Second largest. MCP setup flow is important. |
| 7 | environment | 37 | 14 | Secret management is a key feature. |
| 8 | skill | 15 | 9 | Skill CRUD and detail view. |
| 9 | library | 29 | 7 | Resource listing, scope toggle. Already at 75.9%. |
| 10 | api-key | 12 | 6 | API key management panel. |
| 11 | agent-instance | 9 | 4 | Runtime instance management. |
| 12 | workspace | 13 | 8 | Workspace file browser. |
| 13 | github | 13 | 5 | GitHub integration. |
| 14 | attachment | 11 | 3 | File attachments. Already at 72.7%. |
| 15 | models | 9 | 6 | Model registry and selector. |
| 16 | organization | 4 | 2 | Org creation. Small. |
| 17 | error | 5 | 2 | Error display. Small. |

### Backfill Effort Estimate

| Work type | Count | Est. per item | Total |
|-----------|------:|:-------------:|------:|
| Props Interface one-liner | 56 | 30 seconds | ~30 min |
| Return Interface one-liner | 60 | 30 seconds | ~30 min |
| Return Interface field docs (standard shape) | ~37 | 2 min | ~75 min |
| Other Interface summaries | 22 | 3 min | ~65 min |
| Other Interface field docs | ~11 | 5 min | ~55 min |
| Missing @param tags (36 hooks) | 36 | 2 min | ~70 min |
| Type aliases & variables | 10 | 2 min | ~20 min |
| Components (2 undocumented) | 2 | 5 min | ~10 min |
| **Total** | | | **~6 hours** |

The T05 priority domains account for roughly 40% of the effort.

---

## Files Changed in This Task

| File | Change |
|------|--------|
| `sdk/react/scripts/tsdoc-coverage.ts` | New — coverage analysis script |
| `sdk/react/package.json` | Added `tsx` devDep, `tsdoc:coverage` and `tsdoc:check` scripts |
| `sdk/react/typedoc.json` | Added `validation` and `requiredToBeDocumented` config |
| `_projects/.../coding-guidelines/tsdoc-standards.md` | New — TSDoc writing guidelines |
| `_projects/.../tasks/T02_1_execution.md` | This file |

## Status

**T02 COMPLETE**. All deliverables produced:

1. Coverage analysis script (reusable, produces structured reports)
2. Full audit with per-domain and per-category breakdowns
3. TSDoc writing guidelines with required tags, examples, and templates
4. TypeDoc validation configured (warns on missing docs)
5. Prioritized backfill order for T05 and T07

**Next**: T03 (MDX generator script) and T05 (TSDoc backfill) can now
proceed in parallel.
