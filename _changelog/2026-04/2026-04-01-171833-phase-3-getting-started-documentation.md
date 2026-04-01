# Phase 3: Getting Started Documentation

**Date**: April 1, 2026

## Summary

Delivered the complete Getting Started documentation for Stigmer: three tutorial
pages covering Cloud quickstart (web console + SDK), Local quickstart (CLI), and
Your first Skill (domain knowledge before/after). The Cloud quickstart embeds
live `@stigmer/react` components backed by demo fixture data, marking the first
use of the demo mode infrastructure in production documentation.

## Problem Statement

Stigmer had no onboarding documentation. The docs site served only a landing
page with placeholder routing cards. New users — whether evaluating via the web
console or building locally with the CLI — had no guided path from zero to a
working agent with domain expertise.

### Pain Points

- No getting-started content existed despite a fully built sales website
- The "aha moment" (agent answering with domain knowledge vs generic responses)
  had no documentation walkthrough
- Two distinct user paths (Cloud-first vs local-first) had no dedicated tutorials
- The recently built `@stigmer/react/demo` infrastructure had no consumer yet

## Solution

Three progressive tutorials forming a complete onboarding funnel:

1. **Cloud quickstart** (`quickstart.mdx`, ~10 min) — Sign up, create a Skill
   through the web console (with embedded demo components), install the SDK,
   call the agent from TypeScript code.

2. **Local quickstart** (`local.mdx`, ~5 min) — Install via Homebrew, start the
   server, write an Agent YAML, apply and run from the terminal.

3. **Your first Skill** (`first-skill.mdx`, ~10 min) — Create a SKILL.md with
   domain knowledge, push it, attach it to an agent, and see the before/after
   difference. The positioning document's "aha moment" in tutorial form.

## Implementation Details

### Documentation pages

- Created `docs/getting-started/` with sidebar ordering via `meta.json`
- All commands verified against CLI source (e.g., `stigmer run` uses `-m` flag
  for messages, not positional args)
- Agent YAML `skill_refs` format verified against proto definitions
- SKILL.md frontmatter verified against `seedpack/skills/` examples

### Demo infrastructure

- Built `skill-creation.ts` scenario: 4-message conversation, return-policy
  artifact, `getArtifactContent` fixture for artifact rendering
- Built `DemoSkillCreation.tsx` MDX wrapper using `MessageThread` + `StigmerProvider`
- Registered in MDX component system for `<DemoSkillCreation />` usage in MDX

### SDK boundary cleanup

- Moved all demo scenarios from `sdk/react/src/demo/scenarios/` to
  `site/src/components/docs/demos/scenarios/` — scenarios are docs-specific
  narrative content, not generic SDK tooling
- Audited remaining SDK demo module: all generic infrastructure (`DemoTransport`,
  `createDemoClient`, `fixtures`, `samples`) correctly stays in SDK

### Housekeeping

- Renamed "self-hosted" → "local" across IA document (7 occurrences),
  CONTRIBUTING.md (2), and OpenSource.tsx CTA
- Marked vocabulary inconsistency #3 as RESOLVED
- Cleaned up `docs/scratch/` validation directory from sub-project

## Benefits

- Users can go from zero to a running agent with domain expertise in 5–10 minutes
- Two clear paths match the positioning: Cloud-primary for evaluators, local for
  developers who prefer CLI-first
- The before/after Skill tutorial directly demonstrates Stigmer's core value
  proposition
- Demo components in docs show real product UI without requiring a live backend

## Impact

- **Users**: First guided onboarding experience for the platform
- **Sales site**: Getting Started CTAs now resolve to real content instead of
  falling back to `/docs`
- **SDK**: Demo mode gets its first production consumer, validating the
  architecture
- **Content strategy**: Phase 3 of 7 complete; foundation laid for progressive
  tutorial path

## Related Work

- Prerequisite: `2026-04-01-151243-react-demo-mode-transport-and-client-factory.md`
- Prerequisite: `2026-04-01-154201-react-demo-mode-composable-fixture-infrastructure.md`
- Prerequisite: `2026-04-01-164227-react-demo-mode-fumadocs-integration.md`
- Foundation: Phase 1 positioning document, vocabulary guide, information architecture
- Foundation: Phase 2 sales website (CTA targets)
- Next: Phase 4 Core Concepts documentation

---

**Status**: ✅ Production Ready
**Timeline**: ~3 hours (including sub-project demo mode prerequisite)
