# Section Template: Features

<!--
  FEATURES SECTION TEMPLATE
  =========================
  Job: Educate — what does it do, and why should I care?

  The features section translates capabilities into outcomes. Every feature
  follows the Benefit → Feature → Proof pattern. Developers scan this section
  to decide whether to keep reading or leave.
-->

## Job

Educate the visitor about what Stigmer does and why each capability matters to them. Convert technical features into developer-relevant outcomes.

## Funnel Stage

Interest — the visitor has decided to stay and wants to understand the product's capabilities.

## Required Elements

| Element | Requirement | Constraint |
|---|---|---|
| **Section heading** | Names the section's purpose | H2. "What Stigmer does" or capability-oriented heading. Not "Features." |
| **Feature cards** | 3-6 feature entries in a grid or list | Each card is a self-contained unit with all three sub-elements below. |
| **Benefit-first description** | Lead with the outcome, not the implementation | First sentence states what the developer gets. Second sentence names the underlying technology. |
| **Icon or visual identifier** | One per feature, consistent style across all cards | SVG icon or emoji. Consistent size and color treatment. No stock photos. |
| **Proof point** | Code snippet, metric, or link per feature | At least one concrete artifact that makes the benefit verifiable. |

## Constraints

- **Feature count**: Minimum 3, maximum 6. More than 6 requires prioritization — the section loses impact when everything is "featured."
- **Description style**: Benefit-first. "Your agent survives crashes and resumes where it left off" (benefit) before "Temporal-backed durable execution with per-tool-call checkpointing" (feature).
- **Proof point type**: Must be one of: code snippet (inline or expandable), specific metric ("zero cloud dependency"), or link to deeper content (feature page or docs). Vague claims without proof are prohibited.
- **Hierarchy**: If features have different importance levels, use visual weight (card size, position, detail level) to communicate priority. Do not present all features as equally important if they are not.

## Copy Guidance

- Apply the Feature → Benefit → Proof pattern from `copy-guidelines.json` to every card.
- Card headlines should be 3-5 words, benefit-oriented: "Agents Survive Crashes" rather than "Durable Execution."
- Card descriptions should be 2-3 sentences maximum. The first sentence is the benefit. The second names the technology. A third (optional) sentence points to proof.
- Avoid banned phrases. "Powerful orchestration" fails — "Multi-agent delegation with approval gates" passes.
- Use consistent grammatical structure across all cards. If one card starts with "Your agent...", all cards should address the visitor in second person.

## Design Notes

- Grid layout: 2 columns on tablet (768px), 3 columns on desktop (1024px+), 1 column stacked on mobile (375px).
- Card variants: Use the existing `glass` or `feature` card variant from the component system.
- Card gap: `gap-6` (24px) between cards.
- Icons: Consistent size (24px or 32px), using `--primary` or `--accent` color tokens.
- Animations: `staggerContainer` on the grid parent, `fadeInUp` on each card with staggered delay. Respect `prefers-reduced-motion`.
- Section padding: `py-24` (96px) vertical.

## Accessibility

- Section wrapped in `<section>` with `aria-labelledby` pointing to the section heading.
- Feature cards are not interactive (no click handler) unless they link to a feature page — in which case the entire card is a single `<a>` element.
- Icons are decorative (`aria-hidden="true"`) since the text description carries the information.
- Proof-point links use descriptive anchor text.

## Quality Checklist

- [ ] 3-6 features displayed (not more, not fewer)
- [ ] Every feature follows Benefit → Feature → Proof structure
- [ ] Every feature has an icon or visual identifier
- [ ] Every feature has a proof point (code, metric, or link)
- [ ] No banned phrases in any card description
- [ ] Card headlines are 3-5 words and benefit-oriented
- [ ] Consistent grammatical structure across all cards
- [ ] Grid is responsive at all four breakpoints (375, 768, 1024, 1440)
- [ ] Section has `aria-labelledby` on the wrapping `<section>`
- [ ] Icons have `aria-hidden="true"`
