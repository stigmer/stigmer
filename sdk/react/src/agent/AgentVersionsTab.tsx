"use client";

import { useMemo, useState } from "react";
import { cn } from "@stigmer/theme";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { VersionTimeline } from "../version-history/VersionTimeline.js";
import { DiffViewer } from "../version-history/DiffViewer.js";
import { computeDiff } from "../version-history/computeDiff.js";
import { useAgentVersions } from "./useAgentVersions.js";

/** Props for {@link AgentVersionsTab}. */
export interface AgentVersionsTabProps {
  /** The current agent resource. */
  readonly agent: Agent;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

/**
 * Tab content for the "Versions" panel in the agent detail page.
 *
 * Every apply that changes an agent records a version; every conversation
 * turn records the version it ran. The timeline lists them newest first,
 * with the current one marked and each version's tag and message; selecting
 * an older version shows how its instructions differ from the current
 * version's, so a reader can see what a past turn's agent was told.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 * Zero Console dependencies — safe for platform builder embedding.
 *
 * @example
 * ```tsx
 * <AgentVersionsTab agent={agent} />
 * ```
 */
export function AgentVersionsTab({ agent, className }: AgentVersionsTabProps) {
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const { versions, isLoading, getSpec } = useAgentVersions(
    agent.metadata?.org ?? "",
    agent.metadata?.slug ?? "",
  );
  const currentHash =
    versions.find((v) => v.isCurrent)?.id ?? versions[0]?.id ?? "";
  const showDiff = selectedHash !== null && selectedHash !== currentHash;

  const hunks = useMemo(() => {
    if (!showDiff) return [];
    return computeDiff(
      withFinalNewline(getSpec(selectedHash)?.instructions ?? ""),
      withFinalNewline(getSpec(currentHash)?.instructions ?? ""),
    );
  }, [showDiff, selectedHash, currentHash, getSpec]);

  return (
    <div className={cn("stg:flex stg:min-h-[24rem] stg:gap-4", className)}>
      <div
        className={cn(
          "stg:flex stg:shrink-0 stg:flex-col stg:overflow-y-auto",
          showDiff ? "stg:w-[280px]" : "stg:w-full stg:max-w-md",
        )}
      >
        <VersionTimeline
          entries={versions}
          isLoading={isLoading}
          selectedId={selectedHash ?? undefined}
          onEntrySelect={setSelectedHash}
          emptyMessage="No versions yet. The agent's next change records its first version."
        />
      </div>

      {showDiff && (
        <div className="stg:flex stg:min-w-0 stg:flex-1 stg:flex-col">
          <div className="stg:mb-2 stg:flex stg:items-center stg:gap-2 stg:text-xs stg:text-muted-foreground">
            <span>
              Comparing{" "}
              <code className="stg:rounded stg:bg-muted stg:px-1 stg:py-0.5 stg:font-mono stg:text-[11px]">
                {selectedHash.slice(0, 8)}
              </code>{" "}
              with current
            </span>
          </div>
          <DiffViewer
            hunks={hunks}
            filePath="instructions"
            className="stg:flex-1"
          />
        </div>
      )}
    </div>
  );
}

/**
 * Instructions end without a newline as often as with one; diffing them as
 * written would mark an unchanged last line as removed and re-added.
 */
function withFinalNewline(text: string): string {
  return text === "" || text.endsWith("\n") ? text : `${text}\n`;
}
