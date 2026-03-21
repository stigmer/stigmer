# Reminder: Website Standards

When working on any file in `site/`, these standards govern every decision.

## Audience

The sales website is written for **developers evaluating whether to adopt Stigmer**. They are technically skilled, new to Stigmer, comparing alternatives, and time-constrained. Every page must move them closer to trying the product.

Three personas drive content decisions:

| Persona | Reads For | Reads By |
|---|---|---|
| **Solo developer** | "Show me it works in 60 seconds" | Scanning headlines, copying install commands |
| **Platform team lead** | "Show me how it integrates" | Evaluating architecture, SDK docs, API surface |
| **Engineering manager** | "Show me how it compares" | Checking comparisons, license, production readiness |

For the full audience mindset, funnel architecture, and developer marketing principles, see [`_reminders/005_sales-website-mindset.md`](005_sales-website-mindset.md) and [`_reminders/006_developer-marketing-principles.md`](006_developer-marketing-principles.md).

## Reference Documents

All website standards, templates, and machine-readable rules are defined in `site/standards/`:

| Document | What It Defines |
|---|---|
| [`site/standards/website-standards.md`](../site/standards/website-standards.md) | Master standards: 7 mandates, 9 page types, 8 section types, copy rules, design rules, performance, accessibility, SEO, quality checklist |
| [`site/standards/information-architecture.md`](../site/standards/information-architecture.md) | Page map, navigation structure, URL scheme, internal linking rules, page inventory |
| [`site/standards/content-requirements.json`](../site/standards/content-requirements.json) | Machine-readable requirements for 9 page types and 8 section types |
| [`site/standards/copy-guidelines.json`](../site/standards/copy-guidelines.json) | 16 banned phrases with reasons/replacements, 6 required patterns, voice rules, sales terminology |
| [`site/standards/performance-budget.json`](../site/standards/performance-budget.json) | Core Web Vitals targets, bundle/asset budgets, accessibility thresholds, SEO character limits |

## Cursor Rules

Three Cursor rules automate website standards enforcement in `.cursor/rules/site/`:

| Rule | Activation |
|---|---|
| `website-standards.mdc` | Auto-applies on `site/src/**/*.{tsx,ts,css}` edits — injects standards into context |
| `write-website-content.mdc` | Invoke as `@write-website-content` when creating or modifying pages |
| `review-website-content.mdc` | Invoke as `@review-website-content` for quality review before merge |

## Templates

Every new page or section must follow the correct template from `site/standards/templates/`:

**Page templates (9 types):** homepage, use-case-page, comparison-page, feature-page, landing-page, pricing-page, changelog-page, blog-page, community-page

**Section templates (8 types):** section-hero, section-features, section-how-it-works, section-code-showcase, section-comparison, section-social-proof, section-cta-band, section-faq

## The Seven Mandates

1. **Conversion-First.** Every element serves a defined role in the funnel (Awareness → Interest → Evaluation → Action). Content without a funnel job does not belong.
2. **Developer Authenticity.** The tone is a senior engineer at a meetup — confident, specific, honest about tradeoffs. Never a marketer writing a press release.
3. **Show, Don't Tell.** Code snippets, terminal output, and architecture diagrams carry more weight than paragraphs. Working code within the first two viewports.
4. **Objection-Aware.** Every page anticipates why the visitor might leave and addresses it directly.
5. **Performance Is Credibility.** Core Web Vitals are non-negotiable. A slow marketing site tells developers the product is slow.
6. **Accessibility Is Non-Negotiable.** WCAG 2.1 AA minimum. Contrast ratios, keyboard nav, screen reader support, reduced motion respect.
7. **Consistency Across Surfaces.** Messaging, terminology, and claims must align across the sales website, README, docs, and CLI help text.

## Before Working on Any Sales Website Change

Invoke `@write-website-content` to activate the writing rule, which enforces the Content Brief process:

1. **Page type** — identify from the 9 defined types, name the template.
2. **Audience and funnel stage** — which persona, which funnel stage, what brought them here.
3. **Template compliance** — verify all required sections and elements are present.
4. **Copy brief** — key message, proof points, objections to address.
5. **Confirmation** — get approval before drafting.

## Quality Checklist

Before merging any sales website change, invoke `@review-website-content` or manually verify:

- [ ] Every section has a defined funnel job
- [ ] Copy sounds like an engineer, not a marketer
- [ ] Every claim is specific and verifiable — no vague superlatives
- [ ] No banned phrases (check `copy-guidelines.json`)
- [ ] Code examples appear within first two viewports
- [ ] CTA hierarchy is clear (primary + secondary on every page)
- [ ] Page metadata complete (title, description, og:image)
- [ ] Core Web Vitals pass (check `performance-budget.json`)
- [ ] WCAG 2.1 AA compliant (contrast, keyboard, screen reader)
- [ ] All internal links resolve to real pages
