# Task T02: Open-Source Getting Started Path

**Created**: 2026-04-16
**Status**: PENDING
**Type**: Content

## Objective

Make the open-source/local getting-started path a first-class citizen in the docs site. Currently `local.mdx` exists but is hidden from navigation and its journey dead-ends into cloud-only tutorials.

## Context

### Current Problem
- `local.mdx` is not in `docs/getting-started/meta.json` (not in sidebar)
- `local.mdx` is not on `docs/index.mdx` homepage cards
- `local.mdx` links to "First Skill" as next step, but `first-skill.mdx` requires cloud prerequisites (app.stigmer.ai, API key)
- OSS users visiting the docs see only the cloud path

### Approach: Dual-Track with Tabs
Keep one page per concept. Wrap path-specific instructions in `<Tabs>` so both Cloud and Local users follow the same progressive journey.

## Task Breakdown

### Step 1: Make Local Visible in Navigation
- Add `"local"` to `docs/getting-started/meta.json` right after `"quickstart"`
- Add a Local Quickstart card to `docs/index.mdx` alongside the existing Quickstart card

### Step 2: Add Cross-Reference Callouts
- Add callout to top of `quickstart.mdx`: "Want to run locally without a cloud account? See Local Quickstart."
- Add callout to top of `local.mdx`: "Want managed cloud? See Cloud Quickstart."

### Step 3: Add Cloud/CLI Tabs to Tutorials
For `first-skill.mdx`, `connect-tools.mdx`, and `create-agent.mdx`:
- Keep concept explanations shared (same regardless of backend)
- Wrap how-to steps in `<Tabs items={["Cloud (Web + SDK)", "Local (CLI)"]}>` 
- Write CLI/YAML equivalents for each cloud tutorial step
- Ensure `local.mdx` next-step links work (point to `first-skill` which now has a Local tab)

### Step 4: Validate the Full Local Journey
- Walk through the complete path: local.mdx → first-skill (CLI tab) → connect-tools (CLI tab) → create-agent (CLI tab)
- Ensure every CLI command referenced actually works
- Ensure no step assumes cloud account or web app

## Success Criteria

- [ ] `local` appears in getting-started sidebar
- [ ] Local Quickstart card on docs homepage
- [ ] Cross-reference callouts on both quickstart pages
- [ ] `first-skill.mdx`, `connect-tools.mdx`, `create-agent.mdx` have Cloud/CLI tabs
- [ ] Full local journey works end-to-end without cloud prerequisites

## Files Touched

- `docs/getting-started/meta.json`
- `docs/index.mdx`
- `docs/getting-started/quickstart.mdx`
- `docs/getting-started/local.mdx`
- `docs/getting-started/first-skill.mdx`
- `docs/getting-started/connect-tools.mdx`
- `docs/getting-started/create-agent.mdx`

## Dependencies

None — can be done in parallel with T01.
