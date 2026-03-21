# Section Template: How It Works

<!--
  HOW IT WORKS SECTION TEMPLATE
  =============================
  Job: Build trust — show it is well-built.

  This section earns technical trust by revealing how the product works
  under the hood. Developers respect transparency about architecture.
  The section uses a step-by-step flow to make a complex system feel
  approachable without oversimplifying.
-->

## Job

Build trust by showing that Stigmer is well-engineered. Reveal enough architecture to satisfy a curious developer without overwhelming a first-time visitor. Make a complex system feel approachable.

## Funnel Stage

Interest — the visitor is past the hook and wants to understand the mechanics before evaluating further.

## Required Elements

| Element | Requirement | Constraint |
|---|---|---|
| **Section heading** | Names the section's purpose | H2. "How it works" or a more specific variant like "From YAML to running agent." |
| **Numbered steps** | 3-5 sequential steps showing the workflow | Each step has a number, a short title, and a 1-2 sentence explanation. |
| **Code or diagram** | At least one concrete artifact per step | Code snippet, YAML block, terminal output, or architecture diagram. |
| **Progressive disclosure** | Overview first, detail on demand | The main flow shows the high-level steps. Expandable details or links provide depth. |

## Constraints

- **Step count**: Minimum 3, maximum 5. Fewer than 3 feels oversimplified. More than 5 feels complex.
- **Progressive disclosure**: The default view shows the step titles and one-line explanations. Code blocks, diagrams, and detailed explanations are either visible below each step or expandable. The visitor should be able to grasp the flow from titles alone.
- **Artifacts per step**: Every step must include at least one concrete artifact (code snippet, YAML block, terminal output, or diagram). Steps with only text descriptions fail the "show, don't tell" mandate.
- **Flow direction**: Steps must show a clear progression. The visitor should understand the input (YAML definition) and output (running agent) and how the system moves between them.

## Copy Guidance

- Step titles should be imperative or descriptive: "Define your agent in YAML," "Apply the configuration," "Agent starts running."
- Step descriptions should be 1-2 sentences that explain what happens and why it matters. Technical accuracy over marketing polish.
- Name the technologies: "Temporal-backed durable execution," "MCP tool protocol," "gRPC API." Developers trust specificity.
- The section can include a "why this architecture" aside (1-2 sentences) that explains a key design decision. This is a trust signal — it shows the team has thought deeply about the problem.

## Design Notes

- Visual progression: Use numbered indicators, connecting lines, or a vertical timeline to communicate sequence.
- Step layout: Each step occupies a horizontal band (title + description on one side, code/diagram on the other) or a vertical card.
- Code blocks use Geist Mono with syntax highlighting matching the language tag.
- Section padding: `py-24` (96px) vertical.
- Animations: Steps appear sequentially with `staggerContainer` and `fadeInUp`. Respect `prefers-reduced-motion`.
- At mobile widths (375px), steps stack vertically with code blocks below their descriptions.

## Accessibility

- Section wrapped in `<section>` with `aria-labelledby`.
- Steps use an `<ol>` (ordered list) for semantic structure, even if visually styled as cards or a timeline.
- Code blocks have language tags for screen reader context.
- Diagrams (if used) have descriptive `alt` text or an adjacent text description.
- Expandable details use `<details>`/`<summary>` or equivalent with `aria-expanded`.

## Quality Checklist

- [ ] 3-5 numbered steps showing a clear workflow
- [ ] Every step has at least one concrete artifact (code, YAML, terminal output, or diagram)
- [ ] Step titles convey the flow without reading descriptions
- [ ] Technologies are named specifically (not "our engine" but "Temporal-backed durable execution")
- [ ] Progressive disclosure: overview is graspable at a glance, detail available on demand
- [ ] Steps use `<ol>` for semantic structure
- [ ] Code blocks have language tags
- [ ] Responsive at all four breakpoints
- [ ] Animations respect `prefers-reduced-motion`
