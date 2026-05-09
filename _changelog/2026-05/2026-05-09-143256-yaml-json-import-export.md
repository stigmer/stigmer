# YAML/JSON Import/Export for Agent and McpServer Resources

**Date**: May 9, 2026

## Summary

Added full YAML/JSON import and export capabilities for Agent and McpServer resources, exposed as headless SDK hooks and styled components in `@stigmer/react`. The Console now offers export actions on every detail page and import from the workbench toolbar — completing the "configuration as code" surface that lets users round-trip resources between the UI and file system.

## Problem Statement

Stigmer's resource management had no way to export existing Agent/McpServer configurations to files, or to import configurations from YAML/JSON files. Users who wanted to back up configurations, share them across environments, or create resources from existing manifests had no UI path — the only import mechanism was the artifact-based "Apply" flow inside execution previews.

### Pain Points

- No way to download or copy an agent's configuration as YAML for version control
- No way to create resources from existing YAML/JSON manifests without the CLI
- Platform builders had no headless import/export hooks for embedding in their products
- The existing `serializeAgentYaml`/`serializeMcpServerYaml` functions existed but were unused in the Console UI

## Solution

Built a three-layer solution following the SDK-first architecture:

1. **Headless hooks** (`useExportResource`, `useImportResource`) — framework-agnostic logic that platform builders can use independently
2. **Styled component** (`ImportResourceDialog`) — a drop-in dialog for the full import workflow
3. **Console integration** — wired into detail pages (export) and list pages (import)

## Implementation Details

### New SDK Files

| File | Purpose |
|------|---------|
| `sdk/react/src/library/useExportResource.ts` | Export hook: memoized serialization, clipboard copy with toast, file download |
| `sdk/react/src/library/useImportResource.ts` | Import hook: file reading, format detection, validation preview, apply |
| `sdk/react/src/library/ImportResourceDialog.tsx` | Styled modal with file picker, preview card, error display |

### Export Architecture (DD-T04E-001)

Export runs entirely client-side from the already-fetched proto object:
- `serializeAgentYaml`/`serializeMcpServerYaml` produce canonical YAML
- JSON is derived by parsing the YAML back to a plain object, then `JSON.stringify`
- Filenames use the resource slug: `{slug}.yaml` / `{slug}.json`
- Four stable callbacks: `copyYaml`, `copyJson`, `downloadYaml`, `downloadJson`

### Import Architecture (DD-T04E-002, DD-T04E-003)

Import reuses the existing `parseResourceYaml` validation pipeline:
- Format detection via file extension (`.json`, `.yaml`, `.yml`) with JSON parse fallback
- JSON files are converted to YAML internally for uniform validation
- Preview step shows kind, name, slug, and target org before committing
- Apply delegates to `stigmer.agent.apply()` / `stigmer.mcpServer.apply()` directly

### Console Integration

- **Detail pages**: "Export YAML", "Export JSON", "Download YAML" actions in the kebab overflow menu (new `"export"` action group)
- **List pages**: Upload icon button in the workbench toolbar, opens `ImportResourceDialog`
- Uses `useAgent`/`useMcpServer` at the page level for full proto access

### Design Decisions

- **DD-T04E-005**: Native `<dialog>` element (consistent with Phase 2's `ConfirmDialog`)
- No drag-and-drop library — HTML file picker with `accept` attribute
- Error messages follow DD-006 (what happened, why, what to do)
- Hook returns are referentially stable per DD-010
- No new dependencies — `yaml ^2.8.2` already in SDK

## Benefits

- **Users**: Export configurations for backup, sharing, or GitOps workflows
- **Users**: Import existing YAML/JSON manifests directly from the Console
- **Platform builders**: Headless hooks for custom import/export UI in their products
- **DX**: Validation preview prevents accidental bad imports
- **Architecture**: Zero new dependencies, builds on battle-tested serializer pipeline

## Impact

- **SDK public API**: 3 new exports (`useExportResource`, `useImportResource`, `ImportResourceDialog`) + 6 types
- **Console**: 4 pages modified (2 detail pages + 2 list pages)
- **Users**: Configuration as code workflow fully accessible from the Console UI
- **Platform builders**: Import/export available at the hook level for embedding

## Related Work

- Phase 1: Resource Workbench (T02) — provides the list page infrastructure
- Phase 2: Detail Hubs (T03) — provides the action bar where export lives
- Phase 3 T04-A: Creation Slot — provides the `headerAction` slot for the import button
- Future T04-B: Agent Creation Wizard — will reuse `useImportResource` for "Start from file" mode

---

**Status**: Production Ready
**Timeline**: 1 session (~30 min)
