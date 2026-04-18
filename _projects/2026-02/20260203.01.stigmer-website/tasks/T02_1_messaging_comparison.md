# Messaging Comparison: Before vs After

**Purpose**: Visual comparison of current vs proposed messaging to validate content overhaul direction

---

## Hero Section

### Current (Phase 3)

**Headline**: "Agentic Workflows as Code"

**Subheadline**: "Define agents and workflows in YAML or Go/Python SDKs. Run locally with zero setup. Scale to cloud without code changes."

**Problem**: 
- Focuses on **format** (YAML/SDK), not **value**
- Doesn't communicate **why** this matters
- Misses **integration story** (agents as services)
- "Workflows as code" sounds like IaC (not wrong, but incomplete)

---

### Proposed (Phase 4)

**Headline**: "Build Agents, Integrate Anywhere"

**Subheadline**: "Create agents in YAML or Go/Python SDKs. Stigmer handles sandboxing, orchestration, and MCP connections. Integrate agents into any app via gRPC. Build once, call from anywhere. No vendor lock-in."

**Why Better**:
- **Dual-pillar value**: Creation (YAML→SDK) + Integration (gRPC)
- "Build once, call from anywhere" = microservices positioning
- Lists specific problems solved (sandboxing, orchestration, MCP)
- "No vendor lock-in" addresses implicit concern (public protos)
- Clear audience: developers building agent-powered apps

---

## Features Section

### Current (Phase 3)

**Section Title**: "Built for engineering teams who code"

**Sample Feature**:
> **YAML or SDK - Your Choice**  
> Simple agents in 5 lines of YAML. Complex workflows in type-safe Go or Python. Start with YAML, graduate to SDK when complexity demands it.

**Problem**:
- Features read as "here's what we have"
- Doesn't connect to **why you care**
- Title is generic (every dev tool says this)

---

### Proposed (Phase 4)

**Section Title**: "Infrastructure You Don't Have to Build"

**Sample Feature (Rewritten)**:
> **Start Simple, Scale Naturally**  
> 5-line YAML agent today. Type-safe SDK when you need conditionals, loops, error handling. No migration - both work together. Stigmer grows with your needs. No rip-and-replace.

**Why Better**:
- Title reframes as **problems solved** (not features shipped)
- Feature description emphasizes **progression** (simple→complex)
- "No migration" addresses implicit fear (switching costs)
- Outcome-focused: "Stigmer grows with your needs"

---

## The Integration Story (New Section)

### Current (Phase 3)
**Does not exist**

---

### Proposed (Phase 4)

Add new section: "Integrate Agents Anywhere" (or "Build Your Agent Infrastructure")

**Structure** (2-column comparison + callout):

| Framework Approach | Stigmer Approach |
|-------------------|------------------|
| Import agent library into each app | Create agent once in Stigmer Cloud |
| Tightly coupled to app code | Loosely coupled via gRPC |
| Redeploy all apps to update agent | Update agent, all consumers benefit instantly |
| Custom integration per language | Standard gRPC (Go, Python, Java, TypeScript, Rust) |
| Agent runs in app process | Agent runs in Stigmer (multi-tenant, isolated) |

**Callout Box: "Platform for Platforms"**
> Because Stigmer exposes agents via gRPC, you can build agent marketplaces for YOUR users. Create a catalog of agents in Stigmer, let users call them via API. Think "Twilio for AI Agents" - infrastructure you don't see, APIs you use.

**Why This Matters**:
- **Differentiation**: Stigmer is a platform, not a framework (vs LangChain/CrewAI)
- **Architecture**: "Agents as microservices" is a clear mental model
- **Opportunity**: Marketplace capability opens platform play ("Twilio for agents")
- **Trust**: Public protos = no vendor lock-in

---

## Comparison Table: Implicit vs Current

### Current Messaging (Phase 3)

| Element | Message | Interpretation |
|---------|---------|----------------|
| Headline | "Agentic Workflows as Code" | It's like Terraform but for agents |
| Value Prop | "YAML or SDK" | You get two options |
| Target | "Engineering teams who code" | Generic developer audience |
| Proof | "Built on Temporal" | We use good tech |

**Reader Takeaway**: "Another agent framework, but with YAML and SDKs"

---

### Proposed Messaging (Phase 4)

| Element | Message | Interpretation |
|---------|---------|----------------|
| Headline | "Build Agents, Integrate Anywhere" | Two-pillar value: creation + integration |
| Value Prop | "Create (YAML→SDK) + Integrate (gRPC)" | Simple start, powerful scale, any app |
| Target | "Developers building agent-powered apps" | Clear use case |
| Proof | "Public protos, Apache 2.0, multi-tenant SaaS" | Specific, verifiable, no lock-in |

**Reader Takeaway**: "I can build agents without infrastructure hell, and integrate them into my apps like any microservice. The platform is there."

---

## Voice Examples: Current vs Proposed

### Example 1: "Zero Infrastructure"

**Current**:
> "Run stigmer server and you're building. Auto-downloads Temporal for orchestration. Uses Ollama for free local AI models. No Docker, no databases, no config files."

**Analysis**: Good! Lists what you DON'T need. Keep this energy.

**Proposed Enhancement**:
> "Run `stigmer server` and you're building. No Docker to configure. No databases to set up. No YAML hell. Stigmer auto-downloads Temporal, configures BadgerDB, sets up sandboxing. The 2 weeks of DevOps work happens in 30 seconds."

**Change**: Added **time savings** (2 weeks → 30 seconds) for concrete impact

---

### Example 2: "Built on Production Foundations"

**Current**:
> "Temporal for workflow orchestration. BadgerDB for local storage. gRPC for service contracts. Not another custom scheduler - battle-tested infrastructure."

**Analysis**: Good technical specificity. But feels like a feature list.

**Proposed Enhancement**:
> "Temporal orchestration. gRPC contracts. BadgerDB persistence. Not a toy - the same stack that powers Planton in production. We didn't build Yet Another Scheduler. We use what works."

**Change**: Added **proof** (powers Planton) and **credibility** (we use what works, not what's trendy)

---

## Tone Validation: Chief Product Evangelist Framework

### Test 1: Hair on Fire Problem

**Current**: Implied (zero setup, local-to-cloud)  
**Proposed**: Explicit ("Without Fighting Infrastructure" + lists specific problems)

**Verdict**: ✅ Proposed is stronger

---

### Test 2: Intellectual Insight

**Current**: Not articulated  
**Proposed**: "80% of agent creation is infrastructure" (in Evolution Story)

**Verdict**: ✅ Proposed adds missing insight

---

### Test 3: Aha Moment

**Current**: "YAML or SDK"  
**Proposed**: "We spent 2 years building Planton. We figured out the hard parts. Now you get it in one command."

**Verdict**: ✅ Proposed is more compelling

---

## Risks & Mitigation

| Risk | Current Approach | Proposed Approach | Mitigation |
|------|-----------------|-------------------|------------|
| **Too salesy** | Low risk (code-first) | Medium risk (evolution story could feel like chest-thumping) | Keep tone humble: "We learned by building" not "We're the best" |
| **Lose technical audience** | Low risk (technical details) | Low risk (keeps all tech specifics) | No change - still list Temporal/BadgerDB/gRPC |
| **Unclear differentiation** | High risk (sounds like LangChain) | Low risk (infrastructure focus) | Proposed is clearer |
| **Untrustworthy ("magic")** | Medium risk (auto-downloads) | Low risk (evolution story = proof) | Transparency builds trust |

---

## Decision Framework

### Keep from Phase 3
1. ✅ Code-first approach (install command front & center)
2. ✅ Technical specificity (Temporal, BadgerDB, gRPC names)
3. ✅ Dual-track positioning (YAML→SDK)
4. ✅ Apache 2.0 prominence
5. ✅ No competitor bashing (implicit contrast only)

### Change in Phase 4
1. 🔄 Headline: Format → Value
2. 🔄 Features: Capabilities → Problems Solved
3. ➕ Add: Evolution Story (credibility)
4. ➕ Add: "Why Stigmer?" comparison section
5. 🔄 Logo: Placeholder → Official Stigmer logo

---

## Final Validation Questions

Before executing Phase 4, validate:

1. **30-Second Skim Test**: Can a developer understand "infrastructure handled for me" in 30 seconds?
   - Current: "YAML or SDK, runs locally, scales to cloud"
   - Proposed: "Infrastructure handled, YAML→SDK progression, built by building Planton"
   - **Answer**: ✅ Proposed is clearer

2. **Differentiation Test**: Why Stigmer vs LangChain/CrewAI/DIY?
   - Current: Not clear (sounds like another framework)
   - Proposed: Clear (infrastructure solved, progression path, production-proven)
   - **Answer**: ✅ Proposed is stronger

3. **Action Test**: What should I do next?
   - Current: "brew install stigmer"
   - Proposed: Same + clear progression path (YAML→SDK)
   - **Answer**: ✅ Same clarity, added context

4. **Trust Test**: Why should I believe you?
   - Current: "Built on Temporal" (good tech stack)
   - Proposed: "Built BY building Planton" (lived experience)
   - **Answer**: ✅ Proposed is more credible

---

## Approval Checklist

- [x] Founder approves headline shift (Format → Dual Value: creation + integration)
- [x] Founder clarifies Planton (✅ don't mention - integration incomplete)
- [x] Founder clarifies self-hosting (✅ don't mention - not available, SaaS only)
- [x] Founder clarifies marketplace (✅ position as capability, not existing feature)
- [x] Founder confirms logo file path (✅ found: stigmer-cloud/docs/logo.svg)
- [x] Founder confirms proto location (✅ github.com/stigmer/stigmer/apis/)
- [x] Founder approves integration story (✅ gRPC as second pillar)

---

**Status**: PENDING FOUNDER REVIEW

Once approved, proceed to Phase 4.1 (Content Rewrite) implementation.
