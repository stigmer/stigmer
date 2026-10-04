// An agent's (or a sub-agent's) two tool lists, read-only, in plain words:
// "Only these tools" for `tools`, "Never these tools" for `disallowedTools`.
// Entries are shown verbatim in Claude Code's names (`Read`,
// `Bash(git push *)`, `mcp__github__*`), because those exact strings are what
// the runner resolves; a friendlier rewording would hide which entry binds.
// An empty list means "no restriction" and renders nothing, so an agent with
// neither list shows no rows at all. Pinned by
// `__tests__/AgentDetailView.toolLists.test.tsx`.

import { cn } from "@stigmer/theme";
import { UNSTYLED_LIST } from "../internal/element-resets.js";

/** Props for {@link AgentToolLists}. */
export interface AgentToolListsProps {
  /** `AgentSpec.tools` / `SubAgent.tools`: when non-empty, only these tools. */
  readonly tools: readonly string[];
  /** `AgentSpec.disallowed_tools` / `SubAgent.disallowed_tools`: never these. */
  readonly disallowedTools: readonly string[];
  /** `"section"` pads rows for a page section; `"compact"` nests in a sub-agent. */
  readonly density?: "section" | "compact";
}

/** Whether either list is set, i.e. whether {@link AgentToolLists} renders anything. */
export function hasToolLists(lists: {
  readonly tools: readonly string[];
  readonly disallowedTools: readonly string[];
}): boolean {
  return lists.tools.length > 0 || lists.disallowedTools.length > 0;
}

export function AgentToolLists({
  tools,
  disallowedTools,
  density = "section",
}: AgentToolListsProps) {
  if (!hasToolLists({ tools, disallowedTools })) return null;
  return (
    <div className={cn("stg:flex stg:flex-col", density === "section" ? "stg:gap-2 stg:p-3" : "stg:gap-1.5")}>
      {tools.length > 0 && (
        <ToolListRow label="Only these tools" entries={tools} density={density} />
      )}
      {disallowedTools.length > 0 && (
        <ToolListRow label="Never these tools" entries={disallowedTools} density={density} />
      )}
    </div>
  );
}

function ToolListRow({
  label,
  entries,
  density,
}: {
  readonly label: string;
  readonly entries: readonly string[];
  readonly density: "section" | "compact";
}) {
  return (
    <div className="stg:flex stg:flex-col stg:gap-1" role="group" aria-label={label}>
      <span
        className={cn(
          "stg:font-medium stg:text-muted-foreground",
          density === "section" ? "stg:text-xs" : "stg:text-[0.7rem]",
        )}
      >
        {label}
      </span>
      <ul className={cn(UNSTYLED_LIST, "stg:flex stg:flex-wrap stg:gap-1")}>
        {entries.map((entry) => (
          <li key={entry}>
            <code className="stg:rounded stg:bg-muted-subtle stg:px-1.5 stg:py-0.5 stg:font-mono stg:text-xs stg:text-foreground">
              {entry}
            </code>
          </li>
        ))}
      </ul>
    </div>
  );
}
