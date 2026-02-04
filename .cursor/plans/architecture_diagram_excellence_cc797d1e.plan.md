---
name: Architecture Diagram Excellence
overview: "Create an industry-leading visual architecture diagram for stigmer.ai that shows the platform's unique value: agents as independent microservices with gRPC APIs, not libraries embedded in apps. The diagram will illuminate the developer journey and infrastructure abstraction in a way that makes the value proposition immediately graspable to sophisticated engineering audiences."
todos:
  - id: architecture-component
    content: Create Architecture.tsx component with three-column hero diagram (You Write → Stigmer Handles → You Integrate)
    status: completed
  - id: platform-comparison-visual
    content: Build PlatformComparisonVisual sub-component showing framework vs Stigmer approach side-by-side
    status: completed
  - id: developer-journey-flow
    content: Implement DeveloperJourneyFlow timeline (Develop → Add Complexity → Integrate → Scale)
    status: completed
  - id: svg-diagrams
    content: Hand-craft SVG elements for flow arrows, infrastructure layers, gRPC integration visuals
    status: completed
  - id: responsive-design
    content: Ensure responsive layout (3-col desktop, 2-col tablet, 1-col mobile)
    status: completed
  - id: integrate-homepage
    content: Add Architecture section to HomePage between Features and Integration
    status: completed
  - id: quality-validation
    content: Validate against 30-second test, differentiation test, technical credibility test, voice test
    status: completed
  - id: changelog
    content: Document design decisions and implementation in comprehensive changelog
    status: completed
isProject: false
---

# Architecture Diagram Excellence

## Vision

Create a visual diagram that crystallizes Stigmer's platform positioning in seconds. Not a generic boxes-and-arrows diagram, but a **visual narrative** showing:

1. **What you write** (5 lines of YAML or Go SDK)
2. **What Stigmer handles** (the entire infrastructure layer you skip)
3. **How you integrate** (standard gRPC from any language)

The diagram must answer: *"Why is this a platform, not a framework?"* at first glance.

## Architecture Insights from Codebase

Based on exploration of Stigmer's implementation:

**Core Flow:**

```
YAML Spec → Proto Conversion → Temporal Workflow → Isolated Execution → gRPC API
```

**Key Differentiators:**

- **Agents = Microservices**: Each agent is an independent service with gRPC contract
- **Infrastructure Abstraction**: Temporal orchestration, sandbox isolation, MCP security all hidden
- **Polyglot Integration**: Your apps call agents via standard gRPC (Go, Python, Java, TypeScript, Rust)
- **Local-First**: SQLite + Ollama (zero cloud dependency) → same code scales to production
- **No App Coupling**: Update agent once, all consumers benefit (vs redeploy every app with framework updates)

**Technical Stack Stigmer Handles:**

- Temporal workflows + activities (polyglot Go/Python)
- Three-tier sandboxing (local → basic Docker → full Docker)
- MCP server isolation and lifecycle
- gRPC code generation from protos
- BadgerDB/SQLite persistence
- Ollama LLM integration

## Diagram Design Strategy

### Component 1: Hero Architecture Diagram (Main Visual)

**Layout**: Three-column narrative flow

```
┌──────────────────┐    ┌─────────────────────────┐    ┌──────────────────┐
│   You Write      │ →  │   Stigmer Handles       │ →  │  You Integrate   │
│   (Input)        │    │   (Platform Layer)      │    │  (Output)        │
└──────────────────┘    └─────────────────────────┘    └──────────────────┘
```

**Left Column - "You Write" (Developer Input):**

- 5-line YAML code snippet (actual example from quickstart)
- OR Go SDK code snippet
- Annotation: "5 lines. No infrastructure code."
- Visual style: Code block with syntax highlighting

**Middle Column - "Stigmer Handles" (Platform Layer - The Magic):**

Top section - **Agent as Microservice**:

- Visual: Box labeled "Your Agent" with gRPC icon
- Subtext: "Independent service with gRPC contract"

Infrastructure boxes stacked vertically (what you DON'T have to build):

1. **Sandbox Isolation** (Shield icon)
  - "MCP servers isolated"
  - "File system controlled"
2. **Temporal Orchestration** (CPU/Workflow icon)
  - "Automatic retries"
  - "Durable state"
3. **MCP Security** (Lock icon)
  - "Tool filtering"
  - "Environment secrets"
4. **Local Runtime** (Terminal icon)
  - "SQLite + Ollama"
  - "Zero Docker required"

Visual style: Nested boxes showing layers

**Right Column - "You Integrate" (gRPC Integration):**

- Multiple language icons: Go, Python, Java, TypeScript, Rust
- gRPC client code snippet (1-liner from any app)
- Annotation: "Call like any microservice. Standard gRPC."
- Visual: Multiple apps calling same agent service

**Bottom Layer - Technical Foundation:**
Subtle gray bar showing Stigmer internals (for credibility):

- Temporal (Go workflows + Python activities)
- Sandboxing (local → Docker)
- BadgerDB/SQLite persistence
- gRPC contracts (public protos)

### Component 2: Platform vs Framework Comparison Visual

**Side-by-side comparison** (complements the Integration section text):

**Framework Approach** (left):

```
┌─────────────┐
│   App 1     │ ← imports agent lib
│  [Agent]    │
└─────────────┘

┌─────────────┐
│   App 2     │ ← imports agent lib
│  [Agent]    │
└─────────────┘

Update agent = redeploy both apps
```

**Stigmer Approach** (right):

```
┌─────────────┐
│   App 1     │ ──┐
└─────────────┘   │ gRPC calls
                  ↓
              ┌────────┐
              │ Agent  │ ← update once
              │Service │
              ┌────────┐
                  ↑
┌─────────────┐   │ gRPC calls
│   App 2     │ ──┘
└─────────────┘

Update agent = instant benefit for all
```

### Component 3: Developer Journey Flow

**Horizontal timeline** showing progression:

```
1. Develop Locally      2. Add Complexity       3. Integrate           4. Scale
   (YAML)         →        (Go SDK)       →        (gRPC)       →        (Production)
   
   stigmer server         optional                 any language           same code
   SQLite + Ollama        when needed             standard protocol       managed infra
```

Visual: Progressive enhancement story

## Implementation Plan

### Step 1: Create React Component Architecture

**New file**: `[site/src/components/sections/Architecture.tsx](site/src/components/sections/Architecture.tsx)`

Component structure:

- `<Architecture />` - Main section wrapper
- `<ArchitectureDiagram />` - Three-column hero visual
- `<PlatformComparisonVisual />` - Side-by-side framework vs platform
- `<DeveloperJourneyFlow />` - Horizontal timeline

**Styling approach**:

- Use Tailwind for layout (grid, flex)
- CSS animations for subtle visual interest (fade-in on scroll, hover states)
- SVG icons for technical stack (reuse existing Icon component)
- Gradient accents matching brand (primary blue, accent purple)

### Step 2: Create SVG Diagram Assets

**Option A: Pure SVG with React** (Recommended)

- Hand-craft SVG paths for flow arrows, boxes
- Full control, animatable, themeable
- Inline in TSX component

**Option B: Interactive Diagram Library**

- Use Mermaid for flowcharts (but limited styling)
- NOT RECOMMENDED: Generic output conflicts with "world-class" goal

**Recommendation**: Pure SVG with React for maximum quality and brand consistency.

### Step 3: Content Refinement

**Code snippets** (real examples, not placeholders):

YAML snippet (left column):

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: code-reviewer
spec:
  instructions: "Review code for security"
  mcpServers: [github]
```

gRPC integration snippet (right column):

```go
execution, err := client.Create(ctx, &AgentExecution{
    Spec: &AgentExecutionSpec{
        AgentId: "code-reviewer",
        Input: "Review PR #123",
    },
})
```

**Annotations** (punchy, not verbose):

- Left: "5 lines. No infrastructure code."
- Middle: "We handle sandboxing, orchestration, MCP security"
- Right: "Call from any language. Standard gRPC."

### Step 4: Visual Design Excellence

**Typography hierarchy**:

- Section title: 3xl-5xl, gradient text
- Column headers: xl-2xl, bold
- Annotations: sm-base, muted color
- Code: mono font, syntax highlighting

**Color strategy**:

- Developer input (left): Neutral (code blocks)
- Platform layer (middle): Brand gradient (blue → purple) for "magic"
- Integration (right): Success green accent (it just works)

**Spacing and rhythm**:

- Generous whitespace (py-24 section)
- Consistent grid gaps (gap-6 to gap-12)
- Visual breathing room between layers

**Iconography**:

- Reuse existing Icon component
- New icons if needed: workflow, sandbox, microservice
- Consistent size and weight

### Step 5: Responsive Design

**Desktop (lg+)**:

- Three-column layout for hero diagram
- Side-by-side platform comparison
- Horizontal developer journey

**Tablet (md)**:

- Two-column layout (input + platform, then integration below)
- Stacked platform comparison
- Horizontal journey with smaller text

**Mobile (sm)**:

- Single column, vertical flow
- Simplified diagram (reduce detail)
- Touch-friendly interactions

### Step 6: Animation and Interactivity

**Subtle enhancements** (not gimmicky):

- Fade-in on scroll (Intersection Observer)
- Hover states on infrastructure boxes (subtle glow)
- Arrow animations showing flow direction
- Code snippet syntax highlighting

**Performance**:

- CSS animations (hardware accelerated)
- No heavy JavaScript libraries
- Lazy load component if below fold

### Step 7: Integration into Homepage

Update `[site/src/components/pages/HomePage.tsx](site/src/components/pages/HomePage.tsx)`:

```tsx
<Hero />
<Features />
<Architecture />  {/* NEW - after Features, before Integration */}
<Integration />
<Quickstart />
```

**Positioning rationale**:

- After Features (builds on "what we handle")
- Before Integration (sets up "platform vs framework" discussion)
- Visual break between text-heavy sections

### Step 8: Quality Validation

**30-Second Test**:

- User sees diagram
- Within 30 seconds, understands: "Agents are microservices, not libraries"

**Differentiation Test**:

- Diagram makes platform vs framework distinction obvious
- Not achievable with LangChain/CrewAI (framework approach)

**Technical Credibility Test**:

- Engineers see real code, real stack (Temporal, gRPC, BadgerDB)
- Not abstract boxes, but specific implementation details

**Voice Test**:

- Confident, not defensive
- Technical, not dumbed down
- Clear, not clever

## Files to Create/Modify

### New Files

1. `[site/src/components/sections/Architecture.tsx](site/src/components/sections/Architecture.tsx)` - Main diagram component (est. 400-600 lines)

### Modified Files

1. `[site/src/components/pages/HomePage.tsx](site/src/components/pages/HomePage.tsx)` - Add Architecture section
2. `[site/src/components/ui/icon.tsx](site/src/components/ui/icon.tsx)` - Add new icons if needed (workflow, microservice)
3. `[site/src/lib/constants.ts](site/src/lib/constants.ts)` - Add architecture diagram constants if needed

### Changelog

1. New file: `_changelog/2026-02/2026-02-04-architecture-diagram.md` - Document design decisions and implementation

## Success Criteria

1. **Visual Impact**: Diagram is immediately graspable, not generic
2. **Technical Accuracy**: All code snippets are real, all stack details verified
3. **Brand Consistency**: Matches Stigmer design system (colors, typography, spacing)
4. **Mobile Responsive**: Works beautifully on all screen sizes
5. **Performance**: Zero layout shift, fast load, smooth animations
6. **Content Excellence**: No AI-flavored filler, every word earns its place
7. **Industry Standard**: Sets a new bar for platform architecture diagrams

## Design Principles

Following your mandate for world-class quality:

**Original, Not Generic**:

- Custom SVG diagrams, not stock icons
- Stigmer-specific architecture, not abstract cloud boxes
- Real code snippets, not pseudocode placeholders

**Sophisticated Audience**:

- Engineers understand Temporal, gRPC, microservices
- Show the polyglot architecture (Go orchestration + Python AI)
- Reference real implementation (BadgerDB, Ollama, public protos)

**High Impact**:

- Answer "platform vs framework" visually in 30 seconds
- Make the marketplace opportunity obvious (agents as services)
- Show the progression path (local → production, same code)

**Precision and Clarity**:

- No defensive language ("better than X")
- Outcome-focused annotations ("Zero cloud dependency", "Call from any language")
- Technical specificity (not "database" but "SQLite/BadgerDB")

This diagram will be the visual anchor that makes Stigmer's unique value proposition immediately clear to every engineer who lands on stigmer.ai.