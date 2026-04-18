# Task 02: Content Overhaul - Evolution Story & Simplified Value Prop

**Status**: PENDING REVIEW  
**Created**: 2026-02-03  
**Phase**: 4 - Content & Brand Alignment  

---

## Executive Summary

The current website messaging ("Agentic Workflows as Code") focuses on the **format** (YAML/SDK) rather than the **value**. This task rewrites the entire site to communicate:

**Core Message (Dual Pillars)**:
1. "Create agents without fighting infrastructure" (sandboxing, orchestration, MCP handled)
2. "Integrate agents anywhere via gRPC" (agents as microservices, not libraries)

---

## The Real Problem We Solve

### Current State (Pain)
Developers who want to build agents face:
- Framework decision paralysis (LangChain? CrewAI? Build from scratch?)
- Sandboxing complexity (how do I run untrusted code safely?)
- MCP server integration hell (security, connection management)
- Workflow orchestration overhead (Temporal? Airflow? DIY?)
- SDK vs declarative trade-offs (when to use which?)

### Stigmer's Insight (Solution)
**You shouldn't have to solve infrastructure problems to build an agent.**

Stigmer provides:
1. **Zero-Config Runtime**: `stigmer server` auto-configures Temporal, BadgerDB, sandboxing
2. **Dual-Track UX**: YAML for simple cases, SDK when complexity demands it
3. **Secure-by-Default**: Sandboxing, MCP connection security handled
4. **Production-Ready Patterns**: Workflows with static steps + agent steps
5. **Future-Proof Skills**: Agent can create skills using cursor's skill-create-skill

---

## The Evolution Story (Our Credibility)

This isn't theory. This is learned by building Planton:

| Stage | What We Built | What We Learned |
|-------|--------------|-----------------|
| **v1: Basic Agent** | Instructions + MCP servers + sub-agents | Configuration is 80% of agent creation |
| **v2: Skills** | Reusable capabilities | Agents need composable behaviors |
| **v3: Sandboxing** | Secure code execution | Trust is critical for production use |
| **v4: Workflows** | Static steps + agent steps | Real systems need deterministic + adaptive flows |
| **v5: SDK** | Go/Python programmatic APIs | YAML is too limiting (even creator found it hard) |

**The Aha Moment**: Every addition was about **removing infrastructure burden** from developers.

---

## Content Rewrite Plan

### 1. Hero Section Overhaul

**Current Headline**: "Agentic Workflows as Code"  
**Problem**: Focuses on format, not value. Misses integration story.

**New Headline**: "Build Agents, Integrate Anywhere"

**New Subheadline**:  
"Create agents in YAML or Go/Python SDKs. Stigmer handles sandboxing, orchestration, and MCP connections. Integrate agents into any app via gRPC. Build once, call from anywhere. No vendor lock-in."

**New Badges**:
- "gRPC APIs" (NEW - emphasizes integration)
- "YAML + SDK" (keeps current - emphasizes creation flexibility)
- "Apache 2.0" (keeps current - emphasizes no lock-in)

---

### 2. Features Section Rewrite

**New Section Title**: "Infrastructure You Don't Have to Build"

Reframe features as infrastructure problems solved. Add 7th feature for integration:

| Feature Title | Focus | Description Outline |
|---------------|-------|---------------------|
| **Start Simple, Scale Naturally** | Progressive complexity | 5-line YAML agent today. Type-safe SDK when you need conditionals, loops, error handling. No migration - both work together. |
| **One Command, Zero Config** | Runtime simplicity | `stigmer server` auto-downloads Temporal, configures BadgerDB, sets up sandboxing. No Docker, no databases, no YAML hell. |
| **Production Infrastructure, Day One** | Battle-tested stack | Temporal orchestration. gRPC contracts. BadgerDB persistence. Not a toy - the same stack that powers Planton. |
| **Bring Your Own AI** | No vendor lock-in | Ollama for free local dev. OpenAI/Anthropic for production. Or your own model. API key optional, not required. |
| **Type-Safe When You Need It** | SDK power | Go/Python SDKs with full type safety. IDE autocomplete. Compile-time validation. Workflows as infrastructure code. |
| **Truly Open Source** | No tricks | Apache 2.0. Fork it. Modify it. Run anywhere. We're not a hosted service with an "open core" trap. |
| **Integrate Agents Anywhere** | Platform capability | Public gRPC protos. Type-safe contracts. Call agents from any language with gRPC support. Agents are microservices, not libraries. |

---

### 3. New "Integrate Agents Anywhere" Section (Add)

**Placement**: Between Features and Quickstart

**Title**: "Build Your Agent Infrastructure"

**Structure**: 2-column comparison + callout box

| Framework Approach | Stigmer Approach |
|-------------------|------------------|
| Import agent library into each app | Create agent once in Stigmer Cloud |
| Tightly coupled to app code | Loosely coupled via gRPC |
| Redeploy all apps to update agent | Update agent, all consumers benefit instantly |
| Custom integration per language | Standard gRPC (Go, Python, Java, TypeScript, Rust) |
| Agent runs in app process | Agent runs in Stigmer (multi-tenant, isolated) |

**Callout Box: "Platform for Platforms"**

> Because Stigmer exposes agents via gRPC, you can build agent marketplaces for YOUR users. Create a catalog of agents in Stigmer, let users call them via API. Think "Twilio for AI Agents" - infrastructure you don't see, APIs you use.

**Tone**: Visionary but honest. Focus on capability, not claiming features that don't exist yet.

---

### 4. Quickstart Enhancement

**Current State**: 4 steps, focused on installation

**Add Step 4.5**: "Integrate via gRPC" (between "Create Agent" and examples)

Show code snippets for Go and Python:
- Import proto from `github.com/stigmer/stigmer/apis/`
- Call agent via gRPC client
- Link to `/docs/integration/grpc` for full guide

**Add "The Progression Path" callout**:

```markdown
## From Creation to Integration

1. **Create (5 min)**: Write a 5-line YAML agent in Stigmer Cloud
2. **Test (5 min)**: Run agent via CLI or web UI
3. **Integrate (10 min)**: Call agent from your app via gRPC
4. **Scale (ongoing)**: Update agent independently, all consumers benefit

Start simple, scale naturally. No rip-and-replace.
```

---

### 5. Logo & Brand Alignment

**Current Logo**: Text "S" in gradient box (placeholder)

**Action**: 
1. Search repo for official logo file (user mentioned "we have a logo file")
2. If SVG/PNG found: Replace placeholder with official asset
3. If not found: Ask user to provide path to logo file
4. Update: Hero logo, Header logo, Favicon

**Files to Update**:
- `site/src/components/ui/logo.tsx`
- `site/src/app/icon.tsx` (for favicon)
- `site/src/components/sections/Hero.tsx` (hero logo mark)

---

## Implementation Checklist

### Phase 4.1: Content Rewrite (1 session)
- [ ] Rewrite Hero section (headline, subheadline, badges)
- [ ] Rewrite Features section (title + 6 existing + 1 new "Integrate Anywhere")
- [ ] Create new "Integrate Agents Anywhere" section (comparison + callout)
- [ ] Enhance Quickstart with gRPC integration step
- [ ] Add "From Creation to Integration" progression callout
- [ ] Update site description in constants.ts (add integration pillar)

### Phase 4.2: Brand Assets (1 session)
- [x] Locate official logo file in repo (found at stigmer-cloud/docs/logo.svg)
- [ ] Copy logo.svg to site/public/
- [ ] Replace placeholder logo in logo.tsx (use <Image> with /logo.svg)
- [ ] Update Hero section logo mark (use official logo instead of "S" text)
- [ ] Generate favicon from logo (use Next.js icon.tsx with logo.svg)
- [ ] Test all logo variants (sm/md/lg)

### Phase 4.3: Polish & Validation (1 session)
- [ ] Review against "Chief Product Evangelist" voice framework
- [ ] Test all 6 content validation criteria:
  1. **Clarity**: "Can a developer skim in 30s?"
  2. **Differentiation**: "Why not LangChain/CrewAI?"
  3. **Outcome Focus**: "What can I build?"
  4. **Respect**: "No buzzwords, no fluff"
  5. **Proof**: "Evolution story = credibility"
  6. **Code-First**: "Show, don't tell"
- [ ] Zero linter errors
- [ ] Build and verify static export
- [ ] Ready for production deploy

---

## Content Voice Guidelines (Refresher)

Based on "Chief Product Evangelist & Founder" role:

### The Narrative Framework
1. **Hair on Fire Problem**: "Evaluating 5 agent frameworks. Building sandboxing. Configuring Temporal. You wanted to build an agent, not become a DevOps engineer."
2. **Intellectual Insight**: "The problem isn't agent logic - it's the infrastructure around it. We realized 80% of agent building is plumbing."
3. **Stigmer Solution (Aha!)**: "We spent 2 years building Planton. We figured out the hard parts. Now you get it in one command."

### Tone Checklist
- [x] Clear > Clever (no puns about "agents")
- [x] Precise language (no "revolutionize")
- [x] High agency (direct, confident)
- [x] Respectful of intelligence (treat readers as peers)
- [x] Proof over promises (evolution story = lived experience)

---

## Key Decisions

1. **Dual-Pillar Messaging**: Creation (YAML→SDK) + Integration (gRPC APIs) as equal pillars
2. **No Competitor Mentions**: Implicit contrast (LangChain/CrewAI) without naming them
3. **Platform Positioning**: "Agents as microservices" differentiates from frameworks
4. **Infrastructure Focus**: Reframe features as "problems you don't solve"
5. **Evolution Story as Proof**: The v1→v5 progression shows we learned by building
6. **Honesty Over Hype**: Position marketplace as capability, not existing feature
7. **SaaS-First**: Stigmer Cloud is the path (self-hosting not mentioned)

---

## Success Criteria

After this phase:
1. **Dual-Pillar Test**: Developer understands BOTH creation and integration value in 30 seconds
2. **Differentiation Test**: Clear why Stigmer (platform) vs LangChain/CrewAI (frameworks)
3. **Platform Test**: "Agents as microservices" concept is clear and compelling
4. **Integration Test**: gRPC value is clear without technical background required
5. **Credibility Test**: Evolution story + public protos build trust
6. **Action Test**: Clear path to Stigmer Cloud signup and first agent
7. **Brand Test**: Official logo matches company identity

---

## Open Questions for Review

1. **Logo File Location**: ✅ FOUND - `/Users/suresh/scm/github.com/stigmer/stigmer-cloud/docs/logo.svg` (95×96px, gradient with pattern)
2. **Planton Mentions**: ✅ RESOLVED - Don't mention (integration incomplete)
3. **Self-Hosting**: ✅ RESOLVED - Don't mention (not available yet, Stigmer Cloud only)
4. **Marketplace**: ✅ RESOLVED - Position as capability ("you can build"), not feature ("we have")
5. **Proto Location**: ✅ CONFIRMED - `github.com/stigmer/stigmer/apis/` folder
6. **Technical Depth**: Should we add architecture diagram showing Temporal/BadgerDB/gRPC stack?

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Messaging too complex | 30-second skim test before commit |
| Lose code-first audience | Keep install command front & center |
| Sound like "magic" (untrustworthy) | Evolution story + specific stack mentions |
| Overemphasize YAML | Make SDK equally prominent in hero |

---

## Next Steps After Review

1. **Founder Review**: Present this plan for approval
2. **Logo Asset Hunt**: Find official logo file or request path
3. **Content Execution**: Implement rewrites in 3 phases (4.1, 4.2, 4.3)
4. **Deploy**: Push to production after validation

---

**Awaiting Review & Approval**
