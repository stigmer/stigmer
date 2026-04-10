# Vendor 7 Skills from anthropics/skills into Seedpack

**Date**: April 10, 2026

## Summary

Expanded the Stigmer seedpack from 3 meta-authoring skills to 10 total skills by vendoring 7 general-purpose skills from `anthropics/skills` (Apache 2.0). This is the first step toward populating the skills marketplace with high-quality, curated skills that demonstrate Pillar 1 (Knows Your Business). Also fixed a latent bug in the multi-skill vendoring script.

## Problem Statement

The seedpack only contained 3 skills (skill-creator, agent-creator, mcp-server-creator), all focused on meta-authoring within the Stigmer platform. No general-purpose skills existed, which undermined the platform's value proposition for end users who need practical, domain-relevant agent capabilities out of the box.

### Pain Points

- New users saw only authoring tools, not practical skills they could use immediately
- The skills marketplace appeared empty for general-purpose use cases
- Pillar 1 ("Knows Your Business") had no supporting content in the seedpack
- The vendoring infrastructure had never been tested with more than one skill

## Solution

Vendored 7 Apache 2.0 skills from the `anthropics/skills` repository (114k stars) using the existing vendoring infrastructure, covering development, enterprise, and creative use cases. Conducted a full license audit of all 17 upstream skills before selecting candidates.

## Implementation Details

### Skills Vendored

| Skill | Category | Content |
|-------|----------|---------|
| brand-guidelines | Enterprise | Brand consistency guide creation |
| canvas-design | Creative | Visual art/poster design with 80+ bundled fonts |
| claude-api | Development | Anthropic API usage across 7 languages |
| frontend-design | Development | Production-grade frontend interfaces |
| internal-comms | Enterprise | Internal communication writing |
| web-artifacts-builder | Development | Interactive web artifacts with React/Vite |
| webapp-testing | Development | Automated UI testing with Playwright |

All pinned to commit `12ab35c2eb5668c95810e6a6066f40f4218adc39`.

### License Audit Results

- **Apache 2.0 (vendored)**: 7 skills above + skill-creator (re-vendored)
- **Source-available (skipped)**: docx, pdf, pptx, xlsx -- Anthropic license explicitly prohibits redistribution
- **No license (skipped)**: doc-coauthoring -- missing LICENSE.txt and license frontmatter; tracked as follow-up
- **Too niche (skipped)**: algorithmic-art, slack-gif-creator, theme-factory
- **Overlapping (skipped)**: mcp-builder (overlaps with existing mcp-server-creator)

### Bug Fix: Multi-Skill Vendoring

`01_vendor_skill.sh` had a latent bug: the `vendor_skill` function used `cd` to enter the temp clone directory, then deleted that directory at function end. On subsequent iterations, the shell's working directory no longer existed, causing all git operations to fail. Fixed by replacing `cd` + `git checkout` with `git -C` (3 lines changed). This bug never manifested because only one skill was ever in the vendor manifest.

### Files Changed

- `seedpack/tools/vendor-sources.json` -- 7 new skill entries, skill-creator SHA updated
- `seedpack/tools/01_vendor_skill.sh` -- `cd` replaced with `git -C` for directory-safe vendoring
- `seedpack/skills/` -- 7 new skill directories with SKILL.md, LICENSE.txt, provenance.json each

## Benefits

- Seedpack now ships 10 skills covering meta-authoring, development, enterprise, and creative domains
- Every vendored skill has full provenance tracking (source repo, commit SHA, per-file SHA-256 digests)
- Vendor script now correctly handles multi-skill manifests
- License compliance is clean -- every vendored skill has explicit Apache 2.0 grant

## Impact

- **End users**: Seedpack bootstrap provides immediately useful skills across multiple domains
- **Skills marketplace**: 7 new entries demonstrating the breadth of the platform
- **CLI binary size**: ~6 MB increase (primarily canvas-design fonts); accepted as trade-off for now

## Related Work

- Companion project: Curated MCP Marketplace (`20260410.01`)
- Next: Self-compose 5 domain skills (Task 2) and create composite agents (Task 3)
- Follow-up: Revisit doc-coauthoring if Anthropic adds license; optimize canvas-design font size

---

**Status**: In Progress (Task 1 of 3 complete)
**Timeline**: Task 1 completed in one session
