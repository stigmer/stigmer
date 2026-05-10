# Skill Upload + File Browser (Phase 3 T04-C Revised)

**Date**: May 9, 2026

## Summary

Replaced the in-browser Skill Markdown editor with an upload-only creation flow and a file tree browser for viewing skill package contents. Skills are Anthropic Agent Skills spec directories — users author them locally and upload the finished ZIP package through the Console.

## Problem Statement

The initial T04-C implementation built an in-browser Markdown editor, which was wrong: it treated skills as single files when they're actually directory packages. Users should author skills in their IDE with proper tooling (linters, formatters, testing) and upload the finished package. The Console's job is upload + view, not authoring.

### Pain Points (with the editor approach)

- Encouraged creating incomplete skills (SKILL.md only, missing bundled resources)
- No way to include scripts, reference docs, or templates in web-created skills
- Conflated the Console's role (management) with an IDE's role (authoring)
- Users couldn't see the full contents of multi-file skills they'd uploaded via CLI

## Solution

Upload-only creation + full-package file browser:

1. **Upload flow**: Drag-and-drop ZIP → validate (SKILL.md exists, frontmatter valid) → preview (name, description, file listing, rendered SKILL.md) → confirm → push
2. **File browser on detail page**: Fetches the skill artifact ZIP, unpacks it, renders a navigable file tree with content viewer (Markdown rendered for .md, raw code for others)

## Implementation Details

**Removed:**
- `SkillEditor.tsx` (in-browser Markdown editor)
- `useSkillEditor.ts` (editor behavior hook)
- `SkillEditPage.tsx` + edit route (no more web editing)
- "Edit" primary action from skill detail page

**New SDK modules (`@stigmer/react`):**
- `usePushSkill.ts` — rewritten to accept raw `Uint8Array` ZIP bytes directly
- `useSkillUpload.ts` — upload validation hook (ZIP magic bytes check, SKILL.md extraction, frontmatter parsing, Anthropic spec validation: name format/length, description length)
- `SkillUploader.tsx` — two-phase component (drop zone → preview + confirm), drag-and-drop with visual feedback
- `useSkillArtifact.ts` — data hook fetching skill ZIP via `getArtifact` RPC using `status.artifactStorageKey`, unpacks with fflate
- `SkillFileBrowser.tsx` — file tree + content viewer split pane (Markdown rendered for .md, raw code for scripts/other)

**Console changes:**
- `/library/skills/new` → `SkillNewPage` mounts `SkillUploader` (upload flow)
- `SkillListPage` button text changed to "Upload skill"
- `SkillDetailView` uses `SkillFileBrowser` when `artifactStorageKey` is available

## Benefits

- Users see the full contents of any skill package (not just SKILL.md)
- Upload flow validates against Anthropic spec before push (catches errors early)
- No confusion about what skills are — they're packages, not web documents
- `fflate` dependency now used for decompression only (reading), not creation
- Platform builders get headless hooks for custom upload UIs (`useSkillUpload`, `usePushSkill`)

## Impact

- Users: Clear mental model — author locally, upload to Stigmer, browse contents on web
- UX: Removed a feature (editor) that would have confused users about what skills are
- SDK: 4 new public exports (2 hooks, 2 components), removed 6 editor-related exports

## Related Work

- Phase 3 T04-C (original): Skill Editor with Preview (replaced by this)
- Phase 3 T04-E: YAML/JSON Import/Export (similar upload pattern for agents/MCP servers)

---

**Status**: ✅ Production Ready
**Timeline**: 1 session (revision of prior session's work)
