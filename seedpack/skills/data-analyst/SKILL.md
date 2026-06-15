---
name: data-analyst
visibility: public
description: >
  Analyze data with structured methodology covering question framing, data assessment,
  pattern identification, and insight communication. Use this skill when asked to
  analyze a dataset, interpret metrics, identify trends, investigate anomalies,
  build a report from data, or recommend actions based on numbers. Triggers on
  requests like: "analyze this data", "what do these numbers mean", "why did this
  metric change", "find patterns in this dataset", "build a report on our performance",
  or "what should we do based on these results".
---

# Data Analyst

Turn data into decisions. This skill teaches an analytical methodology — frame,
assess, analyze, synthesize, communicate — that produces insights tied to business
outcomes. The methodology works whether you have access to computational tools or
are reasoning about data described to you. Tool access expands what you can compute;
the methodology ensures what you compute is worth computing.

## Workflow

Follow these steps in order for every analytical task.

### Step 1: Frame the Question

Analysis without a clear question produces interesting observations that nobody
acts on. Before touching data, establish the decision context.

1. **Identify the decision this analysis supports.** Ask: "What will someone do
   differently based on this analysis?" If the answer is nothing, the analysis
   is academic. Sharpen the question until it connects to an action.

   Weak: "Analyze our user data."
   Better: "Which user segments have the highest churn risk, and what would a
   retention intervention look like for each?"

2. **Define what a useful answer looks like.** Before analyzing, describe the
   format of the deliverable: a comparison table, a ranked list, a trend with
   explanation, a recommendation with confidence level. This prevents the common
   failure of producing analysis that is thorough but doesn't answer the question.

3. **Identify the time frame, scope, and constraints.** Are we looking at all
   customers or a segment? Last quarter or last year? Are there known data
   limitations (incomplete records, recent migration, delayed pipeline)? Surface
   these constraints before they invalidate the analysis.

4. **Agree on the success metric.** What would make the stakeholder say "this
   is exactly what I needed"? A precise number? A ranked list? A directional
   finding with confidence bounds? Knowing this prevents over- or under-investing.

### Step 2: Assess the Data

Every dataset has quality issues. Finding them before analysis prevents
confidently wrong conclusions.

1. **Check completeness.** Are there missing values, gaps in time series, or
   segments with no data? Missing data is not neutral — it often means the most
   important observations are absent (churned users stop generating events,
   failed transactions may not be logged).

2. **Check consistency.** Are units consistent (dollars vs. cents, seconds vs.
   milliseconds)? Are categories spelled the same way? Do date formats match?
   Are there duplicates? Inconsistent data silently poisons aggregations.

3. **Check provenance.** Where did this data come from? How was it collected?
   When was it last updated? Data that was manually entered has different error
   characteristics than data from an automated pipeline. Self-reported data has
   different biases than observed data.

4. **Check representativeness.** Does the data cover what you need to answer the
   question? A dataset of power users doesn't tell you about casual users. A
   dataset from January doesn't predict July behavior if there's seasonality.

5. **State limitations explicitly.** Every analysis should include a "Data
   limitations" section that tells the reader what the data cannot answer and
   what caveats apply to the findings.

### Step 3: Analyze

Choose your analytical approach based on the question type, then execute
systematically.

**Match approach to question:**

| Question type | Analytical approach | What to deliver |
|--------------|--------------------|--------------------|
| "What happened?" | Descriptive analysis: aggregations, distributions, time series | Summary statistics, trend lines, segment breakdowns |
| "Why did it happen?" | Diagnostic analysis: drill-downs, comparisons, correlation | Contributing factors with evidence, alternative explanations considered |
| "What will happen?" | Predictive reasoning: trend projection, pattern extrapolation | Projections with confidence ranges and stated assumptions |
| "What should we do?" | Prescriptive analysis: option comparison, tradeoff assessment | Ranked recommendations with expected impact and risk |

Read [references/analytical-methods.md](references/analytical-methods.md) for
detailed guidance on each method.

**During analysis:**

1. **Start with the simplest view.** Before running sophisticated analyses,
   look at basic distributions, counts, and averages. Simple views often reveal
   the answer directly or point to where to dig deeper. If the answer to "why
   did revenue drop" is visible in a monthly revenue chart showing a single bad
   week, you don't need a regression model.

2. **Compare against a baseline.** A number in isolation means nothing. "5,000
   new users" is only meaningful compared to something: last month, the same month
   last year, the target, or a competitor. Always provide context for numbers.

3. **Look for what's absent.** Analysts naturally focus on peaks and patterns in
   the data present. Also look for what's missing: segments with no growth, time
   periods with no activity, features with no adoption. Absences often contain
   the most actionable insights.

4. **Test alternative explanations.** When you identify a pattern or cause, ask
   "what else could explain this?" before committing to the interpretation. Revenue
   increased after the marketing campaign — but also after a pricing change and
   a seasonal uptick. Which factor matters most? If you can't isolate the cause,
   say so.

### Step 4: Synthesize Findings

Separate what you observed from what you interpret. This distinction is the
difference between trustworthy analysis and speculation.

1. **State observations as facts.** "Monthly active users declined 12% between
   March and April" is a fact that can be verified. Present it without
   interpretation first.

2. **State interpretations as interpretations.** "The decline was likely caused
   by the price increase on March 15th" is an interpretation. Flag it as such
   and provide the evidence: "The decline began in the week following the price
   change and was concentrated in the price-sensitive segment."

3. **Quantify your confidence.** Not every finding has the same reliability.
   Distinguish between:
   - **High confidence**: Directly supported by the data, alternative
     explanations ruled out or unlikely
   - **Medium confidence**: Supported by the data but alternative explanations
     plausible, or based on a small sample
   - **Low confidence**: Directionally suggested by the data but not conclusive,
     requires further investigation

4. **Identify what you don't know.** Every analysis has blind spots. State them:
   "This analysis covers users who stayed; we don't have data on why departing
   users left." Stakeholders calibrate their trust based on what you tell them
   the analysis can't answer.

### Step 5: Communicate Insights

Structure your communication for the decision-maker, not for yourself. The
analysis might have taken hours; the communication should take minutes to
understand.

**Narrative structure — use this order:**

1. **Context**: One sentence on what was analyzed and why. "We analyzed Q1
   churn data to identify which customer segments are at highest risk."
2. **Key finding**: The single most important insight, stated plainly. "Enterprise
   customers have 3x lower churn than SMB customers, but SMB customers who
   complete onboarding within 7 days have churn rates comparable to enterprise."
3. **Supporting evidence**: The 2-3 data points that back the key finding.
4. **Implications**: What this means for the business. "Investing in faster SMB
   onboarding could reduce overall churn by an estimated 15-20%."
5. **Recommendations**: Specific, actionable next steps with expected impact.
6. **Limitations**: What this analysis cannot answer and where further
   investigation is needed.

**Formatting for readability:**

- Lead with the bottom line. Stakeholders who have 30 seconds should get the
  answer from the first paragraph.
- Use tables for comparisons. Side-by-side numbers are easier to parse than
  inline numbers buried in text.
- Use bullet points for lists of findings. Do not bury three key insights in
  a paragraph.
- Include the numbers. "Revenue increased significantly" is an opinion.
  "Revenue increased 23% QoQ, from $1.2M to $1.47M" is a finding.

Read [references/visualization-guide.md](references/visualization-guide.md) for
guidance on when and how to use charts, tables, and other visual representations.

## Key Principles

1. **Every analysis starts with a decision.** If you can't name the decision the analysis supports, stop and clarify before spending time on data. Analysis that doesn't lead to action is a report, not an insight.

2. **Assess data quality before trusting it.** A sophisticated analysis on flawed data produces sophisticated nonsense. Spend time up front understanding what the data represents, what it's missing, and how it was collected.

3. **Simple first, complex only if needed.** Averages, counts, and trend lines answer most business questions. Reach for statistical models and complex methods only when simple approaches fail to answer the question. The goal is insight, not methodological impressiveness.

4. **Separate observation from interpretation.** "Revenue dropped 12%" is a fact. "The new pricing scared customers away" is a theory. Present both, but never blend them. Stakeholders need to know which parts of your analysis are verified and which are your best interpretation.

5. **Quantify or qualify — never wave hands.** "Growth is slowing" is hand-waving. "Month-over-month growth declined from 8% to 3% over the last quarter" is analysis. If you can't put a number on it, explain why and provide the directional assessment with appropriate caveats.

6. **Absence is data.** The segments that aren't growing, the features nobody uses, the customers who disappeared — these gaps often contain the highest-value insights. Don't just analyze what's present; actively look for what's missing.

7. **Recommendations must be actionable.** "Improve retention" is not a recommendation. "Launch a targeted onboarding email sequence for SMB accounts that haven't activated within 72 hours, projected to reduce 30-day churn by 8-12%" is a recommendation. Include the what, for whom, and expected impact.

## Reference Files

| File | When to Read |
|------|-------------|
| [references/analytical-methods.md](references/analytical-methods.md) | When choosing an analytical approach for a specific question type: comparison, trend analysis, distribution analysis, correlation, or segmentation |
| [references/visualization-guide.md](references/visualization-guide.md) | When deciding how to visually represent findings: chart type selection, table design, and principles of effective data visualization |
