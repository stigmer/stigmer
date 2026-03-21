# Section Template: Comparison

<!--
  COMPARISON SECTION TEMPLATE
  ===========================
  Job: Handle objections — why this over alternatives?

  Developers evaluate alternatives. Pretending alternatives do not exist
  makes Stigmer look naive or dishonest. This section provides honest,
  specific, technical comparisons that help the visitor make an informed
  decision.
-->

## Job

Handle the "why this over X?" objection by providing an honest, specific, technical comparison. Help the visitor make an informed decision — even if that decision is to use an alternative for their particular use case.

## Funnel Stage

Evaluation — the visitor is comparing Stigmer to alternatives and assessing fit for their situation.

## Required Elements

| Element | Requirement | Constraint |
|---|---|---|
| **Honest positioning** | Acknowledge what alternatives do well | At least one genuine strength per competitor must be named. No straw-man comparisons. |
| **Specific differences** | Technical, not marketing | Name protocols, features, architectural differences. "Stigmer uses Temporal for durable execution; LangChain does not provide built-in durability" — not "Stigmer is more reliable." |
| **Comparison table** | Structured feature-by-feature comparison | Columns: Capability, Stigmer, Alternative. Rows must be factual and verifiable. Use checkmarks, X marks, or short descriptions — not adjectives. |
| **"When to use each"** | Clear guidance on when Stigmer is and is not the right choice | A subsection that explicitly states scenarios where the alternative is a better fit. |

## Constraints

- **Must acknowledge competitor strengths**: Every comparison must name at least one thing the alternative does well. A comparison that positions Stigmer as better in every dimension is not credible.
- **Differences must be technical**: "Faster" or "easier" are not comparisons. "Stigmer checkpoints each tool call; LangChain relies on application-level retry logic" is a comparison.
- **No misrepresentation**: Every claim about a competitor must be verifiable by someone who uses that tool. Developers who know LangChain, CrewAI, or other tools will notice inaccuracies, and Stigmer's credibility suffers.
- **Fair representation**: Use the competitor's current version and documented capabilities. Do not compare Stigmer's latest features against a competitor's year-old release.

## Copy Guidance

- The section headline should name the comparison directly: "Stigmer vs LangChain" or "How Stigmer compares to CrewAI." Do not use euphemisms like "Why choose us."
- Comparison table entries should be factual and terse. Use short phrases or specific capabilities, not sentences. "Temporal-backed, per-tool-call checkpoints" is a table entry. "Our advanced durable execution engine ensures your agents never lose progress" is not.
- The "When to use each" subsection is the most important part. It builds trust by showing Stigmer is confident enough to recommend alternatives when appropriate:
  - "Use LangChain if you want maximum framework flexibility and are building custom orchestration logic."
  - "Use Stigmer if you want declarative configuration, durable execution, and multi-tenant support out of the box."
- Tone: Respectful of alternatives. Confident about Stigmer's strengths. Transparent about Stigmer's current limitations.

## Design Notes

- Comparison table: Full-width with alternating row backgrounds for readability. Sticky header row on scroll.
- Table columns: Capability name (left-aligned), Stigmer (center), Alternative (center).
- Checkmarks use `--primary` color. X marks use `--muted` color. Partial support uses a qualifier note.
- "When to use each" subsection: Two-column layout on desktop (one column per tool), stacked on mobile.
- Section padding: `py-24` (96px) vertical.
- No decorative animations on the table — data tables should appear immediately for readability.

## Accessibility

- Comparison table uses proper `<table>` markup with `<thead>`, `<tbody>`, `<th scope="col">`, and `<th scope="row">`.
- Checkmarks and X marks are not icon-only — they include `aria-label` ("Supported" / "Not supported") or visible text.
- Table is horizontally scrollable on narrow viewports with a scroll indicator.
- "When to use each" content does not rely on the two-column visual layout to convey meaning — each recommendation is self-contained.

## Quality Checklist

- [ ] At least one genuine competitor strength acknowledged
- [ ] All differences are technical and specific (no vague adjectives)
- [ ] Comparison table entries are factual and verifiable
- [ ] No misrepresentation of competitor capabilities
- [ ] Competitor's current version and documented features used
- [ ] "When to use each" subsection explicitly recommends alternatives where appropriate
- [ ] Table uses semantic `<table>` markup with proper headers
- [ ] Checkmarks/X marks have accessible labels (not icon-only)
- [ ] Table is horizontally scrollable on mobile
- [ ] Tone is respectful, confident, and transparent
