# Section Template: FAQ

<!--
  FAQ SECTION TEMPLATE
  ====================
  Job: Address remaining objections.

  The FAQ catches visitors who still have specific questions after
  consuming the page content. Questions must be sourced from real
  developer objections, not fabricated to fill space. The section
  also provides SEO value through FAQPage structured data.
-->

## Job

Address specific questions and remaining objections that the preceding content did not fully resolve. Catch visitors on the edge of a decision by answering the concerns that might cause them to leave.

## Funnel Stage

Evaluation to Action — the visitor has consumed the page content and has specific remaining questions before taking the next step.

## Required Elements

| Element | Requirement | Constraint |
|---|---|---|
| **Section heading** | Names the section | H2. "Frequently asked questions" or a more specific variant like "Common questions about pricing." |
| **Real questions** | Questions sourced from actual developer objections | Each question must represent a real concern a developer would have. Do not fabricate questions to showcase features. |
| **Concise answers** | 2-3 sentences max per answer | Answer the question directly, then link to docs for depth. Do not write paragraphs. |
| **Structured data** | JSON-LD `FAQPage` schema | Embedded in the page `<head>` or as an inline `<script type="application/ld+json">`. |

## Constraints

- **Question source**: Questions must come from real developer objections. Common sources: GitHub issues, community discussions, support conversations, competitive evaluation patterns. "What makes Stigmer different from other platforms?" is a real question. "Why is Stigmer the best choice?" is a fabricated marketing question.
- **Answer length**: Max 3 sentences per answer. The first sentence answers the question directly. The second adds a specific detail. The third (optional) links to docs for depth. If the answer needs more than 3 sentences, the question is too broad — split it.
- **Link to docs**: Answers that reference a complex topic must link to the relevant documentation page rather than explaining everything inline. The FAQ answers "what" — the docs explain "how."
- **Structured data required**: The `FAQPage` JSON-LD schema must be present for search engine rich results. Every Q&A pair visible on the page must be included in the schema.
- **Question count**: 4-8 questions per FAQ section. Fewer than 4 feels incomplete. More than 8 suggests the page content above is not addressing objections well enough.

## Copy Guidance

- Questions should be written in the visitor's voice, not the company's voice. "Is Stigmer production-ready?" (visitor's voice) vs. "What makes Stigmer production-ready?" (company's voice).
- Answers should be direct and honest. "Stigmer is early-stage but built on Temporal for durable execution. Agents survive crashes and resume from checkpoints." is honest. "Absolutely! Stigmer is enterprise-ready and battle-tested!" is dishonest if the product is early-stage.
- Group questions by theme if possible: technical architecture, licensing, integration, pricing. This helps visitors scan for their specific concern.
- Avoid using the FAQ to repeat content from the page above. If the page already covers durable execution in detail, the FAQ question about reliability should add a new angle, not restate the same information.

## Design Notes

- Accordion pattern: Questions visible, answers collapsed by default. One answer open at a time (single-expand) or multiple (multi-expand) — either is acceptable.
- Question text: Geist Sans, weight 600, `text-lg`. Answer text: Geist Sans, weight 400, `text-base`.
- Expand indicator: Chevron or plus/minus icon on the right side of each question. Rotates or toggles on expand.
- Section padding: `py-24` (96px) vertical. Content max-width: `max-w-3xl` for readability.
- Animations: Smooth height transition on expand/collapse (CSS `transition` on `max-height` or `grid-template-rows`). Respect `prefers-reduced-motion` — if preferred, use instant expand/collapse.
- Dividers between Q&A pairs for visual separation.

## Accessibility

- Accordion uses the WAI-ARIA Accordion pattern: questions are `<button>` elements with `aria-expanded`, answers are regions with `aria-labelledby` pointing to their question.
- Keyboard navigation: `Enter` or `Space` to toggle, focus moves through questions with `Tab`.
- Answers are in the DOM even when collapsed (hidden with CSS, not removed from the DOM) so screen readers can access all content.
- Structured data (`FAQPage` JSON-LD) must match the visible Q&A content exactly — no hidden questions that only appear in the schema.

## Structured Data Format

```json
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "{Question text}",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "{Answer text — plain text, no HTML}"
      }
    }
  ]
}
```

## Quality Checklist

- [ ] 4-8 questions sourced from real developer objections
- [ ] Every answer is 3 sentences or fewer
- [ ] First sentence of each answer directly addresses the question
- [ ] Answers link to docs for topics requiring depth
- [ ] Questions are in the visitor's voice (not the company's voice)
- [ ] Answers are honest about current product state
- [ ] No questions fabricated to showcase features
- [ ] `FAQPage` JSON-LD structured data matches visible Q&A content
- [ ] Accordion follows WAI-ARIA Accordion pattern
- [ ] Keyboard navigation works: `Enter`/`Space` to toggle, `Tab` to move
- [ ] Animations respect `prefers-reduced-motion`
