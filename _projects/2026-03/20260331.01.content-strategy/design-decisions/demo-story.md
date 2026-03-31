# Demo story narrative

This document defines the before/after narrative that makes Stigmer's positioning
concrete. It is the source material for the Phase 2 sales site "Demo Story"
homepage section.

**Status**: draft, pending review
**Created**: 2026-03-31
**Depends on**: [Positioning document](positioning.md), [Vocabulary guide](../../../../docs/vocabulary.md)
**Scope**: Narrative strategy, scenario, and draft sales copy. Does not cover
visual design, layout, or React component implementation (Phase 2).

## How to use this document

- **Building the sales site (Phase 2)?** The [primary story](#primary-story-e-commerce-platform)
  provides the narrative arc. The [capability map](#capability-map) provides
  polished draft copy blocks keyed to each messaging pillar. The
  [Phase 2 notes](#notes-for-phase-2) describe how the narrative maps to
  homepage sections.
- **Writing docs or README copy?** The [narrative framework](#narrative-framework)
  defines the transformation arc that all Stigmer stories follow. Use it to keep
  any before/after narrative consistent with the positioning.
- **Evaluating new scenarios?** The variant sketches prove the framework
  generalizes. Use the same five-beat arc to draft stories for new industries.

---

## Narrative framework

Every Stigmer demo story follows a five-beat arc. The first and last beats are
emotional anchors. The middle three are the transformation — each maps to one
messaging pillar from the [positioning document](positioning.md).

### Beat 1 — Before

**Purpose**: Establish the pain. The founder integrated a generic LLM. It works
for demos but fails in production.

**Competitive frame**: "vs. Direct LLM API Calls" (positioning document,
"Competitive Framing"). The reader should recognize this as their own experience.

**Requirements**:

- Make the reader nod — "I've been there"
- Show the problem is structural (not a bad prompt)
- Create tension that the three acts resolve

### Beat 2 — Teach it your domain

**Maps to**: Pillar 1, "Knows Your Business."

The founder uploads domain knowledge. The agent transforms from generic to
expert. The proof is a single question that gets a dramatically different answer
before and after.

### Beat 3 — Connect your tools

**Maps to**: Pillar 2, "Uses Your Tools."

The founder gives the agent access to real systems. The agent transforms from
"talks about things" to "does things." The proof is an interaction where the
agent takes a real action.

### Beat 4 — Set the rules

**Maps to**: Pillar 3, "Asks Before Acting."

The founder configures which actions need human approval. The agent transforms
from "does things" to "does things safely." The proof is an interaction where
the agent pauses, shows its reasoning, and waits for a human decision.

### Beat 5 — After

**Maps to**: Foundation pillar, "Built for Production."

The agent runs as part of the founder's product. This beat closes the emotional
loop from Beat 1 and answers: what does the founder's world look like now?

**Requirements**:

- Show the business outcome, not just the technical achievement
- Reference reliability without naming internal technology
- Connect to the positioning statement: "ship agents to production instead of
  building plumbing"

### Micro-pattern (each act)

Every act follows the same structure:

1. What changed — one capability added
2. What the agent can now do that it could not before
3. A concrete interaction that proves it

### Vocabulary contract

Per the [vocabulary guide](../../../../docs/vocabulary.md), sales-site column:

| Concept | Use this | Not this |
|---------|----------|----------|
| Skills | domain knowledge | Skill, knowledge artifact |
| MCP Servers | tools, tool access | MCP server, tool connection |
| Sessions | conversation | Session, thread |
| Approval flows | approval flow | HITL, human-in-the-loop |
| Agent Execution | *(do not mention)* | execution, run |
| Durable Execution | keeps running even if something crashes | Durable Execution, Temporal |

Technical terms appear only in the [capability map](#capability-map), not in the
narrative itself.

---

## Primary story: E-commerce platform

### Scenario

You are building a multi-vendor e-commerce platform. Hundreds of merchants sell
through it. Each merchant has their own product catalog, return policy, and
shipping rules. Their customers have questions — order status, return
eligibility, product availability — and your merchants are drowning in support
tickets.

You want to add an AI agent as a platform feature so every merchant gets
intelligent customer support on day one.

### Before

You did the obvious thing. You called the LLM API, built a chatbot, and
embedded it in every merchant's storefront.

It lasted about a week.

A customer asks: *"Can I return these shoes?"*

The chatbot says: *"Most retailers accept returns within 30 days."*

But this merchant's policy is 14 days for footwear, 30 days for accessories,
and no returns on sale items. The chatbot does not know that. It cannot know
that — it has no access to this merchant's rules.

A customer asks: *"Where's my order?"*

The chatbot says: *"I'd be happy to help! Please provide your order number and
I'll look into it."*

But it cannot look into anything. It has no access to your order management
system. It is a dead end dressed up as helpfulness.

Your merchants are worse off than before. Customers think support exists, try
to use it, get wrong answers, and call the merchant anyway — angrier than if
there had been no chatbot at all.

The problem is not the LLM. The problem is that a language model alone does not
know your merchants' business, cannot take actions in your systems, and has no
way to handle sensitive requests safely.

### Act 1 — Teach it your domain

Each merchant uploads what their agent needs to know — return policy, product
catalog, shipping FAQ, escalation rules. Plain text. No vector database. No
embedding pipeline. No retrieval tuning.

The same question gets a different answer.

*"Can I return these shoes?"*

→ *"Footwear returns are accepted within 14 days of delivery, unworn and in
original packaging. Sale items are final sale. Would you like me to check if
your order is eligible?"*

The agent knows this merchant's policy because the merchant provided the policy.
It is not guessing from a generic training set. A different merchant with a
different return window gets a different answer — because each agent has its own
domain knowledge.

### Act 2 — Connect your tools

Knowing the return policy is not enough. The customer wants to actually return
the shoes.

You connect the agent to your platform's order management API. Now the agent
can look up orders, check shipping status, verify return eligibility against the
policy, and initiate a return.

*"I'd like to return order #4821."*

→ The agent looks up the order. Nike Air Max, delivered six days ago. Within the
14-day window. Not a sale item. Eligible.

*"Your order is eligible for a return. I've started the process — you'll receive
a prepaid shipping label at sarah@email.com within the hour."*

One interaction. No ticket. No handoff to a human. The customer's problem is
solved.

### Act 3 — Set the rules

Some actions should not happen without a human in the loop.

You mark the refund tool as requiring merchant approval. The agent answers
questions and looks up orders on its own. When it is ready to actually process
a refund, it pauses.

*"I bought the wrong size on three items. Can I return all of them?"*

The agent checks each item — all three are eligible under the return policy.
Total: $680. Before processing, it pauses and sends the merchant a
notification: *"Customer Sarah Chen is requesting a return of 3 items totaling
$680. All items meet the return policy. Approve or reject?"*

The merchant reviews the details, approves, and the agent proceeds with the
return.

Routine questions and order lookups: handled automatically. Refund processing:
humans stay in control. You decide which actions need approval.

### After

Every merchant on your platform now has an AI agent that knows their business,
uses your systems, and follows their rules.

You did not build agent infrastructure. You built a product feature. The agent
runs around the clock. It remembers past conversations — a customer who asked
about sizing yesterday can follow up today and the agent picks up where it left
off. If something crashes, the agent resumes without losing state.

Your merchants handle fewer tickets. Their customers get instant, accurate
answers. And you shipped this as a core platform capability — every new merchant
gets it on day one, configured to their own policies and catalog.

You built a product, not plumbing.

---

## Capability map

This table connects each narrative beat to the messaging framework and provides
polished draft copy blocks for Phase 2.

| Beat | Messaging pillar | Stigmer feature | Vocabulary (sales site) | Draft copy |
|------|-----------------|-----------------|------------------------|------------|
| Before | *(competitive frame: vs. Direct LLM API)* | — | — | "You called the API. It doesn't know your business, can't take actions, and has no guardrails. Your customers get wrong answers and call you anyway." |
| Act 1 | Knows Your Business | Skills | domain knowledge | "Teach your agent what generic AI doesn't know — your return policy, your product catalog, your escalation rules. No vector database. No embedding pipeline. Just your knowledge, in plain text." |
| Act 2 | Uses Your Tools | MCP Servers | tools | "Connect your agent to your systems. It checks inventory, looks up orders, initiates returns — with the same APIs your team already uses." |
| Act 3 | Asks Before Acting | Approval Flows (ToolApprovalPolicy) | approval flow | "Your agent handles routine requests on its own. For anything sensitive, it asks a human first. You set the rules." |
| After | Built for Production | Durable Execution, Sessions, API-first | conversation, *(describe benefits)* | "The agent runs around the clock. It remembers conversations. If something crashes, it picks up where it left off. You built a product feature, not agent infrastructure." |

### Copy block sources

The Act 1, Act 2, and Act 3 copy blocks are adapted from the positioning
document's messaging pillar copy examples (Pillars 1–3). The After copy block
draws from the Foundation pillar ("Built for Production") and the one-paragraph
description under "Headlines, Taglines, and Descriptions."

---

## Variant sketch: Property management SaaS

### Scenario

You build property management software. Property managers use your platform to
manage buildings, tenants, leases, and maintenance. You want to add an AI
assistant to the tenant portal.

### Before

You added a chatbot. A tenant asks *"Can I have a dog?"* and the chatbot says
*"Many apartments allow pets with a deposit."* But Building C prohibits pets
entirely, and Building A allows cats only. The chatbot does not know
building-specific rules. A tenant asks to report a leaky faucet and the chatbot
says *"Please contact your property manager."* It cannot submit a maintenance
request.

### Transformation

| Act | What changes | Proof interaction |
|-----|-------------|-------------------|
| Teach | Each property uploads its rules — pet policies, quiet hours, lease terms, maintenance procedures. Per-building, not generic. | *"Can I have a dog in Building C?"* → *"Building C does not allow pets. Buildings A and D allow cats with a $300 deposit."* |
| Connect | Agent connects to the maintenance ticketing system and tenant database. | *"My kitchen faucet is leaking."* → Agent creates a maintenance ticket, assigns it to the plumbing contractor on file, and confirms: *"Ticket #1847 created. A plumber is scheduled for Thursday between 9am and 12pm."* |
| Rules | Maintenance work orders and early lease termination requests need property manager approval. Routine questions and status checks are handled automatically. | *"I need to break my lease early."* → Agent calculates the early termination fee per the lease, sends the request to the property manager for review. |

### After

Every property on the platform has an AI assistant that answers tenant questions
accurately, submits and tracks maintenance requests, and escalates high-stakes
decisions to the property manager. Property managers handle the exceptions, not
the routine.

---

## Variant sketch: Logistics platform

### Scenario

You build logistics software. Shippers and warehouses use your platform to track
shipments, manage inventory, and coordinate deliveries. You want to add an AI
operations agent so your customers can get answers and take actions without
navigating a complex dashboard.

### Before

You built an AI assistant for shipment tracking. A customer asks *"Where is
shipment SH-7291?"* and the agent responds with a plausible-sounding but
completely fabricated tracking update. It hallucinated a tracking number. It has
no access to real shipment data, no knowledge of this customer's SLA terms, and
no concept of their routing preferences.

### Transformation

| Act | What changes | Proof interaction |
|-----|-------------|-------------------|
| Teach | Each customer uploads their SLA terms, routing preferences, and exception-handling procedures. | *"What happens if my Dallas shipment is late?"* → *"Per your contract, ground shipments to Texas have a 48-hour SLA. Late deliveries trigger a 5% credit on the affected invoice."* |
| Connect | Agent connects to shipment tracking, warehouse management, and carrier APIs. | *"Where is SH-7291?"* → Agent queries the real tracking system: *"SH-7291 cleared the Memphis hub at 2:14 PM. Estimated delivery: tomorrow by 3 PM."* |
| Rules | Rerouting shipments (cost implications) or issuing SLA credits requires ops team approval. | *"Reroute SH-7291 to our Austin warehouse instead."* → Agent calculates the cost delta ($45 surcharge), sends the reroute request to the ops team for approval. |

### After

Every customer on the logistics platform has an AI operations agent that knows
their contract terms, queries real shipment data, and escalates financial
decisions. Customers get instant answers. The ops team handles exceptions, not
status checks.

---

## Notes for Phase 2

The T01 plan defines the Phase 2 homepage structure. The demo story maps to
homepage section 2: **"Demo Story (NEW section) — The before/after narrative
from Phase 1."**

### How the narrative maps to the homepage

The five-beat arc is designed for vertical scroll. Each beat becomes a visual
section:

1. **Before** — The pain. Could be a simulated chat showing the wrong answer.
   Dark or muted visual treatment.
2. **Act 1** — The same chat, now with the right answer. Visual shift (lighter,
   branded colors). Copy from the capability map's Act 1 block.
3. **Act 2** — A new interaction showing the agent taking action. The chat now
   includes system responses (order lookup, return confirmation).
4. **Act 3** — An interaction where the agent pauses. A notification appears.
   A human approves. The agent proceeds.
5. **After** — A zoomed-out view. Multiple merchants, multiple agents, all
   running. Transition to the "How It Works" or "What You Can Build" section.

### Adjacent homepage sections

- **Section 1 (Hero)** sets up the promise: *"Build agents that work for your
  business."*
- **Section 2 (Demo Story)** proves the promise through a concrete narrative.
- **Section 3 (Three Capabilities)** generalizes the proof into pillars.

The demo story is the bridge between the headline claim and the capability
breakdown. It answers: "What does 'agents that work for your business' actually
look like?"

### Adaptation notes

- The narrative is written in second person ("you") to match the positioning
  document's voice. Phase 2 may keep this or adapt to a named-protagonist
  format depending on visual design direction.
- The capability map's draft copy blocks are polished starting points. Phase 2
  will refine them for character counts, visual hierarchy, and scroll rhythm.
- The variant sketches are not intended for the homepage. They validate the
  framework and may inform a future `/use-cases` page (T01 plan, Phase 2
  additional pages).

---

*This document is a Phase 1 deliverable of the content strategy project.
The primary story, capability map, and framework are the source material for
Phase 2 sales site implementation. No customer-facing copy should contradict
the [positioning document](positioning.md) or the
[vocabulary guide](../../../../docs/vocabulary.md).*
