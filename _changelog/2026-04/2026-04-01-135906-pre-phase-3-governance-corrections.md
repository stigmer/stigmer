# Pre-Phase 3 Governance Corrections

**Date**: April 1, 2026

## Summary

Applied three corrections to the document writer role and updated the docs contribution guide to align with the information architecture defined during Phase 1. These changes resolve the audience-definition conflict between governance files and prepare the documentation structure for Phase 3 content authoring.

## Problem Statement

The information architecture (Phase 1, deliverable 5) identified misalignments between three governance files that would cause problems during Phase 3 documentation writing.

### Pain Points

- The document writer role applied a blanket "write for a non-technical person" standard that conflicted with the style guide's assumption that readers are comfortable with APIs and CLIs. Writers following the role literally would avoid technical language even in SDK reference docs.
- The Diataxis content-type rule could be misread as a navigation rule, conflating page types with sidebar organization.
- The infrastructure-analogy prohibition was too broad, preventing useful Kubernetes/Docker comparisons in architecture and contributor documentation where they aid understanding.
- The docs contribution guide listed 9 content directories, but Phase 0 cleanup and Phase 1 restructuring reduced this to 6. Contributors following the old guide would create files in non-existent directories.

## Solution

Two targeted file updates, each making surgical changes to specific sections without rewriting the full files.

## Implementation Details

### Document writer role (`_roles/002_document_writer.md`)

1. **Context-sensitive register**: Replaced the monolithic "one rule that overrides everything" section with a framework that references the vocabulary guide's five writing contexts. Plain language remains the default when context is unclear, but reference/SDK docs are explicitly acknowledged as using precise technical language.
2. **Diataxis scope note**: Added a one-line clarification that the four content types govern page content, not sidebar navigation.
3. **Infrastructure-analogy scoping**: Changed the blanket prohibition to apply only to sales site and introductory docs (quickstart, tutorials, concepts). Architecture and contributor docs may use such references.

### Docs contribution guide (`docs/CONTRIBUTING.md`)

1. **Content architecture table**: Replaced 9-directory listing with 6 directories matching the IA (`getting-started/`, `concepts/`, `tutorials/`, `sdks/`, `cli/`, `reference/`).
2. **Removed `_archive/` reference**: The directory was deleted during Phase 0.
3. **Updated `meta.json` example**: Changed fictional page names to IA-actual pages (`quickstart`, `self-hosted`, `first-skill`).
4. **Added non-rendered files note**: Lists the `.md` files that remain in `docs/` but are excluded from the sidebar.

## Benefits

- Writers (human or AI) now get consistent guidance across governance files — no more conflicting audience definitions
- The docs contribution guide accurately reflects the directory structure contributors will encounter
- Phase 3 documentation work can begin without governance misalignments causing inconsistencies

## Impact

- **Document writers**: Clearer guidance on when to use plain vs technical language
- **Contributors**: Accurate directory structure and meta.json examples
- **Phase 3 readiness**: Both pre-Phase 3 prerequisites are now complete
- **Vocabulary inconsistency #3**: Resolved (audience conflict between document writer role and STYLE.md)

## Related Work

- Phase 1: Information architecture (IA Section 6, maintenance notes)
- Phase 1: Vocabulary guide (inconsistency register, item #3)
- Phase 2: Sales website content (completed in Session 8)

---

**Status**: Complete
**Timeline**: Session 9 (2026-04-01)
