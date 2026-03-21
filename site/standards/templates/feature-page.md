# Page Template: Feature Page

<!--
  FEATURE PAGE TEMPLATE
  =====================
  Type: Feature
  URL: /features/{feature-slug}
  Funnel: Interest → Evaluation
  Personas: All

  Feature pages are deep-dives on a single major capability. They go
  beyond the homepage feature card to explain why the capability matters,
  how it works under the hood, and what it looks like in practice.
  These pages earn technical trust through depth and specificity.
-->

## Page Metadata

| Field | Requirement |
|---|---|
| **Page type** | Feature |
| **URL pattern** | `/features/{feature-slug}` |
| **Funnel stages** | Interest → Evaluation |
| **Target personas** | All (depth appeals to engineering leaders; code appeals to solo developers) |
| **Visitor goal** | Understand a specific capability in depth |
| **Success metric** | Click-through to quickstart or docs |

## Required Metadata

| Tag | Constraint |
|---|---|
| `<title>` | Max 60 chars. Format: `{Feature Name}: {Benefit} | Stigmer` |
| `<meta description>` | Max 160 chars. Feature benefit + specific detail + CTA. |
| `og:title` | Matches or abbreviates `<title>` |
| `og:description` | Matches or abbreviates `<meta description>` |
| `og:image` | 1200x630px. Feature-specific visual. |
| `og:url` | Canonical URL |
| `twitter:card` | `summary_large_image` |

## Structured Data

- `SoftwareApplication` (capability-focused)

## Narrative Arc

1. **Hook** (Hero) — Benefit-first headline. Why does this capability matter?
2. **Explain** (Explanation) — How does it work? Architecture, design decisions, technical depth.
3. **Show** (Code Showcase) — What does it look like in practice? Real code, real output.
4. **Persuade** (Benefits) — What outcomes does the developer get? Concrete, verifiable.
5. **Convert** (CTA Band) — Try it yourself.

## Section Sequence

### 1. Hero

- **Template**: [`section-hero.md`](section-hero.md)
- **Page-specific**: Headline leads with the benefit, not the feature name. "Your agents survive crashes and resume where they left off" (benefit) rather than "Durable Execution" (feature name). The feature name appears in the subheadline or breadcrumb.
- **Visual anchor**: A code snippet or terminal output that demonstrates the capability. For Durable Execution: a terminal showing an agent resuming after a crash. For Local-First: the `brew install` → `stigmer run` sequence.

### 2. Explanation

- **Job**: Explain how the capability works with enough technical depth to satisfy a curious developer.
- **Required elements**:
  - 2-4 paragraphs explaining the architecture, design decisions, and underlying technology.
  - At least one diagram (Mermaid, ASCII, or SVG) showing the architecture or data flow.
  - Named technologies: "Powered by Temporal," "Uses the Model Context Protocol," "gRPC API." Specificity builds trust.
- **Copy guidance**: This section is the technical deep-dive. Write it as if explaining to a senior engineer who is evaluating the approach. Do not oversimplify — the visitor came to this page because the homepage feature card was not enough.
- **Constraint**: Every architectural claim must be accurate and current. If Stigmer uses Temporal for durable execution, explain what Temporal provides and how Stigmer uses it — do not hand-wave with "advanced durability engine."

### 3. Code Showcase

- **Template**: [`section-code-showcase.md`](section-code-showcase.md)
- **Page-specific**: Show the capability in action with a concrete example.
  - Declarative YAML: A complete agent YAML that uses this feature.
  - Durable Execution: Terminal output showing checkpoint + resume.
  - MCP Tool Protocol: An MCP server configuration in the agent YAML.
  - Human-in-the-Loop: A YAML with approval policies + terminal showing the approval flow.
  - Local-First: The install-to-run sequence with zero cloud dependency.
  - Platform for Platforms: SDK code importing and using a Stigmer component.
- **Constraint**: Code must be runnable or clearly derivable from runnable code. Pseudocode is not acceptable on a feature page.

### 4. Benefits

- **Job**: Translate the technical capability into concrete developer outcomes.
- **Required elements**:
  - 3-5 benefit statements, each following the Feature → Benefit → Proof pattern.
  - Each benefit is a self-contained item: a short headline (benefit), a 1-2 sentence explanation (feature), and a proof point (code, metric, or link).
- **Copy guidance**: Benefits are distinct from the explanation section. The explanation says "how it works." Benefits say "what you get." "Your agent survives crashes" is a benefit. "Temporal-backed durable execution with per-tool-call checkpointing" is the explanation.
- **Layout**: Card grid or list. 2-3 columns on desktop, stacked on mobile.

### 5. CTA Band

- **Template**: [`section-cta-band.md`](section-cta-band.md)
- **Page-specific**: Headline connects to the feature. "Try durable execution yourself — install Stigmer in one command." Primary CTA leads to quickstart. Secondary CTA leads to the relevant docs deep-dive.

## CTA Strategy

| CTA | Label | Destination |
|---|---|---|
| **Primary** | "Try It Yourself" / "Follow the Quickstart" | Quickstart docs |
| **Secondary** | "Read the {Feature} Guide" | Docs deep-dive for this feature |
| **Tertiary** | "See how {persona} uses this" | Relevant use-case page |

## Internal Linking Requirements

| Destination | Anchor Text Pattern |
|---|---|
| Use-case pages | "See this in action for {persona}" |
| Other feature pages | "Related: {feature}" — cross-link complementary capabilities |
| Docs deep-dive | "Read the {feature} guide" |

## Quality Checklist

- [ ] All 5 required sections present (Hero, Explanation, Code Showcase, Benefits, CTA Band)
- [ ] Hero headline leads with the benefit, not the feature name
- [ ] Explanation includes a diagram and names underlying technologies
- [ ] Code showcase shows a runnable or clearly derivable example
- [ ] 3-5 benefits follow the Feature → Benefit → Proof pattern
- [ ] Links to use-case pages, other feature pages, and docs
- [ ] No banned phrases
- [ ] Terminology matches `terminology.json`
- [ ] Unique `<title>` under 60 characters
- [ ] Unique `<meta description>` under 160 characters with CTA
- [ ] One `<h1>`, sequential heading levels
- [ ] JSON-LD: SoftwareApplication
- [ ] OG and Twitter Card meta tags present
- [ ] Responsive at all four breakpoints
- [ ] WCAG 2.1 AA compliant
