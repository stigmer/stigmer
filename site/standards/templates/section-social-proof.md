# Section Template: Social Proof

<!--
  SOCIAL PROOF SECTION TEMPLATE
  =============================
  Job: Validate — who else uses this?

  For an early-stage open-source project, social proof comes from
  verifiable project health signals, not enterprise logos or customer
  testimonials. GitHub activity, contributor count, and community
  engagement are the developer equivalent of "trusted by" badges.
-->

## Job

Validate Stigmer's credibility by showing real, verifiable signals of project health and community adoption. Developers trust metrics they can audit themselves.

## Funnel Stage

Evaluation — the visitor has understood what Stigmer does and is looking for signals that it is worth investing time in.

## Required Elements

| Element | Requirement | Constraint |
|---|---|---|
| **Real metrics** | GitHub stars, contributor count, recent commit activity | Numbers must be current and dynamically fetched or regularly updated. Stale numbers signal an abandoned project. |
| **Verifiable claims** | Every number must be auditable | Each metric must link to or be derivable from a public source (GitHub repo, npm registry, etc.). |
| **Community signals** | Evidence of active community | Contributor activity, issue response time, community channel membership, or ecosystem adoption. |

## Constraints

- **Metrics must be auditable**: "500+ GitHub stars" must link to the actual repo where the visitor can verify the number. Unverifiable numbers are marketing noise.
- **Metrics must be current**: Display the live count or a recently-fetched value with a "last updated" indicator. A metric that was accurate 6 months ago but is now wrong is worse than no metric.
- **No vanity metrics**: "Downloaded 10,000 times" is a vanity metric unless it corresponds to real adoption. Focus on signals developers actually trust: stars, contributors, commit recency, release cadence.
- **No fabricated testimonials**: Do not use unattributed quotes. If there are no real testimonials yet, do not fake them — show project health metrics instead.

## Copy Guidance

- Lead with the metric, not with a setup sentence. "1,200+ GitHub stars" is stronger than "Developers around the world trust Stigmer, with over 1,200 GitHub stars."
- Metric labels should be terse: "Stars," "Contributors," "Commits this month," "Latest release." No marketing fluff.
- If the project is early-stage, lean into honesty: "Early stage, moving fast" paired with commit frequency and release cadence is more credible than inflated adoption claims.
- A "contributor spotlight" or "recent activity" feed (last N commits, recent releases) demonstrates ongoing momentum without requiring large adoption numbers.

## Design Notes

- Layout: Metric cards in a horizontal row (3-4 items), centered within the section.
- Each metric card: Large number (Geist Sans, weight 700, `text-4xl`), label below (Geist Sans, weight 400, `text-sm`, `--muted` color).
- Cards use the `glass` variant for subtle elevation.
- GitHub link icon next to metrics that link to verifiable sources.
- Section padding: `py-16` to `py-24` — this section is compact relative to content-heavy sections.
- Animations: `scaleIn` with stagger on metric cards. Respect `prefers-reduced-motion`.
- Consider a subtle "count-up" animation for numbers on first viewport entry (disabled when reduced motion is preferred).

## Accessibility

- Metrics use semantic markup: the number and its label are associated (e.g., `<dt>`/`<dd>` pairs or `aria-label`).
- Links to verification sources have descriptive anchor text: "View on GitHub" rather than the number itself being a bare link.
- Count-up animations (if used) must have the final number in the DOM from initial render — the animation is visual enhancement only, not a progressive reveal that delays content.

## Quality Checklist

- [ ] All metrics are real and current (not placeholder or aspirational)
- [ ] Every metric links to or is derivable from a public source
- [ ] No vanity metrics (downloads without context, "users" without verification)
- [ ] No unattributed testimonials or fabricated quotes
- [ ] Metric labels are terse and factual
- [ ] Numbers and labels are semantically associated
- [ ] Links to sources have descriptive anchor text
- [ ] Count-up animation (if used) does not delay content for screen readers
- [ ] Responsive layout: metrics stack on mobile, row on desktop
- [ ] Section looks credible even with small numbers (honest framing)
