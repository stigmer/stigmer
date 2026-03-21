# Reminder: Documentation Is for Platform Builders

When working on any file in `docs/`, every decision must be made through the lens of the primary reader: **a platform builder who wants to embed Stigmer's AI agent execution into their product.**

## The Reader

The primary audience is a technical leader or senior developer at a company building a product that needs AI agent capabilities. They are:

- **Technically skilled** — they know distributed systems, APIs, and infrastructure. They do not need hand-holding on basics.
- **New to Stigmer** — they have never used it. They found it through a search, a conference, or a colleague's recommendation.
- **Evaluating alternatives** — they are comparing Stigmer to LangChain, CrewAI, custom solutions, or doing nothing. Every page is part of the evaluation.
- **Time-constrained** — they will give Stigmer 15 minutes to prove it is worth deeper investment. If the docs waste their time, they leave.
- **Integration-focused** — they do not want a standalone tool. They want to embed agent execution into their existing platform via SDKs and APIs.

Secondary audiences exist (individual developers exploring Stigmer, contributors to the OSS project) but the primary reader drives every structural and editorial decision.

## The Documentation's Job

Bridge the gap from **"What is this?"** to **"I have agents running in my platform."**

Every page must move the reader closer to that outcome. A page that does not advance understanding, reduce friction, or enable action does not belong in the docs.

## The Diataxis Framework

Stigmer documentation is organized around the [Diataxis framework](https://diataxis.fr/) — the industry standard used by Temporal, Django, NumPy, and Cloudflare. Every document belongs to exactly one quadrant:

| Quadrant | Reader need | Our content type | Directory |
|---|---|---|---|
| **Tutorials** | "Help me learn" (learning-oriented) | Quickstarts | `docs/quickstarts/` |
| **How-to Guides** | "Help me solve a problem" (task-oriented) | Guides | `docs/guides/` |
| **Reference** | "Give me the facts" (information-oriented) | CLI Reference, SDK Reference | `docs/cli/`, `docs/sdk/` |
| **Explanation** | "Help me understand" (understanding-oriented) | Concepts | `docs/concepts/` |

When writing or reviewing a document, identify which quadrant it serves. Content that mixes quadrants confuses the reader — a concept doc that drifts into step-by-step instructions is neither a good explanation nor a good guide.

## Time-to-Value Is the North Star

If a platform builder cannot get from zero to running agents in 5 minutes, the docs have failed.

This is not a soft goal. It is the primary metric. Every design decision — what to put on the home page, how to structure the quickstart, which concepts to explain first — must be evaluated against time-to-value.

- The quickstart must work end-to-end with copy-pasteable commands.
- Prerequisites must be minimal and explicit.
- The first success moment (an agent running, output visible) must arrive as fast as possible.
- Explanations come after the reader has seen it work, not before.

## Content Must Be Validated

Every factual claim in the documentation must be validated against the current codebase. Stale documentation is worse than no documentation — it actively misleads and destroys trust.

- **Proto definitions are the source of truth.** If a concept doc describes fields or behaviors, verify them against the proto files in `apis/ai/stigmer/`.
- **CLI examples must be tested.** Run every command. Verify every output. If the CLI behavior has changed, update the docs.
- **YAML examples must be valid.** A reader should be able to paste any YAML example and use it.
- **When in doubt, check the code.** Do not trust legacy documentation as a source. Do not trust AI-generated content without verification.

## Before Writing Any Documentation

Ask three questions:

1. **Who is reading this?** Default answer: a platform builder evaluating Stigmer. If this page is for a different audience, state it explicitly.
2. **Which Diataxis quadrant does this serve?** If you cannot answer, the document has no clear purpose.
3. **Does this move the reader closer to running agents in their platform?** If not, reconsider whether the page belongs in the docs at all.
