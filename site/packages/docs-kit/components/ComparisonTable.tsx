export interface ComparisonRow {
  /** What the situation looks like without the feature */
  before: string;
  /** What the situation looks like with the feature */
  after: string;
}

export interface ComparisonTableProps {
  /** Label for the "before" column. @default "Without Stigmer" */
  beforeLabel?: string;
  /** Label for the "after" column. @default "With Stigmer" */
  afterLabel?: string;
  /** Comparison rows — at least one required for a meaningful table */
  rows: ComparisonRow[];
}

/**
 * Two-column comparison table that contrasts life without a feature against
 * life with it. Appears on every concept page under "How it compares."
 *
 * The "before" column uses muted text; the "after" column uses full-contrast
 * text. Column headers carry the semantic meaning — color is never the sole
 * differentiator (accessibility mandate).
 */
export function ComparisonTable({
  beforeLabel = "Without Stigmer",
  afterLabel = "With Stigmer",
  rows,
}: ComparisonTableProps) {
  return (
    <div className="not-prose my-6 overflow-hidden rounded-xl border border-fd-border">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-fd-border bg-fd-muted/50">
            <th className="w-1/2 px-4 py-3 text-start font-medium text-fd-muted-foreground">
              {beforeLabel}
            </th>
            <th className="w-1/2 px-4 py-3 text-start font-medium text-fd-foreground">
              {afterLabel}
            </th>
          </tr>
        </thead>
        <tbody className="bg-fd-card">
          {rows.map((row, i) => (
            <tr
              key={i}
              className="border-b border-fd-border last:border-b-0"
            >
              <td className="px-4 py-3 text-fd-muted-foreground">
                {row.before}
              </td>
              <td className="px-4 py-3 text-fd-card-foreground">
                {row.after}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
