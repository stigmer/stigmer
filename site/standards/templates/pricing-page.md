# Page Template: Pricing Page

<!--
  PRICING PAGE TEMPLATE
  =====================
  Type: Pricing
  URL: /pricing
  Funnel: Evaluation → Action
  Personas: Engineering leaders, platform builders

  The pricing page communicates the open-core model: what is free (OSS)
  and what is paid (Cloud). Clarity is the primary design goal. Confusion
  about pricing boundaries destroys trust with developer audiences faster
  than almost anything else.
-->

## Page Metadata

| Field | Requirement |
|---|---|
| **Page type** | Pricing |
| **URL** | `/pricing` |
| **Funnel stages** | Evaluation → Action |
| **Target personas** | Engineering leaders, platform builders |
| **Visitor goal** | Understand OSS vs Cloud, costs, and feature boundaries |
| **Success metric** | Click-through to quickstart (OSS) or Cloud signup |

## Required Metadata

| Tag | Constraint |
|---|---|
| `<title>` | Max 60 chars. Format: `Pricing | Stigmer` or `Stigmer Pricing: Open Source & Cloud` |
| `<meta description>` | Max 160 chars. "Open source (Apache 2.0) + Cloud plans..." with CTA. |
| `og:title` | Matches or abbreviates `<title>` |
| `og:description` | Matches or abbreviates `<meta description>` |
| `og:image` | 1200x630px. Shows tier structure or "Open Source + Cloud." |
| `og:url` | Canonical URL |
| `twitter:card` | `summary_large_image` |

## Structured Data

- `FAQPage` (for the FAQ section)

## Narrative Arc

1. **Clarify** (Hero) — OSS is free and complete. Cloud adds managed infrastructure and multi-tenancy.
2. **Compare** (Tier Comparison) — Feature-by-feature breakdown of what is in each tier.
3. **Answer** (FAQ) — Address common pricing and licensing questions.
4. **Convert** (CTA Band) — Two parallel paths: "Start with OSS" and "Try Cloud."

## Section Sequence

### 1. Hero

- **Template**: [`section-hero.md`](section-hero.md)
- **Page-specific**: Headline communicates the open-core model immediately. "Open source. Free forever. Cloud when you need it." or "Apache 2.0 — no strings attached."
- **Subheadline**: Clarifies what each tier includes. "The OSS layer runs fully local. Stigmer Cloud adds managed infrastructure, a web console, and multi-tenant APIs."
- **Visual anchor**: A compact tier overview (2-3 cards: OSS, Cloud, Enterprise) rather than code.

### 2. Tier Comparison

- **Job**: Show exactly what is in each tier with no ambiguity.
- **Required elements**:
  - Tier cards or columns (OSS, Cloud, and optionally Enterprise) with pricing prominently displayed.
  - Feature comparison table: rows are capabilities, columns are tiers. Every cell is definitive (included, not included, or specific limit).
  - The OSS tier must be genuinely useful — not a crippled version that forces upgrade. Developers will evaluate the OSS tier first.
- **Copy guidance**:
  - Lead with the OSS tier. It is the trust signal. "Everything you need to build, run, and manage agents locally — free, forever, Apache 2.0."
  - Cloud tier copy explains what managed infrastructure adds, not what the OSS tier lacks.
  - Pricing must be clear. "Free," "$X/month," "Contact us" — no hidden costs, no "starting at" without showing what the base includes.
  - If pricing is not yet finalized, say "Coming soon" with a clear description of what the tier will include. Do not show placeholder prices.
- **Constraint**: The boundary between OSS and Cloud must be crystal clear. Any ambiguity about what requires a paid plan will erode trust. Name specific features in each tier.

### 3. FAQ

- **Template**: [`section-faq.md`](section-faq.md)
- **Page-specific questions** (address at minimum):
  - "Is the open-source version actually free?" → Yes, Apache 2.0, no usage limits.
  - "What does Stigmer Cloud add?" → Managed infrastructure, web console, multi-tenant APIs, team collaboration.
  - "Can I self-host?" → Yes, the OSS tier runs anywhere.
  - "Is there vendor lock-in?" → No, Apache 2.0, standard protocols (gRPC, MCP), data export.
  - "Do I need Cloud to get started?" → No, the CLI and local daemon are fully functional without Cloud.

### 4. CTA Band

- **Template**: [`section-cta-band.md`](section-cta-band.md)
- **Page-specific**: Two parallel CTAs of roughly equal weight — this is the one page type where the secondary CTA is nearly as prominent as the primary.
  - "Start with Open Source" → Quickstart docs
  - "Try Stigmer Cloud" → Cloud signup (when available)

## CTA Strategy

| CTA | Label | Destination |
|---|---|---|
| **Primary** | "Start with Open Source" / "Install Stigmer" | Quickstart docs |
| **Secondary** | "Try Stigmer Cloud" / "Learn about Cloud" | Cloud signup or Cloud feature page |
| **Tertiary** | Feature links within the tier comparison | Relevant feature pages |

## Internal Linking Requirements

| Destination | Anchor Text Pattern |
|---|---|
| Quickstart (docs) | "Start with the open-source version" |
| Feature pages | "See what {feature} includes" — for capabilities mentioned in tier comparison |
| FAQ answers | Inline links from FAQ answers to docs or feature pages |

## Quality Checklist

- [ ] All 4 required sections present (Hero, Tier Comparison, FAQ, CTA Band)
- [ ] Open-core boundary is crystal clear — no ambiguity about what is free vs paid
- [ ] OSS tier is genuinely useful, not a crippled teaser
- [ ] Pricing is specific (no hidden costs, no vague "starting at")
- [ ] FAQ addresses licensing, self-hosting, vendor lock-in, and Cloud value
- [ ] FAQ has `FAQPage` JSON-LD structured data
- [ ] Both OSS and Cloud paths have clear CTAs
- [ ] No banned phrases
- [ ] Terminology matches `terminology.json`
- [ ] Unique `<title>` under 60 characters
- [ ] Unique `<meta description>` under 160 characters with CTA
- [ ] One `<h1>`, sequential heading levels
- [ ] OG and Twitter Card meta tags present
- [ ] Responsive at all four breakpoints
- [ ] WCAG 2.1 AA compliant
