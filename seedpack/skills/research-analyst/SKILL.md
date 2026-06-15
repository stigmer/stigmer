---
name: research-analyst
visibility: public
description: >
  Conduct systematic research with structured methodology for source evaluation,
  evidence synthesis, and cited findings. Use this skill when asked to research a
  topic, investigate a question, compare alternatives, evaluate a technology or
  vendor, compile a competitive analysis, or produce a research report. Triggers
  on requests like: "research X for me", "compare these options", "what are the
  best practices for Y", "investigate whether Z is viable", "give me a competitive
  analysis of", or "write a research report on".
---

# Research Analyst

Produce research that is systematic, cited, and honest about what it can and
cannot establish. This skill teaches a five-step methodology — define, plan,
gather, synthesize, present — that produces findings tied to evidence rather than
plausible-sounding assertions. The methodology is critical for AI agents
specifically because the failure mode is not "no answer" but "a confident answer
that sounds right and isn't."

## Workflow

Follow these steps in order for every research task.

### Step 1: Define the Research Question

A vague question produces vague research. Sharpen the question before searching.

1. **State the question precisely.** "Research AI" is not a question. "What are
   the leading open-source LLM frameworks for production deployment as of 2026,
   and how do they compare on latency, cost, and ecosystem maturity?" is a
   question. If the request is vague, ask the requester to narrow it before
   proceeding.

2. **Identify the decision context.** Who will use this research and for what
   decision? A CTO evaluating build-vs-buy needs different depth than a developer
   choosing between two libraries. The decision context determines what "good
   enough" looks like.

3. **Define scope boundaries.** What is in scope and what is explicitly out of
   scope? Time frame (current state vs. historical evolution), geography,
   industry segment, technology stack. Stating boundaries up front prevents scope
   creep and sets expectations about what the research will not cover.

4. **Agree on the deliverable format.** Executive brief (1 page), detailed
   report (5-10 pages), comparison matrix, recommendation memo? Knowing the
   output format shapes how you gather and organize information.

### Step 2: Plan the Search Strategy

Systematic research covers multiple source types. A single source — no matter how
authoritative — is a starting point, not a conclusion.

**Source types to consider:**

| Source type | Strengths | Weaknesses |
|-------------|-----------|------------|
| Official documentation | Authoritative, current, detailed | May present capabilities favorably, omit limitations |
| Academic papers / preprints | Rigorous methodology, peer review (for published work) | May be dated, narrow scope, behind paywall |
| Industry reports (Gartner, Forrester, etc.) | Broad market view, structured comparisons | Expensive, may lag reality, vendor influence |
| Technical blog posts and conference talks | Practical experience, implementation details | Variable quality, may not generalize, bias toward author's stack |
| Community discussions (GitHub issues, forums, Stack Overflow) | Real-world problems and solutions, unfiltered | Anecdotal, may be outdated, incomplete context |
| Benchmarks and case studies | Concrete performance data, real-world results | Methodology varies, may cherry-pick favorable conditions |
| Primary sources (code repos, changelogs, release notes) | Ground truth for what software actually does | Requires expertise to interpret, no editorial framing |

**Plan which sources to consult for the specific question.** Not every research
task needs all source types. A technology comparison needs documentation,
benchmarks, and community discussions. A market analysis needs industry reports
and case studies. A best-practices review needs blog posts, conference talks,
and documentation.

**Define search terms in advance.** List the key terms, synonyms, and related
concepts you'll search for. This prevents ad-hoc searching that follows whatever
the first result suggests and misses important alternatives.

### Step 3: Gather and Evaluate Sources

Not all sources are equal. Every source must pass an evaluation before its claims
enter your findings.

Read [references/source-evaluation.md](references/source-evaluation.md) for the
full evaluation framework. The core dimensions:

**Credibility:** Who created this and why should you trust them? Authoritative
sources have identifiable authors or organizations with relevant expertise and
reputation. Anonymous blog posts, undated articles, and content from entities
with commercial interest in the conclusion all require extra scrutiny.

**Recency:** When was this created or last updated? In fast-moving fields, a
two-year-old comparison may be obsolete. Check the publication date and look for
signs that the content reflects current reality (version numbers, recent dates
in examples, references to current events).

**Relevance:** Does this source actually address your research question? A
source about machine learning performance on GPUs is not relevant to your
question about LLM deployment cost on CPUs, even if the title sounds related.
Don't stretch a source to fit.

**Methodology:** For claims based on data (benchmarks, surveys, case studies),
how was the data collected? What was the sample size? Were the conditions
controlled? A benchmark that tests only the happy path under ideal conditions
tells a different story than one that includes error scenarios and cold starts.

**Bias:** Does the source have a reason to favor a particular conclusion?
Vendor-published benchmarks, framework authors' blog posts, and reports
sponsored by interested parties are not automatically wrong — but their claims
need corroboration from independent sources.

**Citation rules for AI agents:**

1. **Never fabricate a citation.** If you cannot provide a verifiable URL,
   title, or author, do not cite the source. Say "based on commonly
   documented patterns in [domain]" rather than inventing a URL that leads
   nowhere.
2. **Cite the specific source, not a summary of it.** "According to the
   PostgreSQL 16 documentation on query planning" is better than "according
   to online resources."
3. **Note when you're working from training knowledge rather than live
   sources.** "Based on training data current to [date]; verify against
   current documentation" is honest. Presenting recalled information as
   fresh research is misleading.
4. **If you have web access, use it.** When tools allow you to retrieve
   current information, do so rather than relying on potentially outdated
   training knowledge. Verify key facts against live sources.

### Step 4: Synthesize Across Sources

Synthesis is the core analytical work. It's where you go beyond "Source A says
X, Source B says Y" to produce an integrated understanding.

1. **Identify consensus.** Where do multiple independent sources agree? Consensus
   across sources with different perspectives and methodologies is the strongest
   form of evidence. Note how many sources agree and their independence from
   each other.

2. **Identify contradictions.** Where do sources disagree? Don't paper over
   disagreements — they're often the most informative part of the research.
   Investigate why: different time periods, different conditions, different
   definitions, different methodologies, or genuine ongoing debate.

3. **Identify gaps.** What does no source address? Gaps in available information
   are themselves findings. "No benchmarks exist for this configuration" tells
   the decision-maker something important about the maturity of the option.

4. **Triangulate.** For each key finding, can you support it from at least two
   independent sources? Findings supported by a single source should be flagged
   as lower confidence. Findings contradicted by other sources need the
   contradiction surfaced, not suppressed.

5. **Separate established facts from expert opinions from emerging signals.**
   - **Established facts**: Widely documented, verifiable, non-controversial.
     "PostgreSQL supports JSONB columns" is a fact.
   - **Expert consensus**: Most practitioners agree, based on experience.
     "PostgreSQL JSONB is suitable for document-style workloads up to moderate
     scale" is expert consensus.
   - **Emerging/contested**: Limited evidence, active debate, may change.
     "PostgreSQL will replace dedicated document databases for most use cases"
     is contested.

   Label each finding accordingly. The decision-maker needs to know which parts
   of your research are settled and which are in flux.

### Step 5: Present Findings

Structure the output for the decision-maker, not for your research process. The
reader doesn't need to see your search history — they need answers with evidence.

Read [references/report-structure.md](references/report-structure.md) for
detailed templates. The core structure for any research output:

1. **Executive summary**: The key findings and recommendation in 3-5 sentences.
   A reader who reads only this section should know the bottom line.

2. **Methodology note**: One paragraph on what was researched, what sources were
   consulted, and what the research scope was. This lets the reader calibrate
   their trust.

3. **Findings**: Organized by theme or by research sub-question, not by source.
   Each finding should state the conclusion, the evidence supporting it, the
   confidence level, and any caveats.

4. **Comparison** (if applicable): Side-by-side matrix for option comparisons.
   Use consistent criteria across all options.

5. **Recommendations**: Specific, actionable, tied to the decision context from
   Step 1. "Based on these findings, Option A is the strongest fit for [specific
   requirements] because [specific evidence]. Option B is preferable if
   [alternative priority] matters more."

6. **Limitations and further research**: What this research could not answer and
   where further investigation is needed.

7. **Sources**: Complete list of all sources consulted, with enough information
   for the reader to find and verify each one.

## Key Principles

1. **A confident wrong answer is worse than an honest gap.** The most dangerous output an AI agent can produce is a plausible-sounding claim with no basis. When you don't know, say so. When evidence is thin, say so. When you're relying on training data rather than verified sources, say so.

2. **Cover the source landscape, not just the first result.** Systematic research means consulting multiple source types and perspectives. If all your sources are blog posts, you're missing the documentation. If all your sources are official docs, you're missing the real-world experience. Balance the source mix deliberately.

3. **Evaluate every source before trusting it.** Credibility, recency, relevance, methodology, and bias — check all five. A biased source is not automatically wrong, but its claims need independent corroboration.

4. **Surface contradictions, don't suppress them.** When sources disagree, the disagreement itself is a finding. The decision-maker needs to know that experts are split, that benchmarks conflict, or that the field is in flux. Presenting only the agreeing sources creates false confidence.

5. **Cite specifically or not at all.** "According to various sources" is noise. "According to the Redis 7.2 documentation" is verifiable. If you cannot point to a specific source, frame the claim as general knowledge and let the reader decide whether to trust it.

6. **Separate the finding from the recommendation.** Findings are what the evidence shows. Recommendations are what you think should be done about it. Present them in that order, clearly separated. The reader may agree with your findings but reach a different recommendation based on priorities you don't have visibility into.

## Reference Files

| File | When to Read |
|------|-------------|
| [references/source-evaluation.md](references/source-evaluation.md) | When evaluating the credibility, recency, relevance, methodology, and bias of a source during Step 3 |
| [references/report-structure.md](references/report-structure.md) | When structuring the research output in Step 5: templates for executive briefs, detailed reports, and comparison matrices |
