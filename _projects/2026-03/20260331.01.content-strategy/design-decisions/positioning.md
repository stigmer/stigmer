# Stigmer Positioning

This document is the strategic foundation for all Stigmer messaging — sales website, documentation, README, conference talks, social media. Every customer-facing sentence should trace back to a decision made here.

**Status**: Draft — pending review
**Created**: 2026-03-31
**Scope**: Positioning strategy and messaging framework. Does not cover demo story, use cases, vocabulary, or information architecture (separate Phase 1 deliverables that build on this document).

## How to Use This Document

- **Sales website copy**: Draw headlines, body copy, and CTAs from Sections 3 and 6.
- **Documentation tone**: Follow Section 7 for voice, Section 1 for audience calibration.
- **Evaluating new copy**: Test against the positioning statement (Section 2) and IS/IS NOT boundaries (Section 4).
- **Competitive conversations**: Use Section 5 framing — never name specific competitors.
- **Internal alignment**: When anyone asks "what is Stigmer and who is it for," point them here.

---

## Strategic Decisions

Four foundational choices that shape everything below. Each is a recommendation with reasoning. These are the first things to review — if any of these are wrong, the downstream content needs to change.

### Decision 1: Audience — Technical Founders First, Developers Second

**The tension**: The T01 plan targets "platform builders and founders." The actual product requires YAML, CLI, and gRPC integration — developer activities.

**Resolution**: Two concentric audiences.

- **Primary audience (positioning and sales site)**: Technical founders and engineering leads choosing agent infrastructure for their product or organization. They evaluate platforms. They care about business outcomes, time-to-value, and long-term viability.
- **Secondary audience (documentation and quickstart)**: Developers on those teams who implement the integration — write YAML, use the CLI, call the API. They care about developer experience, API quality, and operational simplicity.

The sales website speaks to the decision-maker. The documentation speaks to the implementer. The quickstart bridges both.

### Decision 2: Category — "AI Agent Platform"

**The tension**: Multiple labels exist in the codebase — "agentic automation platform," "AI Agent Platform," "agent infrastructure."

**Resolution**: **AI agent platform.** Two words do the category work ("AI agent") and one does the differentiation work ("platform" — not framework, not library, not wrapper).

This is a real, analyst-recognized market category — not an invented term:

- **Forrester** published "AI Agent Platform Selection" (2025) and breaks the market into three functional planes: Build (model access, agent frameworks, tool integration), Orchestration (workflow embedding), and an emerging Agent Control Plane (governance). Stigmer sits primarily in the Build plane.
- **Gartner** lists multi-agent systems as a top strategic technology trend for 2026.
- **Market sizing**: The AI Agent Platform market is valued at ~$1B in 2025, projected to reach $23B+ by 2029 at 41% CAGR (Technavio, QY Research, Research and Markets all publish dedicated reports using this category name).

Rejected alternatives:
- "Agentic automation platform" — jargon-heavy; "agentic" is not a word the target audience uses.
- "Agent infrastructure" — describes what's under the hood, not what you build with it.
- "Business agent platform" — not an established term; sounds like enterprise software from 2015.

### Decision 3: Cloud-Primary, Open Source as Trust Signal

**The tension**: The README opens with `brew install`. The strategy wants cloud-first.

**Resolution**: Different front doors for different audiences.

- **Sales site**: Leads with cloud. "Sign up. Get an API key. Build your first agent in 5 minutes."
- **Open-source story**: Appears as a trust section — "Inspect every line of code. Self-host if you need to. No vendor lock-in." Not the primary CTA.
- **README**: Stays developer-first (`brew install`, `stigmer server`, local-first). The README lives on GitHub where the audience is already technical.

The positioning document defines the sales site voice. The README is a separate artifact with its own appropriate voice.

### Decision 4: Lead with Business Outcome, Support with Technical Benefit

**The tension**: "Build AI agents and workflows with zero infrastructure" (developer benefit) vs. "Build agents that work for your business" (business outcome).

**Resolution**: Three registers, layered. All three stay in business language on the sales site. Technical language belongs further down the page (developer sections, docs, README).

1. **Headline register**: Business outcome — "Build agents that work for your business"
2. **Sub-headline register**: Progressive value — "Teach them your domain. Connect your tools. Set your rules."
3. **Trust register**: Credibility signals — "Open source. Production-grade. No vendor lock-in."

"Zero infrastructure" is a strong message for developers, but it's a feature description — it tells you what you skip, not what you gain. Technical language like "define agents in code" or "Stigmer handles the infrastructure" speaks to the secondary audience (developers), not the primary (founders). The sales site hero keeps all three registers in business language. Technical credibility appears in a dedicated "How It Works" or "For Developers" section lower on the page.

---

## 1. Audience

### Primary: Technical Founders and Engineering Leads

**Who they are**: Founders of software companies, heads of engineering, or senior engineers tasked with adding AI capabilities to an existing product. They build products used by other people — SaaS platforms, internal tools, customer-facing applications.

**What they're trying to do**: Add AI agent capabilities to their product without building agent infrastructure from scratch. They want agents that know their domain, use their existing tools, and behave reliably enough for production.

**What they've already tried**: Called the ChatGPT or Claude API for a prototype. It works for demos but falls apart in production — the AI doesn't know their domain, can't take actions in their systems, and there's no way to add human oversight. They've looked at agent frameworks but realized they'd still need to build orchestration, durability, tool security, and an API layer themselves.

**What they care about**:

- Time to first working agent (minutes, not months)
- Domain specificity (agents that know their business, not generic chatbots)
- Production reliability (agents that don't fail silently, lose state, or take unauthorized actions)
- Integration simplicity (call agents from existing apps via standard APIs)
- Long-term viability (open source, no vendor lock-in, real API contracts)

### Secondary: Platform Developers

**Who they are**: Backend and full-stack developers on the primary audience's team. They implement the agent integration.

**What they care about**:

- Clear, well-documented APIs
- YAML or code — their choice
- Local development that matches production (run everything locally, iterate fast)
- SDK quality (type-safe, idiomatic, well-documented)
- Standard protocols (gRPC, not proprietary)

### Anti-Personas

These are people we are explicitly NOT writing for. If copy resonates with an anti-persona but confuses the primary audience, the copy is wrong.

- **Infrastructure engineers** evaluating Kubernetes operators or deployment tools
- **Data scientists** looking for model training or fine-tuning
- **Hobbyists** building personal chatbot toys
- **No-code users** expecting a visual drag-and-drop builder
- **Enterprise procurement** reading compliance checklists (too early for this voice)

---

## 2. Positioning Statement

### Recommended

> For technical founders and engineering teams building AI-powered products, **Stigmer** is an open-source AI agent platform that turns domain knowledge and tools into agents you can call from any application. Unlike agent frameworks that require building your own infrastructure, Stigmer provides a complete agent runtime — durable execution, tool sandboxing, human approval flows, and real API contracts — so you ship agents to production instead of building plumbing.

### Components

| Component | Content |
|-----------|---------|
| **For** | Technical founders and engineering teams building AI-powered products |
| **Stigmer is** | An open-source AI agent platform |
| **That** | Turns domain knowledge and tools into agents you can call from any application |
| **Unlike** | Agent frameworks that require building your own infrastructure |
| **Stigmer provides** | A complete agent runtime — durable execution, tool sandboxing, human approval flows, and real API contracts |
| **So that** | You ship agents to production instead of building plumbing |

### Shorter Alternative

> Stigmer is an open-source platform for building AI agents that know your domain, use your tools, and ask before acting. Teach them what they need to know. Connect your systems. Set the rules. Stigmer handles the rest.

---

## 3. Messaging Pillars

Three primary pillars map to the progressive capability story. One foundation pillar covers the infrastructure that makes it all production-grade. The order matters — it's the order a new user experiences them.

### Pillar 1: Knows Your Business

**Claim**: "Teach your agent what generic AI doesn't know."

**What this means**: You upload domain knowledge — product docs, process guides, policies, institutional knowledge — and the agent uses it to answer questions and make decisions specific to your business.

**Product feature**: Skills — versioned knowledge artifacts that attach to agents. A skill is a directory with a markdown file. No embedding pipelines, no vector database configuration, no retrieval tuning.

**Proof point**: Without a skill, the agent gives generic answers. With a skill, it gives domain-expert answers. The difference is visible in one prompt.

**Copy example**: "Your AI doesn't know your return policy, your product catalog, or your escalation process. Stigmer agents do — because you teach them."

### Pillar 2: Uses Your Tools

**Claim**: "Agents that can act, not just talk."

**What this means**: Your agent can query databases, create tickets, send emails, update records — any action your systems support. Tool access uses the Model Context Protocol (MCP), an open standard.

**Product feature**: MCP server integration. Agents declare which tools they can use. Stigmer handles tool discovery, input validation, and execution sandboxing.

**Proof point**: An agent with tool access can look up an order, check its status, and initiate a return. An agent without tool access can only say "I'd be happy to help — please contact support."

**Copy example**: "Connect your agent to your systems. It checks inventory, creates tickets, updates records — with the same APIs your team already uses."

### Pillar 3: Asks Before Acting

**Claim**: "Human oversight built in, not bolted on."

**What this means**: You define which actions require human approval. The agent pauses, presents its reasoning, and waits for a human to approve or reject before proceeding. This is a control mechanism, not a logging feature.

**Product feature**: Human-in-the-loop approval flows. Configurable per tool — you decide which actions require a human decision. The agent's execution is durable — it waits indefinitely without losing state.

**Proof point**: An agent processing a refund pauses and asks a human to confirm. The human sees what the agent wants to do and why. If the human rejects, the agent adjusts. Routine questions and lookups are handled automatically — only the actions you designate require approval.

**Copy example**: "Your agent handles routine requests on its own. For anything sensitive, it asks a human first. You set the rules."

### Foundation: Built for Production

**Claim**: "Agent infrastructure you don't have to build."

**What this means**: Stigmer handles the operational complexity that makes agent frameworks unusable in production: durable execution that survives crashes, sandboxed tool access, state management across conversations, and real API contracts for multi-language integration.

**Product features**:

- Durable execution via Temporal — automatic retries, crash recovery, long-running operations
- gRPC API with public protobuf contracts — type-safe clients in Go, Python, Java, TypeScript, Rust
- Declarative resource model — agents are managed resources, not embedded code
- Open source under Apache 2.0 — inspect everything, self-host if needed

**Copy example**: "You don't build your own database. You don't build your own auth layer. Why build your own agent infrastructure?"

---

## 4. What Stigmer IS vs IS NOT

### Stigmer IS

- **A platform for running AI agents as services.** You define agents. Stigmer runs them. Your apps call them via API.
- **Declarative.** Agents are defined in YAML or code and managed as resources. Define once, run anywhere, update without redeploying consumers.
- **Progressive.** Start with domain knowledge (5-minute quickstart). Add tools when ready. Add approval flows when needed. Add multi-step workflows when the use case demands it.
- **Cloud-primary, open-source-always.** The fastest path is Stigmer Cloud. The full platform is open source under Apache 2.0. Same API contracts either way.
- **API-first.** Every capability is exposed through gRPC services with public protobuf contracts. The CLI, SDKs, and web console are all API consumers — no back channels.
- **LLM-agnostic.** Bring your own model — Anthropic, OpenAI, Ollama. Stigmer orchestrates the agent; it does not host the model.

### Stigmer IS NOT

- **A chatbot widget.** Stigmer does not provide a chat UI component. It provides the agent backend that your UI calls.
- **A RAG library.** Skills are versioned knowledge artifacts managed by the platform, not a retrieval-augmented generation pipeline you configure.
- **An LLM wrapper.** Stigmer does not proxy LLM calls. It provides orchestration, tool execution, state management, and durability around LLM-powered agents.
- **A no-code builder.** There is no drag-and-drop interface. Agents are defined in YAML or code. This is intentional — code is versionable, testable, reviewable, and composable.
- **A model hosting service.** Stigmer does not train, fine-tune, or serve LLMs. It uses them.
- **A replacement for your existing tools.** Stigmer connects to your systems through MCP. It complements your stack; it does not replace it.

---

## 5. Competitive Framing

How Stigmer is different from approaches the audience has already tried or considered. Never name specific competitors — describe the category and its limitations.

### vs. Direct LLM API Calls

**What they tried**: Called the OpenAI or Anthropic API directly. Built a prompt-in, response-out flow.

**Why it falls short**: The LLM doesn't know your business. It can't take actions in your systems. There's no state across conversations, no approval flow, no durability. Every call is a one-shot interaction.

**Stigmer's answer**: The LLM is one component. Stigmer adds domain knowledge, tool access, conversation memory, approval flows, and durable execution around it.

### vs. RAG Solutions

**What they tried**: Built a retrieval-augmented generation pipeline — embedded documents, set up a vector database, tuned retrieval parameters.

**Why it falls short**: RAG makes the agent better at answering questions from documents. It's a read-only capability. The agent still can't take actions, run workflows, or ask for human approval.

**Stigmer's answer**: Skills provide domain knowledge without requiring you to manage embedding pipelines or vector databases. And knowledge is just the starting point — tool access, approval flows, and workflow automation build on top.

### vs. Agent Frameworks

**What they tried**: Evaluated an agent framework. Started building with it.

**Why it falls short**: Frameworks give you agent primitives as a library. You still build the infrastructure: orchestration, durability, state management, API layer, tool security, deployment. Every app that uses the agent embeds the framework. Update the agent logic, redeploy every app.

**Stigmer's answer**: Platform, not framework. Define the agent once. Run it as a service. Call it from any app via API. Update the agent — every consumer benefits instantly. Stigmer provides the infrastructure layer that frameworks leave to you.

### vs. Workflow Automation Tools

**What they tried**: Set up automation flows — triggers, conditions, actions. Rigid, predefined paths.

**Why it falls short**: Traditional workflow automation can't reason. It follows predefined branches. It can't interpret ambiguous inputs, make judgment calls, or adapt when conditions don't match a pre-built rule.

**Stigmer's answer**: Agents handle ambiguity and judgment. Workflows handle sequence and reliability. Stigmer combines both — AI reasoning with structured automation — covering what neither can alone.

---

## 6. Headlines, Taglines, and Descriptions

### Headline Candidates

Each evaluated against three criteria:

1. Would a non-technical founder understand this in 3 seconds?
2. Does it differentiate from generic AI (ChatGPT)?
3. Does it promise a business outcome, not a technology?

| # | Headline | 3-Second Clarity | Differentiates | Business Outcome | Assessment |
|---|----------|:---:|:---:|:---:|---|
| A | **Build agents that work for your business** | Yes | Yes | Yes | Strong default. "Your business" separates from generic AI. |
| B | **AI agents that know your domain, use your tools, and follow your rules** | Yes | Yes | Yes | Specific. Maps to three pillars. Long — works better as a sub-headline. |
| C | **From chatbot to business agent in minutes** | Yes | Yes | Partially | Good before/after framing. "Business agent" is not yet established. |
| D | **Ship agents to production, not agent infrastructure** | Partially | Yes | Yes | Sharp contrast. More developer-facing — better for README or docs. |
| E | **The open platform for AI agents** | Yes | Partially | No | Simple but generic. Doesn't convey Stigmer's specific value. |

**Recommendation**: **A** as the primary headline. For the sub-headline, a condensed action-oriented version of the three pillars:

```
Build agents that work for your business
Teach them your domain. Connect your tools. Set your rules.
```

**B** works as a longer-form variant for contexts that need more explanation (e.g., meta descriptions, conference abstracts).

### One-Sentence Description

> Stigmer is an open-source AI agent platform that lets you turn domain knowledge and tools into agents your applications can call via API.

### One-Paragraph Description

> Stigmer is an open-source AI agent platform. Teach your agents what they need to know. Give them access to your tools. Set rules for when they should ask a human. Then call them from any application via a standard API. Stigmer handles the hard parts — durable execution, tool sandboxing, conversation memory, and multi-step workflows — so you ship agents to production instead of building agent infrastructure.

### Elevator Pitch (30 seconds)

> We're building Stigmer — an open-source platform for AI agents that actually work for your business. You teach the agent your domain, connect it to your tools, and set rules for when it needs human approval. Then any app in your stack can call that agent via API. We handle the infrastructure — durable execution, tool security, state management — so your team builds agents, not plumbing. It's open source, available as a cloud service or self-hosted, and the first agent takes five minutes.

---

## 7. Tone and Voice

### How Stigmer Sounds

**Confident, not arrogant.** State what Stigmer does directly. No superlatives, no "leading," no "revolutionary."

- Good: "Stigmer agents survive crashes and resume where they left off."
- Bad: "Stigmer's revolutionary durable execution engine ensures unparalleled reliability."

**Technical, not jargon-heavy.** Earn credibility through precision, not buzzword density. Use a technical term when it's the right word, not when it sounds impressive.

- Good: "Agents are defined in YAML and exposed via gRPC. Public protobuf contracts mean you generate type-safe clients in any language."
- Bad: "Our cutting-edge declarative resource orchestration layer leverages next-generation protocol buffer contracts."

**Ambitious, not hand-wavy.** Big vision (AI agents as a standard part of every software product), but every claim is grounded in something that exists today.

- Good: "Start with domain knowledge. Add tools when ready. Add approval flows when the use case demands it."
- Bad: "Stigmer will transform how businesses interact with AI forever."

**Direct, not padded.** Short sentences. Active voice. No filler. If a sentence doesn't add information or change the reader's understanding, cut it.

- Good: "Define your agent. Deploy it. Call it from your app."
- Bad: "It is important to note that Stigmer provides a comprehensive and powerful platform that enables you to define, deploy, and integrate AI agents."

**Pragmatic, not dogmatic.** AI agents are a new category. Best practices are still forming. Acknowledge this honestly rather than pretending to have all the answers.

- Good: "Agents work best when they can act on your behalf AND ask before acting on sensitive tasks. Stigmer supports both."
- Bad: "Autonomous AI is the future and Stigmer is the only way to get there."

### Voice by Context

| Context | Register | Example |
|---------|----------|---------|
| Sales headline | Outcome-focused, plain | "Build agents that work for your business" |
| Sales body | Benefit-first, minimal jargon | "Teach your agent your domain. Connect your tools. Set your rules." |
| Docs quickstart | Action-oriented, step-by-step | "Create a file called `agent.yaml` and paste the following." |
| Docs concepts | Explanatory, uses analogies | "A Skill is like a training manual for your agent." |
| README | Developer-direct, technical | "Single binary. SQLite for local dev. gRPC API." |
| Error messages | Helpful, specific, actionable | "Agent 'support-bot' not found. Run `stigmer list agents` to see available agents." |

---

*This document is the foundation for all Phase 1 deliverables. The demo story, use cases, vocabulary guide, and information architecture build on the decisions made here. No customer-facing copy should contradict this positioning.*
