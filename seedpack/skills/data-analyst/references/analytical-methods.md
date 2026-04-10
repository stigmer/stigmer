# Analytical Methods

Use this reference when choosing an analytical approach in Step 3. Each method
includes when to use it, what to watch for, and how to communicate the results.
Start with the simplest method that answers the question.

## Comparison

**When to use:** The question asks "how does X compare to Y?" — comparing
segments, time periods, products, cohorts, or alternatives.

**How to execute:**

1. Define the comparison dimensions clearly. What are you comparing (groups),
   on what metric (measure), over what period (time frame)?
2. Ensure the comparison is fair. Comparing a mature product to a newly launched
   one on total revenue is misleading. Normalize: use per-user, per-month, or
   growth-rate metrics.
3. Test for significance when sample sizes are small. A 10% difference between
   two groups of 50 users each is likely noise. A 10% difference between two
   groups of 50,000 each is probably real.
4. Include absolute numbers alongside percentages. "Feature A has 50% higher
   adoption" sounds impressive until you learn it's 3 users vs. 2.

**What to watch for:**

- **Survivorship bias**: Comparing active users across cohorts ignores the
  churned users who are no longer in the data.
- **Simpson's paradox**: A trend that appears in aggregate can reverse when
  you break it down by segment. Always check whether the overall pattern holds
  within subgroups.
- **Cherry-picked time frames**: Any metric can look good or bad depending on
  the start and end dates chosen. Use consistent, pre-defined periods.

**How to communicate:** Side-by-side tables or grouped bar charts. Lead with
the dimension of comparison and the key difference: "Enterprise accounts
generate 4.2x more revenue per account than SMB ($12,400 vs. $2,950 annually)."

## Trend Analysis

**When to use:** The question asks "what's happening over time?" — identifying
growth, decline, seasonality, or inflection points.

**How to execute:**

1. Plot the data over time at the finest granularity that's meaningful. Daily
   data shows noise that weekly smooths out, but weekly data hides events that
   happen within a week.
2. Look for structural changes: sudden jumps or drops (events), gradual slope
   changes (trend shifts), and recurring patterns at fixed intervals (seasonality).
3. When comparing trends across metrics of different magnitudes, use indexed
   values (100 = baseline) or separate y-axes. Don't plot revenue ($millions)
   and user count (thousands) on the same scale.
4. Extend the time window far enough to distinguish trends from cycles.
   Three months of decline could be a real trend or a seasonal dip that
   recovers every year.

**What to watch for:**

- **Confusing correlation with trend**: Two metrics trending up simultaneously
  doesn't mean one causes the other.
- **Outlier distortion**: A single extreme value can shift an average trendline
  dramatically. Use medians or remove outliers explicitly (and note that you did).
- **Lagging indicators**: Some metrics respond to changes with a delay. Revenue
  changes may not appear until the billing cycle after a user behavior change.

**How to communicate:** Line charts with clear axis labels and annotation of
key events. Lead with the direction and magnitude: "Monthly active users grew
18% from January through March, then plateaued in April coinciding with the
end of the promotional campaign."

## Distribution Analysis

**When to use:** The question asks "what does the population look like?" —
understanding spread, concentration, and outliers within a dataset.

**How to execute:**

1. Start with summary statistics: mean, median, min, max, standard deviation
   (or interquartile range). If the mean and median diverge significantly,
   the distribution is skewed and the mean alone is misleading.
2. Look at the shape: is it normal (bell curve), skewed (long tail on one side),
   bimodal (two peaks), or uniform (flat)? The shape determines which summary
   statistics are meaningful.
3. Identify the extremes. What does the top 1% look like? The bottom 1%? In
   many business datasets, a small number of extreme values (power users, large
   deals) drive the aggregate metrics.
4. Segment the distribution if it looks multimodal. Two overlapping populations
   (e.g., free-tier and paid-tier users) should be analyzed separately.

**What to watch for:**

- **Averages hiding reality**: "Average session length is 8 minutes" could mean
  most sessions are 7-9 minutes, or it could mean half are 1 minute and half
  are 15 minutes. Always check the distribution shape.
- **Percentiles as alternatives**: When distributions are skewed, report
  percentiles (p50, p90, p99) instead of means. For response times, the p99
  experience often matters more than the average.

**How to communicate:** Histograms for shape, box plots for comparison across
groups. Lead with the practical takeaway: "80% of support tickets are resolved
within 4 hours, but the remaining 20% take 2-7 days — suggesting a bifurcated
process where simple issues resolve quickly but complex ones get stuck."

## Correlation

**When to use:** The question asks "are these two things related?" — investigating
whether changes in one metric are associated with changes in another.

**How to execute:**

1. Start with a scatter plot. Visual inspection reveals whether a relationship
   exists, whether it's linear, and whether there are outliers distorting it.
2. If the relationship looks linear, compute the correlation coefficient.
   Interpret the magnitude: 0.0-0.3 is weak, 0.3-0.7 is moderate, 0.7-1.0
   is strong.
3. Check for confounding variables. If feature usage and revenue are correlated,
   is it because the feature drives revenue, or because both are driven by
   company size?
4. Check the direction of causation. Does higher engagement cause higher
   retention, or do retained users simply have more time to engage? Or does
   a third factor (product-market fit for the user's use case) drive both?

**What to watch for:**

- **Correlation is not causation.** State this explicitly in every correlation
  finding. "Users who complete onboarding retain at 2x the rate" does not prove
  onboarding causes retention — it could be that motivated users both complete
  onboarding and retain, while unmotivated users do neither.
- **Ecological fallacy**: A correlation that holds at the group level may not
  hold at the individual level (and vice versa).
- **Range restriction**: If your data only covers a narrow range of one variable,
  the correlation may appear weak even if a strong relationship exists across
  the full range.

**How to communicate:** Scatter plots with trend lines. State the relationship,
the strength, and the caveat: "There is a moderate positive correlation (r=0.54)
between feature activation speed and 90-day retention. Note: this is associational;
further testing would be needed to confirm a causal relationship."

## Segmentation

**When to use:** The question asks "are there distinct groups within this
population?" — finding meaningful subgroups that behave differently.

**How to execute:**

1. Start with hypothesized segments based on business knowledge: user type,
   geography, acquisition channel, plan tier, usage pattern. Test whether
   these segments actually behave differently on the metric that matters.
2. Compare key metrics across segments. A useful segmentation produces groups
   that differ meaningfully on behavior or outcomes, not just on demographics.
3. Size each segment. A segment that contains 2% of users may be interesting
   but not actionable. A segment that contains 40% of users and has 3x higher
   churn is immediately actionable.
4. Name segments descriptively. "Segment 3" means nothing. "Power users who
   activated within 24 hours" is immediately understood by stakeholders.

**What to watch for:**

- **Over-segmentation**: Splitting the data too finely creates segments that
  are too small for reliable conclusions. Each segment should be large enough
  that its metrics are stable.
- **Overlapping segments**: If a user can belong to multiple segments, the
  segmentation isn't clean enough for action. Each user should map to exactly
  one segment for a given analysis.
- **Static vs. dynamic segments**: Some segments are fixed (geography, signup
  date), others change over time (usage level, engagement tier). Be clear about
  which type you're using and whether users can move between segments.

**How to communicate:** Tables comparing segments side by side on 3-5 key
metrics. Lead with the actionable insight: "Three distinct user segments emerge:
Power Users (15% of base, 95% retention), Regular Users (60%, 72% retention),
and At-Risk Users (25%, 34% retention). The At-Risk segment is identifiable by
week 2 based on login frequency."
