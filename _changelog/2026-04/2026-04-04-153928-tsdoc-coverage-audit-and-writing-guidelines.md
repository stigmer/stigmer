# TSDoc Coverage Audit and Writing Guidelines for React SDK

**Date**: April 4, 2026

## Summary

Built a reusable TSDoc coverage analysis toolchain, ran a comprehensive audit across all 361 React SDK exports, established writing guidelines as the standard for TSDoc backfill and future contributions, and configured TypeDoc validation for lightweight enforcement. This work completes T02 in the React SDK docs auto-generation sub-project.

## Problem Statement

The React SDK (`@stigmer/react`) has 361 public exports across 17 domains — 67 hooks, 94 components, 159 interfaces, 31 type aliases, and 10 variables. T01 established that TypeDoc produces usable JSON, but the overall TSDoc coverage was only 57.6%. Before building the MDX generator (T03) or backfilling documentation (T05), the team needed:

- A clear picture of exactly where the gaps are
- A standard defining what "fully documented" means for each export type
- Tooling to measure progress during backfill
- Lightweight enforcement to prevent regression

### Pain Points

- No way to measure TSDoc coverage systematically — only manual inspection
- No established standard for what constitutes complete documentation on hooks, components, and interfaces
- No enforcement mechanism to catch missing documentation
- No prioritized backfill order to guide future work

## Solution

Five deliverables: a coverage analysis script, a comprehensive audit, writing guidelines, TypeDoc validation configuration, and a prioritized domain backfill order.

## Implementation Details

### Coverage Analysis Script

Created `sdk/react/scripts/tsdoc-coverage.ts` — a TypeScript script that reads TypeDoc's JSON output and produces structured markdown reports. Classifies each export as hook, component, props interface, return interface, other interface, type alias, or variable. Groups by domain using source file paths. Supports `--undocumented` and `--fields` flags for detailed breakdowns.

Added `tsx` as a devDependency for script execution. Script handles both src-relative and monorepo-relative paths (TypeDoc produces different formats depending on configuration).

### Audit Findings

The audit revealed a surgical gap: functions (hooks + components) are at 98.8% coverage, while interfaces are at 13.2%. The overall 57.6% is dragged down entirely by interfaces.

- **Props Interfaces**: 1 of 57 documented (1.8%)
- **Return Interfaces**: 0 of 60 documented (0.0%)
- **Other Interfaces**: 20 of 42 documented (47.6%)
- **Hooks**: 67 of 67 documented (100.0%)
- **Components**: 92 of 94 documented (97.9%)

116 of the 150 undocumented exports need only a formulaic one-line summary. The real authoring work is ~22 "Other Interfaces" needing genuine descriptions.

### TSDoc Writing Guidelines

Created `coding-guidelines/tsdoc-standards.md` defining the writing register (aligned with the Document Writer role's "Reference / SDK" context), required tags per export type, good/bad examples pulled from the actual codebase, field templates for the standard `{ data, isLoading, error, refetch }` pattern, and patterns for tricky cases (external `{@link}` references, callback props, union types).

### TypeDoc Validation

Configured `validation.notDocumented: true` with `requiredToBeDocumented` covering Variable, Function, Interface, Property, and TypeAlias. TypeDoc now emits 615 warnings (554 missing-doc + 61 external link warnings). JSON generation is not blocked. Added `tsdoc:check` script for future CI enforcement.

## Benefits

- **Measurable progress**: The coverage script produces consistent, comparable reports across sessions
- **Clear standard**: Every contributor knows exactly what "fully documented" means for each export type
- **Focused backfill**: The audit shows that 77% of undocumented exports need only a one-line formulaic comment — the backfill is mechanical, not creative
- **Regression prevention**: TypeDoc validation catches new undocumented exports at generation time
- **Informed prioritization**: Backfill effort is directed at the highest-value domains first

## Impact

- **T03 (MDX generator)**: Now has clear expectations for what TSDoc will be available to render
- **T05 (backfill)**: Has a prioritized domain order, effort estimates, and field templates to follow
- **Future SDK contributors**: Have a reference standard and measurement tool for documentation quality
- **CI pipeline (T04)**: Has a `tsdoc:check` script ready to integrate

## Related Work

- T01: TypeDoc setup + proof of concept (prerequisite)
- T03: MDX generator script (unblocked by T02)
- T05: TSDoc backfill for priority domains (guided by T02's prioritization)
- Parent project: 20260403.03.sdk-docs-auto-generation

---

**Status**: Production Ready
**Timeline**: ~3 hours
