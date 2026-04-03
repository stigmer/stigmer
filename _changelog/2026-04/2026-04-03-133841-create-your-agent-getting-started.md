# Create Your Agent — Fourth Getting Started Guide

**Date**: April 3, 2026

## Summary

Added the fourth and final Getting Started page ("Create your Agent") that introduces the Agent resource as a reusable blueprint. The page completes the primary resource vocabulary by showing how Skills, MCP Servers, and instructions bundle into a single named Agent definition, simplifying the reader's code while giving their agent a distinct role and personality.

## Problem Statement

The Getting Started documentation covered three of the four primary Stigmer resources: Skills (domain knowledge), MCP Servers (tool access), and Sessions (conversations). The Agent resource — the central concept that ties everything together — was missing. Readers were assembling skills and MCP servers per-session, duplicating configuration on every session creation call without a reusable definition or custom instructions.

### Pain Points

- No introduction to the Agent concept in the getting started flow
- Readers had no way to give their agent a personality, role, or behavioral rules
- Session creation code was a "shopping list" of skill and MCP server references, repeated on every call
- The default `assistant` agent was used implicitly without the reader knowing it existed

## Solution

Created a fourth Getting Started page that reframes the Agent as the resolution to the shopping-list problem. The page follows the same progressive tutorial structure as the existing three pages: problem statement, step-by-step creation through the web app, code simplification, and a before/after comparison.

The narrative device is the "hidden protagonist reveal" — there has always been an Agent (the default `assistant`), and this page lets the reader create their own.

## Implementation Details

### New files

- `docs/getting-started/create-agent.mdx` — Full tutorial page with four SDK language tabs (TypeScript, Go, Python, Java), live demos, before/after code comparison, difference table, and bridge to Core Concepts and Tutorials
- `site/src/components/docs/demos/scenarios/agent-creation-tour/steps.ts` — 12-step guided tour with conversation fixtures (user describes support agent, Agent Creator produces YAML definition)
- `site/src/components/docs/demos/scenarios/agent-creation-tour/index.tsx` — ScenarioPlayer component with animated Cursor overlay, following the exact pattern of the Skill and MCP Server creation tours

### Updated files

- `docs/getting-started/connect-tools.mdx` — Bridge text updated to motivate the Agent guide
- `docs/getting-started/meta.json` — Added `create-agent` to pages array
- `docs/index.mdx` — Added missing Getting Started cards (Connect your tools, Create your Agent)
- `site/src/components/docs/index.ts` — Added `DemoAgentCreationTour` export
- `site/src/components/mdx.tsx` — Registered `DemoAgentCreationTour` in MDX component map

### SDK wiring

Confirmed the session-to-agent pattern across all four SDK languages: `agent.getByReference({org, slug})` returns the Agent with `status.defaultInstanceId`, which is passed to `session.create({agentInstanceId})`. This mirrors the web app's internal `useCreateSession` hook. AgentInstance is used in code but not explained as a concept — it's treated as an opaque reference with a one-line note.

## Benefits

- Getting Started now covers all four primary resources: Skill, MCP Server, Agent, Session
- The reader's code gets simpler after this page (skill/MCP refs removed from session creation)
- The Agent's `instructions` field introduces the concept of agent personality and behavioral rules
- Clear narrative arc across all four pages: Try it → Teach it → Equip it → Name it

## Impact

- **Documentation readers** — Complete getting started journey with a natural conclusion
- **Content strategy** — All primary resource types covered; future content (tutorials, concepts) can build on this foundation
- **Product understanding** — Readers understand why Agents exist and how they simplify configuration

## Related Work

- Session 11: Phase 3 Getting Started (quickstart, first-skill)
- Session 12: Connect your tools (MCP servers, approvals)
- Session 13: Approval flow demo polish (cursor overlay, ApprovalCard)

---

**Status**: ✅ Production Ready
**Timeline**: Session 14
