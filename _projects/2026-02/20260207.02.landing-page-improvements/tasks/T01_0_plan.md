# Task T01: Landing Page Value Proposition Overhaul

**Created**: 2026-02-07
**Status**: PENDING REVIEW
**Type**: Refactoring
**GitHub Issue**: [#32](https://github.com/stigmer/stigmer/issues/32)
**Research**: `research.product-positioning-and-messaging/04.report.gpt.md`

⚠️ **This plan requires your review before execution**

---

## Executive Summary

Based on Deep Research findings, we will reposition Stigmer as **"Open-source Durable Agentic Workflows"** — an AI-native automation platform where agents are first-class, but **durable workflow orchestration is the differentiator**.

### Core Messaging Changes

| Current | New |
|---------|-----|
| "Build Agents. Skip the Infrastructure." | **"AI automations fail. Stigmer makes them durable."** |
| Implementation-focused subheadline | Outcome-focused: reliability, durability, local-first |
| "App 1", "App 2" placeholders | Concrete use cases: PR Review Pipeline, Incident Triage, etc. |
| How-first page structure | Why-first: Use cases before architecture |

---

## Finalized Implementation Plan

### Phase 1: Hero Section Overhaul (T01)

**File**: `site/src/components/sections/Hero.tsx`

#### New Hero Content

**Headline:**
```
AI automations fail. Stigmer makes them durable.
```

**Subheadline:**
```
Build sandboxed AI agents and run them inside production-grade workflows 
with retries, state, and real tool integrations — locally or in production.
```

**Badges (update from current):**
| Current | New |
|---------|-----|
| Local-First | Durable Execution |
| Open Source | Open Source (keep) |
| gRPC APIs | MCP Integrations |

**3 proof bullets under hero:**
1. **Durable execution:** Workflows keep state and resume after failures
2. **Standard integrations via MCP:** Connect agents to tools/data with a standard protocol
3. **Open-source + local-first:** Develop on your laptop, deploy anywhere

**CTAs (keep):**
- Get Started
- View on GitHub

**Install command (keep):**
```bash
brew install stigmer/tap/stigmer
```

---

### Phase 2: Add Runnable Example Section (T02)

**New Section**: Insert immediately after Hero

**Purpose**: Show a copy/paste example that feels real

#### Agent-only Example (quick win)

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: code-reviewer
spec:
  instructions: |
    Review the diff for correctness, security, and readability.
    Return: summary, risks, and concrete suggestions.
  mcpServers:
    - github
```

**Run command:**
```bash
stigmer agent run code-reviewer --input pr_url="https://github.com/org/repo/pull/123"
```

**Example output:**
```json
{
  "summary": "Solid refactor, but one edge case remains…",
  "risks": ["Potential nil dereference in ..."],
  "suggestions": [
    {"file":"pkg/x.go","line":42,"change":"Add guard for ..."}
  ]
}
```

---

### Phase 3: Durable Workflows Differentiator Section (T03)

**New Section**: "Durable Agentic Workflows"

**Purpose**: Showcase multi-agent workflow orchestration (the differentiator)

#### Workflow Example

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: pr-review-pipeline
spec:
  inputs:
    pr_url: string
  tasks:
    - name: fetch-pr
      agent: github-analyst
      inputs:
        pr_url: "${workflow.inputs.pr_url}"

    - name: review-code
      agent: code-reviewer
      inputs:
        code: "${tasks.fetch-pr.output.diff}"

    - name: post-comment
      agent: github-commenter
      inputs:
        pr_url: "${workflow.inputs.pr_url}"
        review: "${tasks.review-code.output}"
```

**Visual**: Flow diagram showing agent chaining with arrows

**Key messages:**
- "Specialists, not one mega-agent"
- "Workflows that don't lose state"
- "Chain specialists, branch, retry, and resume"

---

### Phase 4: Use Cases Section (T04)

**New Component**: `site/src/components/sections/UseCases.tsx`

**5 Use Case Cards** (with concrete inputs/outputs):

| Use Case | One-liner | Type | Persona |
|----------|-----------|------|---------|
| **PR Review Pipeline** | Turn a PR URL into a posted review comment using chained specialist agents | Both | DevEx / maintainers |
| **Incident Triage & Runbook** | Summarize incident, run safe diagnostics, produce remediation plan—with checkpoints and retries | Hybrid | SRE / platform |
| **Security Advisory → Patch PR** | Ingest advisory, identify impacted code, generate upgrade PR, notify the right channel | Both | AppSec |
| **Release Notes Generator** | Draft release notes from merged PRs in your repo's voice, then publish automatically | Both | DevEx |
| **Slack Thread Summarizer** | Convert a noisy thread into a crisp summary, decisions, and next actions | Agent-only | SRE / eng lead |

---

### Phase 5: Why Stigmer Section (T05)

**New Component**: `site/src/components/sections/WhyStigmer.tsx`

**Pain → Outcome bullets (4-6 max):**

1. **LLM steps are unreliable; your automation shouldn't be.**
   Durable workflows keep state and progress even when services fail.

2. **Multi-agent pipelines need orchestration, not just prompts.**
   Chain specialists, branch, retry, and resume.

3. **Integrations are the bottleneck.**
   MCP provides a standardized way to connect to tools and data sources.

4. **Prototype locally, ship with confidence.**
   SQLite + Ollama on your laptop → same workflow in production.

5. **No lock-in.**
   Apache 2.0 open source, deploy anywhere.

---

### Phase 6: Refactor Features Section (T06)

**File**: `site/src/lib/constants.ts`

**Translate implementation → value:**

| Technical Capability | Value-First Message |
|---------------------|---------------------|
| Temporal orchestration | "Workflows that don't lose state" |
| Agent chaining | "Specialists, not one mega-agent" |
| MCP servers | "Plug into real tools with a standard protocol" |
| Sandboxed execution | "Run tool-using agents safely" |
| Local-first (SQLite + Ollama) | "Iterate fast, offline, and cheap" |
| gRPC APIs | "Call your automation from any stack" |
| YAML + SDK | "Start declarative; go programmatic when needed" |

---

### Phase 7: Replace Architecture Placeholders (T07)

**File**: `site/src/components/sections/Architecture.tsx`

**Replace:**
- "App 1" → "CI/CD Pipeline" or "Slack Bot"
- "App 2" → "Internal Dashboard" or "Data Platform"

**Update diagram labels:**
- "Agent Service" → "PR Review Agent" (concrete)
- Add agent chaining visual (agent → agent → agent)

---

### Phase 8: Trust Signals Section (T08)

**New/Updated Section**: Open-source trust signals

**4 compact blocks:**
1. **GitHub**: Stars, contributors, last release, CI passing
2. **Powered by standards**: Apache 2.0, MCP, CNCF Serverless Workflow spec
3. **Security posture**: Sandboxing, permissions, audit trails
4. **Community**: Discord, weekly builds, public roadmap

---

## Final Page Section Order

1. **Hero** + subheadline + CTAs
2. **Runnable Example** (agent-only, copy/paste)
3. **Durable Workflows** (workflow example + diagram)
4. **Use Cases** (5 cards with inputs/outputs)
5. **Why Stigmer** (pain → outcomes)
6. **Features** (value-first descriptions)
7. **How It Works** (architecture with real integrations)
8. **Integrations** (MCP ecosystem)
9. **Trust Signals** (GitHub, open-source, security)
10. **Final CTA** (install / GitHub / docs)

---

## Files to Modify/Create

| File | Action | Phase |
|------|--------|-------|
| `site/src/components/sections/Hero.tsx` | Modify | T01 |
| `site/src/lib/constants.ts` | Modify | T01, T06 |
| **NEW** `site/src/components/sections/RunnableExample.tsx` | Create | T02 |
| **NEW** `site/src/components/sections/DurableWorkflows.tsx` | Create | T03 |
| **NEW** `site/src/components/sections/UseCases.tsx` | Create | T04 |
| **NEW** `site/src/components/sections/WhyStigmer.tsx` | Create | T05 |
| `site/src/components/sections/Features.tsx` | Modify | T06 |
| `site/src/components/sections/Architecture.tsx` | Modify | T07 |
| **NEW** `site/src/components/sections/TrustSignals.tsx` | Create | T08 |
| `site/src/app/page.tsx` | Modify | All (reorder sections) |

---

## Success Criteria

From GitHub Issue #32 + Research:

- [x] Positioning defined: "Open-source Durable Agentic Workflows"
- [ ] Hero section communicates value proposition in under 10 seconds
- [ ] No generic placeholders like "App 1" or "Example Application"
- [ ] At least 5 concrete, real-world use cases with descriptions
- [ ] "Why" content precedes "How" content
- [ ] Workflow orchestration elevated (not buried as sub-feature)
- [ ] Executable examples with inputs/outputs shown
- [ ] Industry-specific examples that resonate with target personas

---

## Recommended Execution Order

**High Impact First:**
1. **T01** (Hero) - Immediate perception change
2. **T03** (Durable Workflows) - Differentiator visible
3. **T04** (Use Cases) - Replace placeholders
4. **T05** (Why Stigmer) - Pain-first messaging

**Polish:**
5. **T02** (Runnable Example) - Developer credibility
6. **T06** (Features refactor) - Value-first language
7. **T07** (Architecture) - Concrete examples
8. **T08** (Trust Signals) - Social proof

---

## Key Differentiation Line (Repeat Everywhere)

> **Stigmer is where "agents" become "reliable automation": durable workflows, real integrations, and local-first open source.**

---

## Review Process

**What happens next:**
1. **You review this plan** - Consider the approach, priorities, and messaging
2. **Provide feedback** - Any messaging preferences, use case changes, or priorities
3. **I'll revise if needed** - Create updated version with your feedback
4. **You approve** - Give explicit approval to proceed
5. **Execution begins** - Start with T01 (Hero section)

**Please consider:**
- Does the hero statement resonate? ("AI automations fail. Stigmer makes them durable.")
- Are the 5 use cases the right ones for your target audience?
- Should we prioritize any phases differently?
- Any messaging direction you'd change?
