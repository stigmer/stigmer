# Page Template: Comparison Page

<!--
  COMPARISON PAGE TEMPLATE
  ========================
  Type: Comparison
  URL: /compare/{competitor-slug}
  Funnel: Evaluation
  Personas: Engineering leaders, solo developers

  Comparison pages are the most trust-sensitive content on the site.
  Developers who arrive here already know the alternative — any
  inaccuracy or spin will be detected and will destroy credibility.
  Honesty is not just a principle here; it is a survival requirement.
-->

## Page Metadata

| Field | Requirement |
|---|---|
| **Page type** | Comparison |
| **URL pattern** | `/compare/{competitor-slug}` |
| **Funnel stages** | Evaluation |
| **Target personas** | Engineering leaders, solo developers |
| **Visitor goal** | Make an informed decision between Stigmer and the alternative |
| **Success metric** | Click-through to quickstart or feature page |

## Required Metadata

| Tag | Constraint |
|---|---|
| `<title>` | Max 60 chars. Format: `Stigmer vs {Alternative} | Stigmer` |
| `<meta description>` | Max 160 chars. "Honest comparison of..." with specific differentiators + CTA. |
| `og:title` | Matches `<title>` |
| `og:description` | Matches or abbreviates `<meta description>` |
| `og:image` | 1200x630px. Shows both product names. |
| `og:url` | Canonical URL |
| `twitter:card` | `summary_large_image` |

## Structured Data

- `SoftwareApplication` (Stigmer)
- `FAQPage` (if FAQ section is included)

## Narrative Arc

1. **Frame** (Hero) — Name the comparison directly. State what both tools are.
2. **Compare** (Comparison Table) — Feature-by-feature, factual, verifiable.
3. **Guide** (When to Use Each) — Honest guidance including when to use the alternative.
4. **Convert** (CTA Band) — Let the visitor try Stigmer if the comparison resonated.

## Section Sequence

### 1. Hero

- **Template**: [`section-hero.md`](section-hero.md)
- **Page-specific**: Headline names both tools: "Stigmer vs LangChain: A Technical Comparison." No spin in the headline — the comparison must feel objective from the first word.
- **Subheadline**: 1-2 sentences summarizing the fundamental architectural difference. "LangChain is a Python framework for building LLM chains. Stigmer is an infrastructure platform for running AI agents with declarative configuration and durable execution."
- **Visual anchor**: A summary comparison (2-3 key differences) as a compact table or badge cluster. Not code — the code comes later.

### 2. Overview

- **Job**: Give a fair, 2-paragraph introduction to each tool.
- **Required elements**:
  - One paragraph describing the alternative: what it is, what it does well, who it is for. Written respectfully — as if the alternative's maintainers will read it.
  - One paragraph describing Stigmer: same structure, same level of detail.
- **Constraint**: Both descriptions must be equivalent in depth and tone. If Stigmer gets 3 sentences, the alternative gets 3 sentences. Asymmetry signals bias.

### 3. Comparison Table

- **Template**: [`section-comparison.md`](section-comparison.md)
- **Page-specific requirements**:
  - Rows cover the dimensions most relevant to the visitor's evaluation: architecture model, language support, state management, durability, tool integration, multi-tenancy, deployment model, license, community.
  - Each row entry is a factual, terse description — not a marketing claim. "Temporal-backed, per-tool-call checkpoints" is a row entry. "Industry-leading durability" is not.
  - At least one row must show where the alternative is stronger or equivalent. A table where Stigmer "wins" every row is not credible.

### 4. When to Use Each

- **Job**: Help the visitor make the right decision for their situation.
- **Required elements**:
  - "Use {Alternative} if..." — 3-5 scenarios where the alternative is the better choice.
  - "Use Stigmer if..." — 3-5 scenarios where Stigmer is the better choice.
  - Both lists must be genuine. The "use alternative" list must name real strengths, not straw-man scenarios.
- **Copy guidance**: This is the most important section on the page. It builds trust by showing Stigmer is confident enough to recommend alternatives. Write it as if advising a friend who asked which tool to use.

### 5. Code Comparison (Optional)

- **Job**: Show the same task implemented in both tools.
- **Required elements**:
  - Side-by-side code blocks: the alternative's approach and Stigmer's approach for the same task (e.g., defining an agent, handling tool calls, recovering from failure).
  - Both code examples must be fair representations of each tool's idiomatic usage. Do not show the alternative's worst pattern next to Stigmer's best.
- **Template**: [`section-code-showcase.md`](section-code-showcase.md) adapted for side-by-side layout.

### 6. CTA Band

- **Template**: [`section-cta-band.md`](section-cta-band.md)
- **Page-specific**: Headline connects to the comparison. "See for yourself — install Stigmer in one command." Primary CTA leads to quickstart. Secondary CTA leads to a feature page that deepens a key differentiator mentioned in the comparison.

## CTA Strategy

| CTA | Label | Destination |
|---|---|---|
| **Primary** | "Try Stigmer" / "Install in One Command" | Quickstart docs |
| **Secondary** | "Explore {Key Differentiator}" | Relevant feature page |
| **Tertiary** | "View on GitHub" | GitHub repo |

## Internal Linking Requirements

| Destination | Anchor Text Pattern |
|---|---|
| Feature pages | "See how {feature} works" — for claims made in the comparison table |
| Quickstart (docs) | "Try it yourself" |
| Pricing (when exists) | "See pricing" — if the comparison involves cost dimensions |

## Quality Checklist

- [ ] All required sections present (Hero, Overview, Comparison Table, When to Use Each, CTA Band)
- [ ] Overview gives fair, equivalent-depth descriptions of both tools
- [ ] Comparison table entries are factual and verifiable
- [ ] At least one row acknowledges where the alternative is stronger
- [ ] "When to Use Each" genuinely recommends the alternative for appropriate scenarios
- [ ] Code comparison (if present) uses idiomatic examples for both tools
- [ ] No misrepresentation of the alternative's capabilities
- [ ] Competitor's current version and documented features used
- [ ] No banned phrases
- [ ] Terminology matches `terminology.json`
- [ ] Unique `<title>` under 60 characters, includes both product names
- [ ] Unique `<meta description>` under 160 characters with CTA
- [ ] One `<h1>`, sequential heading levels
- [ ] OG and Twitter Card meta tags present
- [ ] Responsive at all four breakpoints
- [ ] WCAG 2.1 AA compliant
