# Page Template: Use-Case Page

<!--
  USE-CASE PAGE TEMPLATE
  ======================
  Type: Use-Case
  URL: /use-cases/{persona-slug}
  Funnel: Interest → Evaluation
  Personas: One specific persona per page

  Use-case pages are persona-specific stories. They start with the
  visitor's problem, show how Stigmer solves it, prove the solution
  works, and offer a clear next step. Each page speaks to exactly one
  persona in their language, addressing their specific objections.
-->

## Page Metadata

| Field | Requirement |
|---|---|
| **Page type** | Use-Case |
| **URL pattern** | `/use-cases/{persona-slug}` |
| **Funnel stages** | Interest → Evaluation |
| **Target persona** | Exactly one (solo-developer, platform-builder, or engineering-leader) |
| **Visitor goal** | See how Stigmer solves their specific problem |
| **Success metric** | Click-through to quickstart or install command |

## Required Metadata

| Tag | Constraint |
|---|---|
| `<title>` | Max 60 chars. Format: `Stigmer for {Persona} | Stigmer` or `{Problem Statement} | Stigmer` |
| `<meta description>` | Max 160 chars. Persona-specific value proposition + CTA. |
| `og:title` | Matches or abbreviates `<title>` |
| `og:description` | Matches or abbreviates `<meta description>` |
| `og:image` | 1200x630px. Persona-specific or capability-specific. |
| `og:url` | Canonical URL |
| `twitter:card` | `summary_large_image` |
| `persona` | Custom meta tag or data attribute identifying the target persona |

## Structured Data

- `SoftwareApplication` (capability-focused)
- `FAQPage` (if FAQ section is included)

## Narrative Arc

Each use-case page tells a persona-specific story:

1. **Problem** — Name the pain the persona knows. Start in their world, not Stigmer's.
2. **Solution** — Show how Stigmer addresses each aspect of the problem.
3. **Proof** — Demonstrate with code, architecture, or metrics that the solution works.
4. **Action** — Give a clear next step that matches the persona's evaluation style.

## Section Sequence

### 1. Hero

- **Template**: [`section-hero.md`](section-hero.md)
- **Page-specific**: Headline names the persona's problem or goal, not Stigmer's feature. "Ship AI agents without building infrastructure" (solo developer) vs. "Embed agentic capabilities into your platform" (platform builder).
- **Visual anchor**: Code snippet relevant to the persona's workflow (YAML for solo dev, SDK import for platform builder, architecture diagram for engineering leader).

### 2. Problem

- **Job**: Name the pain. Start in the visitor's world.
- **Required elements**:
  - A description of the status quo pain (2-3 paragraphs max)
  - Specific examples of what goes wrong today (build custom orchestration, manage state yourself, debug opaque failures)
  - Optional: A "bad code" example showing the pain (complex retry logic, manual state management)
- **Copy guidance**: Write from the visitor's perspective. "You spend weeks building agent orchestration instead of building your product." Use second person. Name specific technologies and patterns they are currently dealing with.
- **Constraint**: The problem section must be recognizable to the target persona. If a solo developer reads it and thinks "that is not my problem," the section has failed.

### 3. Solution

- **Job**: Show how Stigmer addresses each aspect of the problem.
- **Required elements**:
  - Point-by-point mapping from problem to solution (2-4 items)
  - Each point includes a benefit statement, the Stigmer feature that delivers it, and a proof artifact
  - At least one code snippet showing the Stigmer approach (YAML, CLI command, or SDK usage)
- **Copy guidance**: Mirror the problem section's structure. If the problem named three pain points, the solution addresses the same three. Use the Feature → Benefit → Proof pattern.
- **Constraint**: Solutions must be specific to the persona. The solo developer cares about "install and run locally in 3 commands." The platform builder cares about "import `@stigmer/react` and embed the agent viewer."

### 4. Proof

- **Job**: Demonstrate that the solution works with concrete evidence.
- **Required elements**:
  - Code showcase (see [`section-code-showcase.md`](section-code-showcase.md)) showing a persona-relevant workflow
  - At least one of: terminal output, architecture diagram, metric, or comparison to the status quo approach
- **Copy guidance**: Let the artifacts speak. The proof section is more code than copy. A side-by-side comparison ("50 lines of custom retry logic" vs. "declarative YAML with built-in durability") is highly effective.

### 5. CTA Band

- **Template**: [`section-cta-band.md`](section-cta-band.md)
- **Page-specific**: CTA matches the persona's natural next step.
  - Solo developer: "Install Stigmer" → quickstart
  - Platform builder: "Explore the SDK" → SDK docs
  - Engineering leader: "See how Stigmer compares" → comparison page

## CTA Strategy

| Persona | Primary CTA | Secondary CTA |
|---|---|---|
| Solo developer | "Install Stigmer" / "Follow the Quickstart" | "View on GitHub" |
| Platform builder | "Explore the SDK" / "Read the Integration Guide" | "View on GitHub" |
| Engineering leader | "Compare Stigmer to Alternatives" / "See the Architecture" | "Read the Docs" |

## Internal Linking Requirements

| Destination | Anchor Text Pattern |
|---|---|
| Feature pages | "Learn more about {feature}" — links to relevant capabilities mentioned in the solution |
| Comparison pages | "See how Stigmer compares to {alternative}" — for engineering leader persona |
| Quickstart (docs) | "Get started in 3 commands" or "Follow the quickstart" |

## Persona-Specific Objections to Address

Each use-case page must address the target persona's primary objection, either in the solution/proof sections or in an optional FAQ.

| Persona | Primary Objection | How to Address |
|---|---|---|
| Solo developer | "Is it production-ready?" / "Will I get locked in?" | Show Temporal-backed durability + Apache 2.0 license + local-first architecture |
| Platform builder | "How does this integrate with our stack?" | Show SDK imports, gRPC API, embeddable components, theming |
| Engineering leader | "How does this compare to X?" | Link to comparison page, show architecture decisions, name technologies |

## Quality Checklist

- [ ] All 5 required sections present (Hero, Problem, Solution, Proof, CTA Band)
- [ ] Page targets exactly one persona
- [ ] Problem section is recognizable to the target persona
- [ ] Solution maps point-by-point to the problems named
- [ ] At least one code snippet in the solution section
- [ ] Proof section includes a concrete artifact (code, terminal output, diagram)
- [ ] CTA matches the persona's natural next step
- [ ] Primary objection for the target persona is addressed
- [ ] Links to feature pages, comparison pages, and quickstart
- [ ] No banned phrases (verify against `copy-guidelines.json`)
- [ ] Terminology matches `terminology.json`
- [ ] Unique `<title>` under 60 characters
- [ ] Unique `<meta description>` under 160 characters with CTA
- [ ] One `<h1>`, sequential heading levels
- [ ] OG and Twitter Card meta tags present
- [ ] Responsive at all four breakpoints
- [ ] WCAG 2.1 AA compliant
