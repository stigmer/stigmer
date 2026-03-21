# Section Template: Hero

<!--
  HERO SECTION TEMPLATE
  =====================
  Job: Hook — earn the scroll.

  The hero is scanned, not read. Visitors pattern-match in under 5 seconds:
  what is this, why does it matter, what do I do next. Every element must
  survive a 5-second glance test.

  This template defines the required structure. Actual copy must follow
  the Copy Brief process from role 009 (Developer Copywriter).
-->

## Job

Hook the visitor in under 5 seconds. Communicate three things: what this is (category), why it matters (value), and what to do next (CTA). Earn the scroll.

## Funnel Stage

Awareness — the visitor has just arrived and is deciding whether to stay.

## Required Elements

| Element | Requirement | Constraint |
|---|---|---|
| **Headline** | Communicates category + core value proposition | Max 8 words. Must be specific to Stigmer — fails the "replace with Acme" test if generic. |
| **Subheadline** | Expands the headline with specificity | 1-2 sentences. Adds a concrete detail the headline omits. |
| **Primary CTA** | Dominant visual weight. Specific action text. | Action-oriented label: "Install Stigmer," "Try the CLI," not "Get Started" or "Learn More." |
| **Secondary CTA** | Clearly subordinate alternative path | Visually lighter. Links to a different funnel stage (e.g., "View on GitHub," "Read the Docs"). |
| **Visual anchor** | A non-text element that builds credibility | Must be one of: code snippet, terminal mockup, badge cluster. Never a stock image. |

## Constraints

- **Above fold**: All five elements must be visible without scrolling at the 1024px breakpoint.
- **No paragraphs**: The hero is headings, CTAs, and a visual anchor. Body text belongs in the section below.
- **Visual anchor type**: Code snippet, terminal mockup, or badge cluster only. Stock images, abstract gradients, and decorative illustrations are prohibited.
- **CTA hierarchy**: The primary CTA must have dominant visual weight (size, color, position). The secondary CTA must be clearly subordinate. They must not compete.

## Copy Guidance

- The headline is the single most important piece of copy on the page. Spend disproportionate time on it.
- Lead with the visitor's outcome, not Stigmer's implementation. "Build Agents. Skip the Infrastructure." works because it names the visitor's goal first.
- The subheadline earns its space only if it adds a concrete detail the headline omits. "Open-source platform for AI agents with declarative YAML, durable execution, and zero cloud dependency" adds three verifiable specifics.
- Badge text must earn its space: "Open Source," "Apache 2.0," "Local-First" each communicate a licensing or architectural decision. "New" or "Beta" are acceptable only when temporally accurate.

## Design Notes

- Use `py-24` minimum vertical padding for breathing room.
- Headline uses Geist Sans at weight 700.
- Visual anchor (code block) uses Geist Mono at weight 400 with syntax highlighting.
- Animations: `fadeInUp` for headline and subheadline, `scaleIn` for the visual anchor. Use `staggerContainer` on the parent. Respect `prefers-reduced-motion`.
- Max content width: `max-w-4xl` for headline, `max-w-2xl` for subheadline.

## Accessibility

- The headline is the page's `<h1>`. Exactly one per page.
- Primary and secondary CTAs are `<a>` or `<button>` elements with descriptive text — never icon-only.
- Visual anchor code blocks include `aria-label` describing what the code demonstrates.
- All text meets 4.5:1 contrast ratio against the dark background.

## Quality Checklist

- [ ] Headline is 8 words or fewer
- [ ] Headline passes the "replace with Acme" test (would fail if generic)
- [ ] Subheadline adds a concrete, verifiable detail
- [ ] Primary CTA has specific action text (not "Get Started" or "Learn More")
- [ ] Secondary CTA is visually subordinate to primary
- [ ] Visual anchor is code, terminal mockup, or badge cluster (no stock images)
- [ ] All elements visible without scrolling at 1024px
- [ ] `<h1>` is the headline, sequential heading levels below
- [ ] Touch targets ≥ 44px on mobile
- [ ] Animations respect `prefers-reduced-motion`
