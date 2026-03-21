# Reminder: Sales Website Mindset

When working on anything in `site/`, shift your mindset. The sales website exists to **convert visitors into users**. It is not the docs site, not the product console, and not a technical reference. Every decision — layout, copy, code, animation — must serve the conversion goal.

## The Fundamental Shift

The product codebase asks: "Does this work correctly?" The sales website asks: **"Does this make a developer want to try Stigmer?"** These are different questions with different quality criteria.

## Core Principles

### You Are Selling, Not Documenting

- The docs explain **how**. The sales website explains **why**.
- Docs assume the reader has already decided to use Stigmer. The sales website must earn that decision.
- Docs prioritize completeness. The sales website prioritizes impact — the minimum content that drives the visitor to act.

### Think from the Visitor's Perspective

- They landed here from a Google search, a tweet, a conference talk, or a GitHub link. They have **8 seconds** before they decide to stay or leave.
- They are comparing Stigmer to alternatives (LangChain, CrewAI, custom solutions, doing nothing). Every section must make the comparison favorable.
- They do not care about your architecture unless it solves their problem. Lead with their problem, not your implementation.

### The Conversion Funnel Is the Architecture

Just as the product has a layered architecture (SDK → React → Console), the sales website has a funnel:

| Stage | Visitor Goal | Site's Job | Example |
|---|---|---|---|
| **Awareness** | "What is this?" | Hook them in 5 seconds | Hero section |
| **Interest** | "What does it do?" | Educate with benefits | Features, How It Works |
| **Evaluation** | "Is it right for me?" | Build trust, address objections | Comparison, Use Cases, Architecture |
| **Action** | "Let me try it" | Remove friction | Quickstart, Install command, Docs link |

Know which stage you are designing for. Content that tries to serve all stages serves none.

### Every Section Needs a Job

- **Hero** = Hook (earn the scroll)
- **Features** = Educate (what does it do, and why should I care?)
- **Architecture** = Build trust (show me it is well-built)
- **Quickstart** = Prove it (show me it works)
- **Comparison** = Handle objections (why this over alternatives?)
- **Social proof** = Validate (who else uses this?)
- **CTA** = Convert (make the next step obvious)

A section without a defined job does not belong on the page.

### Developer Audiences Are Unique

- They value **honesty over polish**. Acknowledge limitations rather than hiding them.
- They value **code over copy**. A 5-line YAML snippet is worth more than a paragraph of description.
- They value **specificity over superlatives**. "5 lines of YAML" beats "easy to use." "Apache 2.0" beats "open source." "Zero cloud dependency" beats "flexible deployment."
- They detect and punish marketing BS instantly. If the copy sounds like it could be on any SaaS landing page, it is too generic.

### Performance Is Credibility

- A slow marketing site tells developers the product is slow. This is not rational, but it is true.
- **Core Web Vitals are not optional:** LCP < 2.5s, FID < 100ms, CLS < 0.1.
- Optimize images, subset fonts, minimize JS, lazy-load below-the-fold content.

## Before Working on Any Sales Website Change

Ask three questions:

1. **Which funnel stage does this serve?** If you cannot answer, the change has no purpose.
2. **What should the visitor do next?** If there is no clear next step, the section is a dead end.
3. **Would a developer find this credible?** If the content sounds like it was written by a marketer rather than an engineer, rewrite it.
