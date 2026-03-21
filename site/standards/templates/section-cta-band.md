# Section Template: CTA Band

<!--
  CTA BAND SECTION TEMPLATE
  =========================
  Job: Convert — make the next step obvious.

  The CTA band appears at the end of every major content section and at
  the page bottom. It catches visitors who have consumed the preceding
  content and are ready to act. A visitor who scrolled through Features
  or Architecture should not have to scroll back to the hero to find a
  next step.
-->

## Job

Convert interest into action by making the next step obvious and frictionless. The CTA band is a decision point — it gives the visitor a clear choice between the primary action and an alternative path.

## Funnel Stage

Action — the visitor has consumed content above and is ready for a next step (or needs one final nudge).

## Required Elements

| Element | Requirement | Constraint |
|---|---|---|
| **Headline** | Reinforces the page's or section's key message | 1 sentence. Relates to the content the visitor just consumed, not a generic "Ready to get started?" |
| **Supporting copy** | Brief motivation to act | Max 2 sentences. Adds one specific reason to take the action now. |
| **Primary CTA** | Dominant action | Specific action text: "Install Stigmer," "Try the CLI," "Start building." Not "Submit" or "Learn More." |
| **Secondary CTA** | Subordinate alternative path | A different next step for visitors not ready for the primary action: "View on GitHub," "Read the docs," "See the comparison." |

## Constraints

- **Placement**: At the end of every major content section. Repeat at the page bottom. The exact same CTA band may appear multiple times on a page — this is intentional, not redundant.
- **Max supporting copy**: 2 sentences. This is a decision point, not a content section. Brevity drives action.
- **Primary CTA action text**: Must describe the specific action. "Install Stigmer" tells the visitor exactly what happens. "Get Started" does not. "Learn More" is prohibited as a primary CTA.
- **CTA hierarchy**: Primary CTA uses the `Button` component with full visual weight (filled, `--primary` color). Secondary CTA uses `outline` or `ghost` variant. They must not compete visually.

## Copy Guidance

- The headline should connect to the content above it. After a features section: "Build your first agent in 3 commands." After a comparison section: "See for yourself how Stigmer compares." After a code showcase: "Paste this YAML and run `stigmer apply`."
- Avoid generic CTA headlines: "Ready to get started?" "Take the next step." These add no information and work for any product.
- Supporting copy earns its space only if it adds a concrete motivator: "No cloud account required — runs fully local." "Apache 2.0, no strings attached."
- The primary CTA text should match the action destination. If the button takes the visitor to the quickstart docs, say "Follow the quickstart" — not "Install Stigmer" (which implies an immediate install action).

## Design Notes

- Full-width background band with `--card` or a slightly elevated surface to visually separate from content sections.
- Content centered within `max-w-3xl`. Headline above, supporting copy below, CTAs below that — or headline left-aligned with CTAs right-aligned on desktop.
- Primary CTA: `Button` component, `default` variant (filled), prominent size.
- Secondary CTA: `Button` component, `outline` or `ghost` variant, same height but visually lighter.
- Section padding: `py-16` (64px) — more compact than content sections to feel like a decision point, not a section.
- Animations: `fadeIn` on the entire band. No stagger — it should appear as a single cohesive unit. Respect `prefers-reduced-motion`.

## Accessibility

- The CTA band is a `<section>` with `aria-labelledby` pointing to its headline.
- Both CTAs are `<a>` elements (if navigating) or `<button>` elements (if triggering an action), with descriptive text.
- If the same CTA band appears multiple times on a page, each instance has a unique `id` for anchor linking.
- Focus order follows the visual order: headline → primary CTA → secondary CTA.

## Quality Checklist

- [ ] Headline relates to the content above (not generic "Ready to get started?")
- [ ] Supporting copy is max 2 sentences with a concrete motivator
- [ ] Primary CTA has specific action text matching the destination
- [ ] Secondary CTA provides a genuine alternative path
- [ ] Primary CTA is visually dominant; secondary is clearly subordinate
- [ ] "Learn More" is not used as a primary CTA label
- [ ] CTA band appears at end of major content sections and at page bottom
- [ ] Both CTAs are keyboard-accessible with visible focus indicators
- [ ] Touch targets ≥ 44px on mobile
- [ ] Band is visually distinct from surrounding content sections
