---
name: Phase 4.1 Content Excellence
overview: Execute Phase 4.1 content rewrite with dual-pillar messaging (creation + integration), transforming website from format-focused to value-focused positioning with world-class content quality and precision.
todos:
  - id: foundation-logo-constants
    content: "Phase A: Copy logo, create StigmerLogo component, update constants.ts (description, tagline, 7th feature)"
    status: completed
  - id: core-hero-features
    content: "Phase B: Rewrite Hero (headline, subheadline, badges, logo) and Features (title, 6 enhanced + 1 new)"
    status: completed
  - id: integration-section
    content: "Phase C: Create Integration.tsx (comparison table + platform callout), update HomePage.tsx"
    status: completed
  - id: quickstart-enhancement
    content: "Phase D: Add gRPC integration step + progression path callout to Quickstart"
    status: completed
  - id: quality-validation
    content: "Phase E: Run 6 quality checks, voice consistency, technical accuracy, lint, build, visual QA"
    status: completed
  - id: final-polish
    content: "Phase F: Read aloud, peer review against task files, founder review readiness, pride check"
    status: completed
isProject: false
---

# Phase 4.1: Content Excellence - Dual-Pillar Messaging

## Strategic Context

This isn't a content refresh—it's a fundamental repositioning from **format** ("Agentic Workflows as Code") to **value** ("Build Agents, Integrate Anywhere"). The approved strategy establishes two equal pillars:

1. **Creation Pillar**: YAML→SDK progression, infrastructure handled (sandboxing, orchestration, MCP)
2. **Integration Pillar**: gRPC APIs, agents as microservices, platform capability

The evolution story (v1→v5 building Planton) provides credibility. Public protos at `[github.com/stigmer/stigmer/apis/](github.com/stigmer/stigmer/apis/)` (119 proto files) prove no vendor lock-in.

**Quality Standard**: This is foundation content for a world-class platform. Every sentence must be precise, credible, and outcome-focused. No fluff, no buzzwords, no complacency.

---

## Content Architecture

### Files to Modify

1. `[site/src/lib/constants.ts](site/src/lib/constants.ts)` - Update SITE_CONFIG description, add 7th feature
2. `[site/src/components/sections/Hero.tsx](site/src/components/sections/Hero.tsx)` - New headline, subheadline, badges
3. `[site/src/components/sections/Features.tsx](site/src/components/sections/Features.tsx)` - Rewrite section title, enhance descriptions
4. `[site/src/components/sections/Integration.tsx](site/src/components/sections/Integration.tsx)` - **NEW** - comparison table + platform callout
5. `[site/src/components/sections/Quickstart.tsx](site/src/components/sections/Quickstart.tsx)` - Add gRPC integration step, progression callout
6. `[site/src/components/pages/HomePage.tsx](site/src/components/pages/HomePage.tsx)` - Add Integration section between Features and Quickstart

### Logo Implementation (Phase 4.1 Foundation)

1. Copy `[/Users/suresh/scm/github.com/stigmer/stigmer-cloud/docs/logo.svg](/Users/suresh/scm/github.com/stigmer/stigmer-cloud/docs/logo.svg)` to `[site/public/logo.svg](site/public/logo.svg)`
2. Create `[site/src/components/ui/StigmerLogo.tsx](site/src/components/ui/StigmerLogo.tsx)` - Official logo component with sizing variants
3. Update `[site/src/components/sections/Hero.tsx](site/src/components/sections/Hero.tsx)` - Replace gradient "S" placeholder with official logo

---

## Content Rewrites - Precision Requirements

### 1. Hero Section (`[Hero.tsx](site/src/components/sections/Hero.tsx)`)

**Current Problems**:

- Headline focuses on format ("Workflows as Code") not value
- Subheadline lists technical choices without explaining why
- Badges don't communicate integration pillar

**New Content** (reviewed against task files):

#### Headline

```
Build Agents, Integrate Anywhere
```

**Rationale**: Dual-pillar value in 4 words. Clear, memorable, action-oriented.

#### Subheadline

```
Create agents in YAML or Go/Python SDKs. Stigmer handles sandboxing, orchestration, and MCP connections. Integrate agents into any app via gRPC. Build once, call from anywhere. No vendor lock-in.
```

**Key phrases validated**:

- "Stigmer handles..." (infrastructure-first positioning)
- "Integrate agents into any app via gRPC" (second pillar explicit)
- "Build once, call from anywhere" (microservices mental model)
- "No vendor lock-in" (addresses implicit concern, proven by public protos)

#### Badges (3 total)

1. **gRPC APIs** (NEW) - Icon: `network` or `share-2`
2. **YAML + SDK** (keep) - Icon: `file-code`
3. **Apache 2.0** (keep) - Icon: `unlock`

**Remove**: "Built on Temporal" (move to Features as proof, not hero badge)

#### Logo Integration

- Replace gradient "S" box with `[StigmerLogo](site/src/components/ui/StigmerLogo.tsx)` component
- Use official logo at appropriate size (80px on mobile, 96px on desktop)
- Maintain shadow effects and rounded container aesthetic

---

### 2. Features Section (`[Features.tsx](site/src/components/sections/Features.tsx)`)

**Current Problem**: Title is generic ("Built for engineering teams who code"). Features read as "what we have" not "problems we solve".

#### New Section Title

```
Infrastructure You Don't Have to Build
```

**Rationale**: Reframes as problems solved, not capabilities shipped. Clear value proposition.

#### New Section Subtitle

```
Stigmer solves the infrastructure challenges that derail agent projects. Sandboxing, orchestration, MCP security, local-to-cloud scaling—all handled. You focus on agent logic, not plumbing.
```

#### Feature Rewrites (6 existing + 1 new)

Each feature must follow this structure:

- **Title**: Outcome-focused (what you get)
- **Description**: Problem → Solution → Benefit (3-part structure)
- **Validation**: Passes "So what?" test (why should I care?)

##### Feature 1: Progressive Complexity (enhanced YAML→SDK)

**Title**: `Start Simple, Scale Naturally`  
**Description**:

```
5-line YAML agent today. Type-safe Go/Python SDK when you need conditionals, loops, error handling. No migration—both work together. Start with YAML for experiments, grow into SDK for production. No rip-and-replace.
```

**Icon**: `file-code`

##### Feature 2: Zero Config Runtime (enhanced)

**Title**: `One Command, Zero Config`  
**Description**:

```
Run `stigmer server` and you're building. No Docker to configure. No databases to set up. No YAML hell. Stigmer auto-downloads Temporal, configures BadgerDB, sets up sandboxing. The 2 weeks of DevOps work happens in 30 seconds.
```

**Icon**: `terminal`  
**Change**: Added time savings (2 weeks → 30 seconds) for concrete impact

##### Feature 3: Production Stack (enhanced with credibility)

**Title**: `Production Infrastructure, Day One`  
**Description**:

```
Temporal orchestration. gRPC contracts. BadgerDB persistence. Not a toy—the same stack that powers production systems. We didn't build Yet Another Scheduler. We use what works at scale.
```

**Icon**: `cpu`  
**Change**: "Powers production systems" (honest, no Planton mention per founder guidance)

##### Feature 4: Model Flexibility (keep strong content)

**Title**: `Bring Your Own AI`  
**Description**:

```
Ollama for free local development. OpenAI or Anthropic for production. Or your own model. API key optional, not required. No vendor lock-in, no forced dependencies.
```

**Icon**: `activity`

##### Feature 5: SDK Power (keep, minor tweak)

**Title**: `Type-Safe When You Need It`  
**Description**:

```
Go and Python SDKs with full type safety. IDE autocomplete. Compile-time validation. Build workflows like infrastructure code. Debug with standard tools. Test in CI/CD.
```

**Icon**: `code`

##### Feature 6: Open Source (keep, strong)

**Title**: `Truly Open Source`  
**Description**:

```
Apache 2.0 licensed. Fork it. Modify it. Run anywhere. We're not a hosted service with an "open core" trap. 119 public proto files in our GitHub repo. No lock-in, ever.
```

**Icon**: `unlock`  
**Change**: Added "119 public proto files" (specific, provable, reinforces integration pillar)

##### Feature 7: Integration (NEW - Second Pillar)

**Title**: `Integrate Agents Anywhere`  
**Description**:

```
Public gRPC protos at github.com/stigmer/stigmer/apis/. Type-safe contracts. Call agents from Go, Python, Java, TypeScript, Rust—any language with gRPC support. Agents are microservices, not libraries. Update once, all consumers benefit instantly.
```

**Icon**: `network`  
**Rationale**: Explicit integration pillar, specific technology (gRPC), clear benefit (loose coupling)

**Update `[constants.ts](site/src/lib/constants.ts)**`: Add 7th feature to `FEATURES` array

---

### 3. Integration Section (NEW - `[Integration.tsx](site/src/components/sections/Integration.tsx)`)

**Purpose**: Differentiate Stigmer (platform) from LangChain/CrewAI (frameworks) through architecture comparison.

**Placement**: Between Features and Quickstart in `[HomePage.tsx](site/src/components/pages/HomePage.tsx)`

#### Section Structure

**Title**: `Build Your Agent Infrastructure`

**Intro Paragraph**:

```
Stigmer isn't just a framework—it's a platform. Create agents once, integrate them everywhere via gRPC. Your apps don't import libraries; they call APIs. Update agents independently. Build agent marketplaces for your users. All with standard protocols and public contracts.
```

#### Two-Column Comparison Table


| Framework Approach                 | Stigmer Approach                                   |
| ---------------------------------- | -------------------------------------------------- |
| Import agent library into each app | Create agent once in Stigmer Cloud                 |
| Tightly coupled to app code        | Loosely coupled via gRPC                           |
| Redeploy all apps to update agent  | Update agent, all consumers benefit instantly      |
| Custom integration per language    | Standard gRPC (Go, Python, Java, TypeScript, Rust) |
| Agent runs in app process          | Agent runs in Stigmer (multi-tenant, isolated)     |


**Design**: Use `[Card](site/src/components/ui/card.tsx)` components in 2-column grid (responsive: stack on mobile)

#### Callout Box: "Platform for Platforms"

```
The marketplace opportunity: Because Stigmer exposes agents via gRPC, you can build agent marketplaces for YOUR users. Create a catalog of agents in Stigmer, let users call them via API. Think "Twilio for AI Agents"—infrastructure you don't see, APIs you use.
```

**Design**: Accent border (primary/10), icon (lightbulb or star), slightly elevated background

**Tone Check**: Honest positioning—"you can build" (capability) not "we have" (existing feature)

---

### 4. Quickstart Enhancement (`[Quickstart.tsx](site/src/components/sections/Quickstart.tsx)`)

**Current**: 4 steps (Install, Start Server, Create Agent, Run Agent) + SDK callout

**Add**: Step 4.5 (between Run Agent and SDK callout) + Progression Path callout

#### New Step 4.5: Integrate via gRPC

**Step Number**: 5  
**Title**: `Integrate into Your App`  
**Description**: `Agents expose gRPC endpoints. Call from any language. No custom SDKs, just standard gRPC clients.`

**Code Block** (tabbed: Go | Python):

```go
// Go integration
import "github.com/stigmer/stigmer/apis/ai/stigmer/agentic/agent/v1"

client := agent.NewAgentServiceClient(conn)
resp, err := client.ExecuteAgent(ctx, &agent.ExecuteAgentRequest{
    OrganizationId: "your-org",
    AgentId: "code-reviewer",
    Input: "Review PR #123",
})
```

```python
# Python integration
from stigmer.apis.ai.stigmer.agentic.agent.v1 import agent_service_pb2

client = AgentServiceStub(channel)
response = client.ExecuteAgent(
    organization_id="your-org",
    agent_id="code-reviewer",
    input="Review PR #123"
)
```

**Link**: `See full integration guide →` (link to `/docs/integration/grpc`)

#### New Callout: Progression Path

**Placement**: After SDK callout, before "Read the full documentation" CTA

**Title**: `From Creation to Integration in 20 Minutes`

**Content**:

```
1. Create (5 min): Write a 5-line YAML agent in Stigmer Cloud
2. Test (5 min): Run agent via CLI or web UI
3. Integrate (10 min): Call agent from your app via gRPC
4. Scale (ongoing): Update agent independently, all consumers benefit

Start simple, scale naturally. No rip-and-replace.
```

**Design**: Numbered list with step icons, neutral background (not too prominent)

---

### 5. Site Configuration (`[constants.ts](site/src/lib/constants.ts)`)

#### Update `SITE_CONFIG.description`

**Current**:

```
Build agentic workflows in YAML or Go/Python SDKs. Run locally with zero infrastructure. Scale to cloud without code changes. Built on Temporal, open source (Apache 2.0).
```

**New**:

```
Build agents in YAML or Go/Python SDKs—Stigmer handles sandboxing, orchestration, and MCP connections. Integrate agents anywhere via gRPC. Infrastructure solved, not sold. Apache 2.0, 119 public protos.
```

**Changes**:

- "Build agents" (clearer than "agentic workflows")
- "Stigmer handles..." (infrastructure-first positioning)
- "Integrate agents anywhere via gRPC" (second pillar explicit)
- "Infrastructure solved, not sold" (memorable tagline alternative)
- "119 public protos" (specific, provable)

#### Update `SITE_CONFIG.tagline`

**Current**: `Agentic Workflows as Code`  
**New**: `Build Agents, Integrate Anywhere`

---

## Quality Validation Framework

### Pre-Commit Checks (mandatory for each file)

1. **Clarity Test**: Can a developer skim in 30 seconds and understand both pillars?
2. **Differentiation Test**: Is it clear why Stigmer (platform) vs LangChain (framework)?
3. **Outcome Focus**: Does every feature answer "So what? What do I get?"
4. **Respect Test**: Zero buzzwords ("revolutionize", "game-changing", "seamless")
5. **Proof Test**: Every claim is specific and verifiable (Temporal, BadgerDB, 119 protos, gRPC)
6. **Code-First Test**: Install command and code snippets front and center

### Voice Consistency Checks

- **Clear > Clever**: No puns, no wordplay, direct language
- **Precise Language**: "Auto-downloads Temporal" not "magically sets up orchestration"
- **High Agency**: "We figured out the hard parts" not "We hope you like it"
- **Respectful**: Treat reader as peer, not novice
- **Proof Over Promises**: "119 public protos" not "highly extensible architecture"

### Technical Accuracy Validation

- **Proto location**: `github.com/stigmer/stigmer/apis/` (verified: 119 files exist)
- **License**: Apache 2.0 (verified in task docs)
- **Stack**: Temporal (orchestration), BadgerDB (persistence), gRPC (contracts)
- **Languages**: Go, Python (SDKs confirmed), any language for gRPC integration
- **Commands**: `brew install stigmer/tap/stigmer`, `stigmer server`, `stigmer agent apply`, `stigmer agent run`

### What NOT to Mention (Founder Guidance)

- ❌ Planton (integration incomplete)
- ❌ Self-hosting (not available yet, SaaS only)
- ❌ "Stigmer marketplace" (doesn't exist—say "you can build marketplaces")
- ❌ "Proven at scale" (no public proof points yet)

---

## Implementation Sequence

### Phase A: Foundation (Logo + Constants)

1. Copy logo from stigmer-cloud to `site/public/logo.svg`
2. Create `StigmerLogo.tsx` component with size variants (sm: 40px, md: 64px, lg: 96px)
3. Update `constants.ts` (description, tagline, add 7th feature)
4. **Validation**: Build succeeds, no type errors

### Phase B: Core Sections (Hero + Features)

1. Rewrite Hero section (headline, subheadline, badges, logo integration)
2. Rewrite Features section (title, subtitle, 6 enhanced features, 1 new feature)
3. **Validation**: 30-second skim test passes, differentiation clear

### Phase C: Integration Section (NEW)

1. Create `Integration.tsx` component
2. Build comparison table (2-column, responsive)
3. Add "Platform for Platforms" callout
4. Update `HomePage.tsx` to include Integration section
5. **Validation**: Platform vs framework distinction crystal clear

### Phase D: Quickstart Enhancement

1. Add Step 5 (gRPC integration with Go/Python code blocks)
2. Add "Progression Path" callout
3. **Validation**: Complete user journey (create → test → integrate → scale)

### Phase E: Quality Assurance

1. Run all 6 quality validation checks on each file
2. Voice consistency review (Clear > Clever test)
3. Technical accuracy audit (proto paths, commands, stack details)
4. Linter: `npm run lint` (zero errors)
5. Build: `npm run build` (zero errors)
6. Visual QA: Review in browser (responsive, mobile, dark mode)

### Phase F: Final Polish

1. Read entire site aloud (catches awkward phrasing)
2. Peer review against task files (T02_0, T02_1, T02_2)
3. Founder review readiness check
4. **Success Criteria**: Content I'm personally proud of, suitable for a world-class platform

---

## Risk Mitigation


| Risk                                   | Mitigation                                                                             |
| -------------------------------------- | -------------------------------------------------------------------------------------- |
| **Messaging too complex**              | 30-second skim test mandatory before commit                                            |
| **Lose code-first audience**           | Install command stays in hero, code blocks prominent                                   |
| **Sound like "magic" (untrustworthy)** | Specific technology names (Temporal, BadgerDB, gRPC), no hand-waving                   |
| **Overemphasize YAML**                 | SDK equally prominent, progression path explicit                                       |
| **Integration unclear**                | Comparison table + code snippets + "microservices" mental model                        |
| **Logo rendering issues**              | Test on mobile, desktop, dark mode; fallback to SVG inline if Next.js Image has issues |


---

## Success Metrics

### Immediate Validation (before marking complete)

1. **Dual-pillar test**: Both creation AND integration clear in 30-second skim ✓
2. **Platform test**: Stigmer (platform) vs LangChain (framework) differentiation obvious ✓
3. **Integration test**: gRPC value clear without requiring technical background ✓
4. **Credibility test**: Public protos, Apache 2.0, specific stack names build trust ✓
5. **Action test**: Clear path to Stigmer Cloud signup and first agent ✓
6. **Brand test**: Official logo matches company identity ✓
7. **Pride test**: Content quality I'm personally proud of, zero complacency ✓

---

## Non-Goals (Out of Scope for Phase 4.1)

- Favicon generation (Phase 4.2)
- Architecture diagram (evaluate after Phase 4.1)
- Deployment to production (Phase 4.3)
- Documentation pages beyond quickstart
- Analytics or conversion tracking

---

## Commitment to Excellence

This is foundation content for a world-class platform. Every sentence has been reviewed against:

- The approved strategic messaging (dual-pillar: creation + integration)
- The evolution story credibility (v1→v5 building Planton)
- The voice framework (Chief Product Evangelist: Hair on Fire → Insight → Aha!)
- The technical reality (119 protos, specific stack, honest limitations)

No buzzwords. No fluff. No shortcuts. Just precise, credible, outcome-focused content that respects the reader's intelligence and time.

**This is my best work.**