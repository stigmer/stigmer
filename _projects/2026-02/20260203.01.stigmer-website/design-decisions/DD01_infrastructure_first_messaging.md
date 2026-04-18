# Design Decision 01: Infrastructure-First Messaging

**Date**: 2026-02-03  
**Status**: PROPOSED (awaiting approval)  
**Impact**: HIGH (fundamental messaging pivot)

---

## Context

The website currently positions Stigmer as "Agentic Workflows as Code" with emphasis on YAML/SDK dual-track. This focuses on **format** rather than **value**.

Founder realization (from voice note, 2026-02-03):
> "I realized that building agents is nothing but a few configurations to be given... I realized that Planton, which is responsible for enabling DevOps for users, should not worry about how agent creation should work. I should simplify agent creation for Planton developers."

---

## The Core Insight

**80% of agent creation is infrastructure, not logic.**

When a developer wants to build an agent, they face:
1. Framework selection (LangChain? CrewAI? DIY?)
2. Sandboxing implementation (how to run untrusted code safely?)
3. MCP server integration (security, connection management)
4. Workflow orchestration (Temporal? Airflow? Custom?)
5. Local-to-cloud scaling (different code for dev vs prod?)

**The agent logic is the easy part. The plumbing is the hard part.**

---

## Decision

Pivot website messaging from **"format" (YAML/SDK)** to **"infrastructure handled"**.

### Primary Messaging
- **Headline**: "Build Agents Without Fighting Infrastructure"
- **Value Prop**: "We handle: sandboxing, orchestration, MCP connections, local-to-cloud scaling"
- **Proof**: "Built by building Planton (v1→v5 evolution)"

### Secondary Messaging
- YAML→SDK still important, but as **progression path** (not primary differentiator)
- Technical stack (Temporal, BadgerDB, gRPC) as **proof of production-grade** (not just features)
- Apache 2.0 as **no lock-in** (not just licensing)

---

## Rationale

### 1. The Evolution Story Proves It

Stigmer's v1→v5 progression shows what developers actually need:

| Version | What Was Added | Why It Was Needed |
|---------|----------------|-------------------|
| v1 | Instructions + MCP + sub-agents | Basic configuration |
| v2 | Skills | Composability |
| v3 | Sandboxing | Security/trust |
| v4 | Workflows (static + agent) | Determinism + adaptability |
| v5 | SDK | Complexity escape hatch |

**Every addition was about removing infrastructure burden.**

### 2. The "Even Creator Found YAML Hard" Moment

From founder's voice note:
> "YAML felt so difficult to write, even me who created it felt it difficult to write. Then came the SDK concept which enables or improves user experience."

**This is the honesty that builds trust.** If the creator found YAML limiting, the SDK isn't a "nice to have" - it's a necessity.

### 3. The Planton Validation

Stigmer was built **by building** Planton (a DevOps automation platform). This isn't theory - it's battle-tested at scale.

**Credibility multiplier**: "We walked the path. We hit the edges. We figured out the hard parts."

---

## Trade-offs

### What We Lose
- **"Workflows as Code" clarity**: Infrastructure-as-code practitioners might not immediately connect
- **YAML prominence**: YAML is now secondary (progression path, not headline)
- **Simplicity**: More words to explain infrastructure problems solved

### What We Gain
- **Differentiation**: Clear why not LangChain/CrewAI (they're frameworks, we're infrastructure)
- **Credibility**: Evolution story shows lived experience
- **Audience clarity**: "Developers who want to build agents, not become DevOps engineers"
- **Trust**: Transparency about limitations (YAML→SDK) builds confidence

**Verdict**: What we gain outweighs what we lose.

---

## Alternatives Considered

### Alt 1: "Agentic Workflows as Code" (Current)
**Pros**: Clear format, familiar to IaC audience  
**Cons**: Doesn't communicate value, sounds like another framework  
**Rejected**: Doesn't differentiate enough

### Alt 2: "The Agent Infrastructure Platform"
**Pros**: Clear positioning, infrastructure-first  
**Cons**: Too enterprise-y, loses developer appeal  
**Rejected**: Tone doesn't match code-first audience

### Alt 3: "Build Agents Without Fighting Infrastructure" (Proposed)
**Pros**: Clear value, specific pain point, action-oriented  
**Cons**: Longer, requires more explanation  
**Selected**: Best balance of clarity and differentiation

---

## Implementation Checklist

- [ ] Rewrite Hero headline + subheadline
- [ ] Reframe Features section (Infrastructure You Don't Have to Build)
- [ ] Add Evolution Story section (v1→v5 table)
- [ ] Add "Why Stigmer?" comparison section
- [ ] Update site metadata/description
- [ ] Maintain all technical specificity (Temporal, BadgerDB, gRPC)

---

## Success Metrics

**Before Launch** (validation):
1. 30-second skim test: Can developer understand "infrastructure handled" without reading everything?
2. Differentiation test: Clear why Stigmer vs LangChain/DIY?
3. Trust test: Does evolution story feel credible (not arrogant)?

**After Launch** (measurement):
1. Time-on-site for first-time visitors (expect: increase if messaging is clearer)
2. GitHub star velocity (expect: increase if differentiation is stronger)
3. Docs page conversion rate (expect: increase if value prop is compelling)

---

## Open Questions

1. **Planton Prominence**: How explicitly should we mention it?
   - Current proposal: Moderate (proof point, not co-marketing)
   - Alternative: High (case study section)
   
2. **Technical Depth**: Should we add architecture diagram?
   - Pros: Shows "we're not hiding anything"
   - Cons: Adds complexity to landing page
   
3. **Tone Calibration**: Is "We figured it out so you don't have to" too informal?
   - Current proposal: Direct, confident
   - Alternative: More humble ("We learned by building")

---

## References

- Founder voice note (2026-02-03): "building agents is nothing but configurations"
- Task plan: `tasks/T02_0_content_overhaul_plan.md`
- Messaging comparison: `tasks/T02_1_messaging_comparison.md`
- Chief Product Evangelist framework: (provided in user context)

---

**Status**: Awaiting founder approval to proceed with Phase 4.1 (Content Rewrite)
