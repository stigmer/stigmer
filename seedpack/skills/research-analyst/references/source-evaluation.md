# Source Evaluation Framework

Use this reference when evaluating sources during Step 3. Every source must
be assessed on five dimensions before its claims enter your findings. A source
can be strong on some dimensions and weak on others — the overall assessment
determines how much weight to give its claims.

## The Five Dimensions

### 1. Credibility

**Question:** Who created this and why should I trust their expertise?

**Strong credibility signals:**
- Named author(s) with identifiable expertise in the subject area
- Published by a recognized organization, institution, or publication
- Author has a track record of accurate, well-reasoned work in this domain
- Peer review or editorial oversight (for academic papers, reputable
  publications)
- Primary source: the creator of the technology, the author of the standard,
  or the organization that collected the data

**Weak credibility signals:**
- Anonymous or unattributable authorship
- Published on a platform with no editorial standards (personal blogs,
  social media)
- Author's expertise is in a different domain
- Self-published without review or corroboration

**How to handle low-credibility sources:** Don't discard them automatically.
A Stack Overflow answer from an anonymous user might contain the exact solution
to a specific problem. But treat their broader claims with skepticism, and
look for corroboration from higher-credibility sources.

### 2. Recency

**Question:** Is this information current enough for the decision at hand?

**Assessment framework:**

| Domain velocity | Acceptable age | Examples |
|----------------|---------------|----------|
| Fast-moving (AI/ML, cloud services, web frameworks) | 6-12 months | Model benchmarks, framework comparisons, API documentation |
| Moderate (databases, programming languages, infrastructure) | 1-2 years | Performance characteristics, architectural patterns, best practices |
| Stable (algorithms, protocols, design principles) | 5+ years | Data structures, HTTP protocol, SOLID principles |

**Recency red flags:**
- No publication date visible
- References to software versions that are no longer current
- Benchmarks run on hardware configurations that are now outdated
- Advice that contradicts current official documentation

**How to handle dated sources:** Note the publication date in your findings.
"As of [date], [source] reported [finding]. Current documentation should be
verified." A dated source can still provide useful historical context or
foundational understanding.

### 3. Relevance

**Question:** Does this source actually address my research question?

**Relevance checks:**
- Does the source cover the specific technology, version, or configuration
  in question — or a related but different one?
- Does the source address the same use case or workload pattern? A benchmark
  for read-heavy workloads doesn't apply to write-heavy scenarios.
- Does the source cover the same scale? Advice that works for 100 users may
  not apply at 100,000 users.
- Does the source apply to the same environment? Cloud-native advice may not
  apply to on-premises deployments.

**How to handle partially relevant sources:** Use them, but bound the
applicability explicitly. "Source X evaluated performance for read-heavy
workloads; our use case is write-heavy, so these numbers represent a best-case
rather than expected-case for our scenario."

### 4. Methodology

**Question:** How were the claims in this source established?

This dimension applies primarily to sources that make empirical claims:
benchmarks, surveys, case studies, and data-driven analyses.

**Strong methodology signals:**
- Described methodology that could be reproduced
- Controlled conditions with stated variables
- Adequate sample size for the claim being made
- Acknowledgment of limitations and threats to validity
- Raw data or detailed results available for inspection
- Independent replication or confirmation

**Weak methodology signals:**
- No methodology described ("we tested and found that...")
- Cherry-picked conditions (testing only the happy path, ideal hardware,
  optimal configuration)
- Tiny sample size presented without acknowledgment
- No mention of limitations or alternative explanations
- Results that seem too clean or too favorable

**How to handle weak-methodology sources:** Downgrade confidence in their
specific claims but don't necessarily discard them. "Source X reports 10x
performance improvement, though the benchmark conditions are not described.
Source Y reports 3-5x improvement under described conditions. We consider
the 3-5x range more reliable."

### 5. Bias

**Question:** Does this source have a reason to favor a particular conclusion?

**Common bias sources:**
- **Vendor bias**: The source was created by or sponsored by a company that
  benefits from the conclusion. A database vendor's benchmark of their own
  product is not independent evidence.
- **Selection bias**: The source chose what to include. A "top 10" list
  necessarily excludes options that might be relevant.
- **Confirmation bias**: The source set out to prove a point rather than
  investigate a question. Look for balanced treatment of alternatives.
- **Survivorship bias**: The source covers successful cases and omits
  failures. A collection of "companies that migrated to X" doesn't show
  the companies that tried and reverted.
- **Novelty bias**: Sources (especially blog posts and conference talks)
  tend to cover new and exciting things, underrepresenting stable, boring,
  proven options.

**How to handle biased sources:** Biased sources are not automatically wrong.
A vendor's documentation is the most authoritative source for what their
product can do. But vendor-published benchmarks need independent validation.
Framework authors' blog posts provide the best explanation of design decisions
but need community experience to validate the claimed benefits.

Use biased sources for the information they're uniquely positioned to provide
(how a thing works, what it's designed for), and seek independent sources for
evaluative claims (whether it's better, whether it's suitable, whether it
performs as advertised).

## Putting It Together

After evaluating each source on all five dimensions, assign an overall weight:

| Weight | Criteria | How to use |
|--------|----------|-----------|
| **High** | Strong on credibility and methodology, adequate recency, relevant, no significant bias | Anchor your findings on these sources |
| **Medium** | Strong on most dimensions, weak on one (e.g., slightly dated but otherwise excellent, or credible but potentially biased) | Use to corroborate, note the limitation |
| **Low** | Weak on multiple dimensions, or strong only on one | Use only to note that a perspective exists, don't anchor findings on it |

Document your source assessment when it affects confidence. You don't need
to write a paragraph about every source, but for key findings, note: "This
finding is supported by [high-confidence source] and corroborated by [medium-
confidence source]. A [low-confidence source] suggests a different conclusion,
but its methodology is undescribed."
