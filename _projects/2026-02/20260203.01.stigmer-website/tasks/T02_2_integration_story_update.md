# Integration Story Update - Phase 4 Addition

**Date**: 2026-02-03 20:45  
**Status**: APPROVED - Ready for Implementation  
**Impact**: HIGH - Adds second value pillar

---

## The Missing Half: Integration

### Original Phase 4 Focus
**Agent Creation**: YAML→SDK, infrastructure handled, sandboxing, orchestration

### New Addition
**Agent Integration**: gRPC APIs enable any app to consume agents as services

---

## The Core Value (Updated)

Stigmer provides **two pillars**:

### Pillar 1: Create Agents Without Infrastructure Hell
- YAML for simple cases, SDK for complex
- Sandboxing, orchestration, MCP connections handled
- Zero config runtime (`stigmer server`)

### Pillar 2: Integrate Agents Anywhere via gRPC
- Agents run in Stigmer Cloud (multi-tenant SaaS)
- Apps call via gRPC (public protos, type-safe)
- Build once, call from anywhere (agents as microservices)

---

## Why This Matters: The Library vs Runtime Distinction

### Traditional Agent Frameworks (LangChain, CrewAI)
```
Your App
└── import langchain
    └── Agent runs in your process
    └── Tightly coupled
    └── Redeploy app to update agent
```

**Problem**: Every app that needs the agent must import the library, manage dependencies, redeploy for updates.

### Stigmer Approach
```
Your App → gRPC → Stigmer Cloud
                  └── Agent runs here
                  └── Loosely coupled
                  └── Update agent independently
```

**Solution**: Agent is a microservice. Apps call it like any gRPC service. Update agent once, all consumers benefit.

---

## The Platform Play: "Build Your Own Marketplace"

### Stigmer's Vision
Users can:
1. Create agents in Stigmer Cloud (in their organization)
2. Expose agents via gRPC to their apps
3. **Build their own agent marketplaces** using Stigmer as infrastructure

### Future: Stigmer-Owned Marketplaces (Roadmap)
- Marketplace for skills (reusable capabilities)
- Marketplace for agents (general-purpose)
- Marketplace for workflows (common patterns)

**Key Messaging**: Focus on "what consumers can build" not "what Stigmer provides"

### Positioning on Website
- **Don't say**: "Stigmer has a marketplace" (not true yet)
- **Do say**: "Build agent marketplaces using Stigmer's gRPC APIs" (platform capability)

---

## Multi-Tenancy: Organizations Model

### How It Works
1. User creates **organization** (namespace isolation)
2. Inside organization: create agents, workflows, skills
3. Apps call organization's agents via gRPC (scoped to org)

### Messaging on Website
- "Create your organization in Stigmer Cloud"
- "Agents are isolated per organization (multi-tenant)"
- "Apps authenticate with organization credentials"

---

## Deployment Model (Current State)

### What Exists: Stigmer Cloud (SaaS)
- ✅ Multi-tenant SaaS platform
- ✅ Users create organizations
- ✅ gRPC APIs for integration
- ✅ No infrastructure to manage

### What Doesn't Exist Yet: Self-Hosting
- ❌ Self-host option not available (roadmap)
- ❌ Don't mention "run Stigmer in your infra" (not true)

### Website Messaging
- **Primary**: "Start with Stigmer Cloud" (create org, start building)
- **Future**: Add self-host option when available (not now)

---

## Updated Hero Section

### New Headline (Dual-Pillar)
**Option 1**: "Build Agents, Integrate Anywhere"  
**Option 2**: "The Agent Infrastructure Platform"  
**Option 3**: "Create Agents Without Infrastructure, Integrate Them Everywhere"

**Recommendation**: Option 1 - short, clear, balanced

---

### New Subheadline
**Proposed**:
> "Create agents in YAML or Go/Python SDKs. Stigmer handles sandboxing, orchestration, and MCP connections. Integrate agents into any app via gRPC. Build once, call from anywhere. No vendor lock-in."

**Key phrases**:
- "Build once, call from anywhere" (microservices vibe)
- "Integrate agents into any app via gRPC" (platform capability)
- "No vendor lock-in" (public protos, Apache 2.0)

---

### New Badges
**Current**: Apache 2.0, Built on Temporal, YAML + SDK

**Updated**: 
- Apache 2.0 (keep)
- gRPC APIs (new - emphasizes integration)
- YAML + SDK (keep - emphasizes creation flexibility)

---

## New Section: "Integrate Agents Anywhere"

**Placement**: Between Features and Quickstart

### Section Structure

#### Title
"Build Your Agent Infrastructure"

#### Intro Paragraph
> Stigmer isn't just a framework - it's a platform. Create agents once, integrate them everywhere via gRPC. Your apps don't import libraries; they call APIs. Update agents independently. Build agent marketplaces for your users. All with standard protocols and public contracts.

#### Two-Column Comparison

| Framework Approach | Stigmer Approach |
|-------------------|------------------|
| Import agent library into each app | Create agent once in Stigmer Cloud |
| Tightly coupled to app code | Loosely coupled via gRPC |
| Redeploy all apps to update agent | Update agent, all consumers benefit instantly |
| Custom integration per language | Standard gRPC (Go, Python, Java, TypeScript, Rust) |
| Agent runs in app process | Agent runs in Stigmer (multi-tenant, isolated) |

#### Callout Box: "Platform for Platforms"

```markdown
**The marketplace opportunity**: Because Stigmer exposes agents via gRPC, you can build agent marketplaces for YOUR users. Create a catalog of agents in Stigmer, let users call them via API. Think "Twilio for AI Agents" - infrastructure you don't see, APIs you use.
```

---

## Updated Features Section

### Add 7th Feature: "gRPC-First Integration"

**Title**: "Integrate Agents Anywhere"

**Description**:
> "Public gRPC protos in `github.com/stigmer/stigmer/apis/`. Type-safe contracts. Call agents from any language with gRPC support. No custom SDKs, no vendor lock-in. Your apps just call APIs. That's infrastructure decoupling."

**Icon**: `network` or `share-2`

---

## Updated Quickstart

### Add Step 4.5: "Integrate via gRPC" (Between "Create Agent" and "Deploy")

```markdown
#### 4. Integrate into Your App

Agents expose gRPC endpoints. Call from any language:

**Go**:
```go
import "github.com/stigmer/stigmer/apis/ai/stigmer/agentic/agent/v1"

client := agent.NewAgentServiceClient(conn)
resp, _ := client.ExecuteAgent(ctx, &agent.ExecuteAgentRequest{
    OrganizationId: "your-org",
    AgentId: "your-agent",
})
```

**Python**:
```python
from stigmer.apis.ai.stigmer.agentic.agent.v1 import agent_service_pb2

client = AgentServiceStub(channel)
response = client.ExecuteAgent(
    organization_id="your-org",
    agent_id="your-agent"
)
```

**Documentation**: See [gRPC Integration Guide](/docs/integration/grpc) for all languages.
```

---

## Proto Documentation Reference

### Location
`github.com/stigmer/stigmer/apis/` folder contains all public protos

### Website Link Strategy
1. **Features Section**: Link to `/docs/api` (API reference page)
2. **Quickstart**: Link to `/docs/integration/grpc` (integration guide)
3. **Footer**: Link to GitHub `apis/` folder (for curious devs)

### What to Highlight
- **Public contracts**: "All protos are open source"
- **Multi-language**: "gRPC works in any language"
- **Versioned**: "API versioning (v1, v2) for stability"

---

## Messaging: What NOT to Say

### ❌ Avoid (Not True Yet)
1. "Self-host Stigmer" - not available
2. "Planton uses Stigmer" - integration incomplete
3. "Stigmer marketplace of agents" - doesn't exist yet
4. "Proven at scale" - no public proof points yet

### ✅ Say Instead (True & Compelling)
1. "Start with Stigmer Cloud" - SaaS is live
2. "Build agent marketplaces using Stigmer" - capability, not feature
3. "Public gRPC protos" - architecture speaks for itself
4. "Apache 2.0 with no vendor lock-in" - true & differentiating

---

## Implementation Checklist (Phase 4 Updated)

### Phase 4.1: Content Rewrite
- [ ] Update Hero headline: "Build Agents, Integrate Anywhere"
- [ ] Update Hero subheadline: Add integration pillar
- [ ] Update Hero badges: Replace "Built on Temporal" with "gRPC APIs"
- [ ] Add 7th feature: "Integrate Agents Anywhere"
- [ ] Create "Integrate Agents Anywhere" section (2-column comparison)
- [ ] Add "Platform for Platforms" callout box
- [ ] Update Quickstart: Add gRPC integration step
- [ ] Update constants.ts: New description with dual pillars

### Phase 4.2: Brand Assets (Unchanged)
- [ ] Copy logo.svg to site/public/
- [ ] Replace placeholder logo in logo.tsx
- [ ] Update Hero section logo mark
- [ ] Generate favicon from logo
- [ ] Test all logo variants

### Phase 4.3: Polish & Validation
- [ ] 30-second skim test (dual-pillar value clear?)
- [ ] Differentiation test (platform vs framework clear?)
- [ ] Integration test (gRPC value clear without jargon?)
- [ ] Zero linter errors
- [ ] Build and verify static export
- [ ] Deploy to production

---

## Content Voice: Integration Messaging Examples

### Good (Specific, Provable)
> "Agents expose gRPC endpoints. Call from Go, Python, Java, or any language. Public protos at github.com/stigmer/stigmer/apis/. No custom SDKs."

**Why**: Lists specific languages, points to proof (public protos), clear benefit (no lock-in)

### Bad (Vague, Unprovable)
> "Easily integrate agents into your applications with our powerful APIs."

**Why**: "Easily" is subjective, "powerful" is marketing fluff, no specifics

---

### Good (Outcome-Focused)
> "Update an agent once. All consuming apps get the update instantly. No redeployments. That's the microservices benefit."

**Why**: Clear outcome, concrete benefit, familiar pattern (microservices)

### Bad (Feature-Focused)
> "Our platform supports hot-reloading of agent configurations for zero-downtime updates."

**Why**: Technical jargon without explaining why it matters

---

### Good (Honest, Visionary)
> "Because Stigmer exposes agents via gRPC, you can build agent marketplaces. The infrastructure is there. The APIs are public. What you build on top is up to you."

**Why**: Honest about capability (not claiming it exists), invites creativity, specific technology

### Bad (Overpromising)
> "Stigmer's agent marketplace enables monetization of AI workflows."

**Why**: Implies marketplace exists (it doesn't), sounds salesy

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| **"Agents as services" unclear** | Use comparison table (library vs runtime) |
| **gRPC sounds technical** | Show code snippets in multiple languages |
| **"Marketplace" confusing** | Position as "what you can build" not "what exists" |
| **No proof points** | Focus on architecture (public protos) not case studies |
| **Sounds incomplete** | Emphasize SaaS availability, Apache 2.0 license |

---

## Success Metrics (Updated)

### Immediate Validation
1. **Dual-pillar test**: Can reader identify both creation AND integration value?
2. **Platform test**: Clear that Stigmer is infrastructure, not just a framework?
3. **Integration test**: gRPC value clear without technical background?

### Post-Launch Metrics
1. **API docs traffic**: Increase in `/docs/api` and `/docs/integration` visits
2. **GitHub proto folder**: Increase in `apis/` folder views
3. **Organization signups**: Track Stigmer Cloud org creation rate
4. **Integration questions**: Discord/GitHub issues about gRPC integration

---

## Open Questions (Resolved)

1. ✅ **Planton**: Don't mention (integration incomplete)
2. ✅ **Self-hosting**: Don't mention (not available yet)
3. ✅ **Marketplace**: Position as capability, not feature
4. ✅ **Proto location**: Link to `github.com/stigmer/stigmer/apis/`
5. ✅ **Deployment**: Stigmer Cloud (SaaS) is primary path

---

## Final Messaging Framework

### The Hair-on-Fire Problem (Expanded)
**Part 1**: "Building agents means wrestling with infrastructure"  
**Part 2**: "Integrating agents means tight coupling and redeployments"

### The Intellectual Insight
"Agents should be microservices. Create once, call from anywhere. Like Twilio, but for agents."

### The Stigmer Solution (Dual Aha!)
**Part 1**: "We handle creation complexity (YAML→SDK, sandboxing, orchestration)"  
**Part 2**: "We provide integration simplicity (gRPC APIs, public protos, multi-tenant)"

### The Proof Point
"Public protos in our GitHub repo. Apache 2.0 licensed. No vendor lock-in. See for yourself."

### The Invitation
"Build agent marketplaces. Build AI-powered apps. Use Stigmer as infrastructure. The platform is there."

---

**Status**: Ready for Phase 4 execution with dual-pillar messaging

**Next**: Update main plan documents (T02_0, T02_1) and proceed to implementation
