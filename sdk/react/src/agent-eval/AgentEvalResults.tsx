"use client";

/**
 * One agent eval's results: headed by the agent version it ran and when it
 * started, its totals, then one section per plugin the agent attaches,
 * each named by its slug and its version (digest, short) with its cases in
 * the plugin eval's table in its one-arm form (the score and pass^k per
 * target), each try a link to its run where the viewer can open it; a
 * plugin whose cases did not run shows why.
 *
 * The view reads the eval again while it is pending or running
 * ({@link useAgentEval}), so tries fill in as they finish; the agent's
 * editors may cancel it then. Anyone who reads the eval may download its
 * result document (`toAgentEvalResultDocument`, the CLI's file). A read
 * again that fails keeps the last results on screen with a small notice;
 * only a first read that fails shows the error alone.
 *
 * Who opens a try is the plugin eval's rule: in Stigmer Cloud every viewer
 * of the eval may, elsewhere only the eval's creator, whose conversations
 * the tries are (`useWhoAmI`, asked only there and only when the host can
 * open a run).
 *
 * All visual properties flow through `--stgm-*` tokens.
 */

import { toAgentEvalResultDocument } from "@stigmer/sdk";
import {
  PluginEvalPartialReason,
  PluginEvalPhase,
} from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
import { cn } from "@stigmer/theme";
import { useDeploymentMode } from "../deployment-mode.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { useWhoAmI } from "../grant/useWhoAmI.js";
import { downloadTextFile } from "../internal/download.js";
import { Section } from "../resource-detail/Section.js";
import { DANGER_BUTTON_CLASS, QUIET_BUTTON_CLASS } from "../vault/styles.js";
import { EvalCaseTable } from "../plugin-eval/EvalCaseTable.js";
import {
  formatScore,
  formatUsd,
  isEvalActive,
  partialLabel,
  phaseLabel,
} from "../plugin-eval/eval-view.js";
import {
  agentEvalLabelOf,
  agentEvalSectionsOf,
  shortDigest,
  type AgentEvalPluginSection,
} from "./agent-eval-view.js";
import { useAgentEval } from "./useAgentEval.js";
import { useCancelAgentEval } from "./useCancelAgentEval.js";

/** Props for {@link AgentEvalResults}. */
export interface AgentEvalResultsProps {
  /** The eval's id. */
  readonly evalId: string;
  /** The agent's slug, for the result document's `agent.slug` and its file name. */
  readonly agentSlug?: string;
  /** When `true`, a pending or running eval offers Cancel. @default false */
  readonly canEdit?: boolean;
  /**
   * Called with a try's run id when the person opens it; tries carry no
   * link when omitted, nor where the viewer cannot open them (outside
   * Stigmer Cloud, anyone but the eval's creator).
   */
  readonly onNavigateToRun?: (runId: string) => void;
  /** Called after a cancel, so a list showing the eval can read it again. */
  readonly onChanged?: () => void;
  /** Additional CSS class names for the root element. */
  readonly className?: string;
}

/**
 * The results of one agent eval, plugin by plugin and case by case.
 *
 * @example
 * ```tsx
 * <AgentEvalResults evalId={id} agentSlug="reviewer" canEdit onNavigateToRun={openRun} />
 * ```
 */
export function AgentEvalResults({
  evalId,
  agentSlug = "",
  canEdit = false,
  onNavigateToRun,
  onChanged,
  className,
}: AgentEvalResultsProps) {
  const { agentEval, isLoading, error, refetch } = useAgentEval(evalId);
  const { cancel, isCancelling, error: cancelError } = useCancelAgentEval();
  // Stigmer Cloud writes each try's session link for the eval's viewers;
  // elsewhere only the eval's creator opens a try.
  const viewersOpenTries = useDeploymentMode() === "cloud";
  const { account: viewer } = useWhoAmI({
    enabled: onNavigateToRun !== undefined && !viewersOpenTries,
  });

  if (isLoading) {
    return (
      <p className={cn("stg:text-xs stg:text-muted-foreground", className)}>
        Loading the eval…
      </p>
    );
  }
  if (agentEval === null) {
    return error !== null ? (
      <ErrorMessage error={error} retry={refetch} className={className} />
    ) : null;
  }

  const creatorId = agentEval.status?.audit?.specAudit?.createdBy?.id ?? "";
  const viewerOpensTries =
    viewersOpenTries ||
    (creatorId !== "" && viewer?.metadata?.id === creatorId);
  const openRun = viewerOpensTries ? onNavigateToRun : undefined;

  const status = agentEval.status;
  const aggregates = status?.aggregates;
  const sections = agentEvalSectionsOf(agentEval);
  const partial = partialLabel(
    status?.partialReason ?? PluginEvalPartialReason.unspecified,
  );

  const onCancel = async (): Promise<void> => {
    try {
      await cancel(evalId);
      refetch();
      onChanged?.();
    } catch {
      // The hook keeps the error; the view shows it below.
    }
  };

  const onDownload = (): void => {
    const resultDocument = toAgentEvalResultDocument(agentEval, { agentSlug });
    downloadTextFile(
      `${JSON.stringify(resultDocument, null, 2)}\n`,
      `${agentSlug || "agent"}-eval-${evalId}.json`,
      "application/json",
    );
  };

  return (
    <Section
      title={agentEvalLabelOf(agentEval)}
      className={className}
      headerActions={
        <>
          <button
            type="button"
            onClick={onDownload}
            className={QUIET_BUTTON_CLASS}
          >
            Download results
          </button>
          {canEdit && isEvalActive(agentEval) && (
            <button
              type="button"
              disabled={isCancelling}
              onClick={() => void onCancel()}
              className={DANGER_BUTTON_CLASS}
            >
              {isCancelling ? "Cancelling…" : "Cancel"}
            </button>
          )}
        </>
      }
    >
      <div className="stg:flex stg:flex-col stg:gap-4 stg:px-3 stg:py-2.5">
        <p role="status" className="stg:text-xs stg:text-muted-foreground">
          {phaseLabel(status?.phase ?? PluginEvalPhase.unspecified)}
          {partial !== "" ? ` (${partial})` : ""}{" "}
          · {status?.triesFinished ?? 0} of {status?.triesTotal ?? 0} tries ·{" "}
          {aggregates?.casesPassed ?? 0} of {aggregates?.casesTotal ?? 0} cases
          passed · score {formatScore(aggregates?.overallScore)} ·{" "}
          {formatUsd(status?.costUsd ?? 0)}
        </p>
        {error !== null && (
          <p className="stg:text-xs stg:text-warning">
            Could not refresh the eval ({error.message}); these are the last
            results read.
          </p>
        )}
        {status?.error ? (
          <ErrorMessage
            error={new Error(status.error)}
            title="The eval could not run"
          />
        ) : null}
        {sections.map((section) => (
          <PluginSectionView
            key={section.pluginId || section.slug}
            section={section}
            onNavigateToRun={openRun}
          />
        ))}
        {cancelError !== null && (
          <p role="alert" className="stg:text-xs stg:text-destructive">
            {cancelError.message}
          </p>
        )}
      </div>
    </Section>
  );
}

function PluginSectionView({
  section,
  onNavigateToRun,
}: {
  readonly section: AgentEvalPluginSection;
  readonly onNavigateToRun?: (runId: string) => void;
}) {
  return (
    <section
      aria-label={`Plugin ${section.slug}`}
      className="stg:flex stg:flex-col stg:gap-2"
    >
      <h4 className="stg:flex stg:flex-wrap stg:items-baseline stg:gap-x-2 stg:text-xs">
        <span className="stg:font-medium stg:text-foreground">
          {section.slug}
        </span>
        <span className="stg:font-mono stg:text-muted-foreground">
          {shortDigest(section.digest)}
        </span>
        {section.notRun === "" && (
          <span className="stg:font-normal stg:text-muted-foreground">
            {section.casesPassed} of {section.casesTotal} cases passed · score{" "}
            {formatScore(section.score)}
          </span>
        )}
      </h4>
      {section.notRun !== "" ? (
        <p className="stg:text-xs stg:text-muted-foreground">
          Not run: {section.notRun}
        </p>
      ) : (
        <EvalCaseTable
          rows={section.rows}
          labels={section.labels}
          arms="with"
          onNavigateToRun={onNavigateToRun}
        />
      )}
    </section>
  );
}
