# Agent Creation Wizard — 3-Step Condensed Flow

**Date**: May 9, 2026

## Summary

Built a complete multi-step agent creation wizard as an SDK-first component in `@stigmer/react`, plus shared wizard infrastructure that future creation flows (MCP Server, etc.) will reuse. The wizard condenses the original 7-step design into 3 condensed steps based on UX analysis: Identity & Instructions, Capabilities, and Review & Create. Users can now create agents visually from the Console at `/library/agents/new`.

## Problem Statement

The only way to create agents was through the AI chat flow (`/?draft=agent`) or CLI (`stigmer apply`). There was no form-based creation path in the Console or SDK — a significant gap for users who know exactly what they want to configure.

### Pain Points

- No visual creation flow for users who prefer forms over chat
- No shared wizard infrastructure for the platform's multiple creation flows
- Platform builders embedding `@stigmer/react` had no creation component to offer their users
- The existing "Add Agent" button routed to the AI draft session — no manual alternative

## Solution

A 3-step condensed wizard architecture with shared infrastructure:

1. **Shared `resource-creation/` module** — Generic `WizardShell`, `StepIndicator`, `WizardNav`, and `useWizardState` hook (reducer-based state machine). Resource-agnostic — reusable by T04-D (MCP Server wizard) and future flows.

2. **`AgentCreationWizard` component** — Composes the shared infrastructure with 3 agent-specific steps. Embeddable by platform builders (zero Console dependencies).

3. **Console route** — `/library/agents/new` page mounting the wizard with navigation callbacks.

## Implementation Details

### Architecture Decisions

- **DD-T04B-001**: Wizard is CREATE-only (editing is a separate future concern with different UX needs)
- **DD-T04B-002**: 3 steps instead of 7 — based on Hick's Law, Jakob's Law, and the reality that `AgentInput` has only `name`+`org` as required fields
- **DD-T04B-003**: Sub-agents excluded (advanced topology concept, power users use YAML import)
- **DD-T04B-004**: Wizard state in `useReducer` with per-step data slices
- **DD-T04B-005**: `WizardShell` is resource-agnostic
- **DD-T04B-006**: `useCreateAgent` is standalone (usable without the wizard)

### Key Discovery

`AgentSpec` proto has **no model field** — model selection is a runtime concern at the execution/instance level, not a blueprint property. This eliminated an entire wizard step from the original plan and validated the condensed 3-step approach.

### New Files (12)

| File | Purpose |
|------|---------|
| `sdk/react/src/resource-creation/types.ts` | `WizardStepDef`, `WizardState`, `WizardShellProps` |
| `sdk/react/src/resource-creation/useWizardState.ts` | Generic reducer state machine for wizard navigation |
| `sdk/react/src/resource-creation/WizardShell.tsx` | Responsive wizard layout (sidebar + content + nav) |
| `sdk/react/src/resource-creation/WizardNav.tsx` | Back/Next/Create navigation footer |
| `sdk/react/src/resource-creation/StepIndicator.tsx` | Vertical step progress with clickable history |
| `sdk/react/src/resource-creation/index.ts` | Barrel exports |
| `sdk/react/src/agent/useCreateAgent.ts` | Mutation hook wrapping `stigmer.agent.apply()` |
| `sdk/react/src/agent/AgentCreationWizard.tsx` | 3-step wizard composer |
| `sdk/react/src/agent/steps/types.ts` | `AgentWizardData` + initial state factory |
| `sdk/react/src/agent/steps/IdentityStep.tsx` | Name, slug, description, visibility, instructions |
| `sdk/react/src/agent/steps/CapabilitiesStep.tsx` | MCP servers, skills, env vars (collapsible) |
| `sdk/react/src/agent/steps/ReviewStep.tsx` | Summary card + YAML preview |

### Modified Files (5)

- `sdk/react/src/library/serialize-resource-yaml.ts` — Added `serializeAgentInputYaml` for YAML preview from SDK input types
- `sdk/react/src/agent/index.ts` — Added wizard + hook exports
- `sdk/react/src/index.ts` — Added `resource-creation` module + new agent exports
- `sdk/react/src/library/index.ts` — Added `serializeAgentInputYaml` export
- `client-apps/web/src/domain/library/agents/AgentListPage.tsx` — Create URL now points to `/library/agents/new`

## Benefits

- Users can create agents visually without touching YAML or the AI chat flow
- Platform builders get an embeddable `<AgentCreationWizard />` component
- Shared wizard infrastructure reduces future work for MCP Server wizard (T04-D)
- `useCreateAgent` hook is independently importable for custom creation UIs
- 3-step flow respects user time (vs. 7 screens for a minimal agent)

## Impact

- **SDK consumers**: New exports — `AgentCreationWizard`, `useCreateAgent`, `WizardShell`, `useWizardState`, `serializeAgentInputYaml`
- **Console users**: New `/library/agents/new` route replaces the draft session redirect
- **Future tasks**: T04-D (MCP Server wizard) now has `WizardShell` + `useWizardState` ready to compose

## Related Work

- T04-A: ResourceWorkbench creation slot (provided the entry point)
- T04-E: YAML/JSON Import/Export (the power-user alternative path)
- T04-D: MCP Server Creation Wizard (next consumer of `resource-creation/`)
- Phase 2: ResourceDetailShell (the detail architecture that edit flows will build on)

---

**Status**: ✅ Production Ready
**Timeline**: Single session (~45 minutes implementation)
