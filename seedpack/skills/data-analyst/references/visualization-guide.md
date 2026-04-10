# Visualization Guide

Use this reference when deciding how to present data visually. The right chart
type depends on the relationship you're showing, not on what looks impressive.
Choose the simplest representation that makes the pattern visible.

## Chart Type Selection

Match the chart type to the relationship in the data:

| Relationship | Chart Type | When to Use |
|-------------|-----------|-------------|
| Change over time | Line chart | Continuous time series with a clear trend or pattern |
| Change over time (few periods) | Bar chart | Discrete time periods (quarterly revenue, monthly counts) |
| Part of a whole | Stacked bar chart | Showing composition at specific points (revenue by product, users by plan) |
| Part of a whole (single point) | Horizontal bar chart, sorted | Showing breakdown at one point in time. Avoid pie charts — human eyes compare lengths better than angles |
| Comparison across categories | Grouped bar chart | Comparing 2-5 metrics across categories side by side |
| Distribution | Histogram | Showing the shape and spread of a single variable |
| Distribution comparison | Box plot | Comparing distributions across groups (response times by region) |
| Relationship between two variables | Scatter plot | Showing correlation, clusters, or outliers |
| Ranked items | Horizontal bar chart, sorted | Top 10 lists, leaderboards, feature adoption rankings |
| Geographic patterns | Map / choropleth | When geography is the primary dimension of comparison |

## When Not to Visualize

A chart is not always better than a number or a table.

**Use a single number** when the finding is one metric: "Average response time
decreased from 4.2s to 1.8s." A chart of two data points is visual noise.

**Use a table** when:
- The reader needs to look up specific values (a chart makes exact values hard
  to read)
- You're comparing many dimensions at once (more than 2-3 metrics across
  several categories)
- Precision matters more than pattern recognition

**Use a chart** when:
- The pattern is the point (trend direction, distribution shape, cluster
  separation)
- The reader needs to see relative magnitudes quickly
- The data has too many points for a table to be scannable

## Principles of Effective Visualization

### 1. Title States the Finding, Not the Topic

Bad: "Monthly Revenue"
Good: "Monthly Revenue Grew 23% QoQ, Driven by Enterprise Segment"

The reader should know the takeaway from the title alone. The chart provides
the evidence.

### 2. Label Everything the Reader Needs

- Axes must have labels with units (not just "Revenue" but "Revenue ($M)")
- Time axes should use consistent formatting (Jan 2026, Feb 2026 — not
  2026-01-01, 2/2026)
- Data points that need explanation should be annotated directly on the
  chart ("Product launch" at the inflection point, not in a footnote)

### 3. Start the Y-Axis at Zero for Bar Charts

A bar chart with a y-axis starting at 50% instead of 0% makes a 52% vs 48%
difference look like a 4x difference. Bar charts encode magnitude by length —
truncating the axis breaks this encoding.

Line charts can use a non-zero baseline when the range of variation is small
relative to the absolute values and the reader cares about the changes, not
the absolute level.

### 4. Use Color with Purpose

- Use color to distinguish categories, not to decorate
- Limit to 5-7 colors in a single chart — beyond that, labels are clearer
- Use a single highlight color to draw attention to the key finding, with
  other data in muted tones
- Avoid red/green combinations without an additional distinguishing element
  (pattern, shape) for color-blind readers

### 5. Remove Decoration

- No 3D effects
- No background images or gradients
- No gridlines denser than necessary (light gridlines on the y-axis are
  usually sufficient)
- No redundant legend if the data is directly labeled
- Every visual element should encode data or aid readability — if it does
  neither, remove it

### 6. Order Data Deliberately

- Time series: chronological order (left to right)
- Categories: sorted by value (largest to smallest) unless there is a natural
  order (age groups, Likert scales)
- Never use alphabetical order for categories unless the reader is looking up
  a specific category by name

## Table Design

When presenting data in tables:

- **Align numbers to the right** so decimal points line up and magnitudes are
  visually comparable
- **Align text to the left** for readability
- **Sort by the most important column** unless the reader needs a different
  entry point
- **Bold or highlight the key row or column** that contains the primary finding
- **Include units in the column header** ("Revenue ($K)"), not in every cell
- **Round appropriately**: $1,247,893.21 in a summary table is false precision.
  $1.2M communicates the same magnitude without the noise. Match rounding to the
  level of precision that matters for the decision.
- **Limit columns to what the reader needs**. A table with 12 columns requires
  the reader to identify which ones matter. Pre-filter to the 4-5 columns that
  support the finding.

## Common Visualization Mistakes

**Pie charts for comparison.** Human perception compares lengths more accurately
than angles. A horizontal bar chart sorted by value communicates the same
information as a pie chart, but more clearly. Use pie charts only when there are
2-3 segments and the approximate proportions are the entire message.

**Too many series on one chart.** A line chart with 8 lines is unreadable. If you
have more than 4-5 series, either highlight the 2-3 that matter and mute the rest,
or split into multiple charts.

**Dual y-axes.** Two different scales on the same chart invite misinterpretation.
The visual correlation between the two lines is an artifact of how the axes are
scaled. Use two separate charts instead, or index both series to a common
baseline.

**Unlabeled chart sent without context.** Every chart should have a title that
states the finding and a brief caption that tells the reader what to look at.
A chart emailed without explanation forces the reader to interpret it
themselves — and they may interpret it wrong.
