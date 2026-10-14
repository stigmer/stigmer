"use client";

/**
 * One plugin eval's results: one row per case, one column group per
 * target (`WITH`, `W/OUT`, `Δ`, pass^k), each try a link to its run where
 * the viewer can open it, the cases not run with their reasons, and the
 * suite's totals.
 *
 * The view reads the eval again while it is pending or running
 * ({@link usePluginEval}), so tries fill in as they finish; the plugin's
 * editors may cancel it then. A read again that fails keeps the last
 * results on screen with a small notice; only a first read that fails
 * shows the error alone.
 *
 * Who opens a try is the edition's rule, and no try carries its own
 * `can_view`: Stigmer Cloud writes each try's read-only session link for
 * the plugin's viewers, so every viewer there opens every try; elsewhere
 * the tries are their creator's conversations, so they are links only when
 * the viewer is the eval's creator (`useWhoAmI`, a cached read, asked only
 * there and only when the host can open a run). A try that is not a link
 * still shows its result. `Δ` is marked provisional, with the reason, when
 * the eval says the comparison also measured an agent Stigmer composed for
 * the plugin (an eval made before conversations listed plugins directly). A try the platform could not grade shows why,
 * never a zero. The heading is the eval's label, its plugin and when it
 * started; a reason the eval stopped that a newer server added reads
 * "stopped early".
 *
 * All visual properties flow through `--stgm-*` tokens.
 */

import {
  PluginEvalPartialReason,
  PluginEvalPhase,
} from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
import { cn } from "@stigmer/theme";
import { useDeploymentMode } from "../deployment-mode.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { useWhoAmI } from "../grant/useWhoAmI.js";
import { Section } from "../resource-detail/Section.js";
import { DANGER_BUTTON_CLASS } from "../vault/styles.js";
import { EvalCaseTable } from "./EvalCaseTable.js";
import {
  evalCaseRowsOf,
  evalLabelOf,
  formatDelta,
  formatUsd,
  isEvalActive,
  partialLabel,
  phaseLabel,
  evalTargetLabelsOf,
} from "./eval-view.js";
import { useCancelPluginEval } from "./useCancelPluginEval.js";
import { usePluginEval } from "./usePluginEval.js";

/** Props for {@link PluginEvalResults}. */
export interface PluginEvalResultsProps {
  /** The eval's id. */
  readonly evalId: string;
  /** The evaluated plugin's name, for the heading; "Eval" when omitted. */
  readonly pluginName?: string;
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

/** The results of one plugin eval, case by case and target by target. */
export function PluginEvalResults({
  evalId,
  pluginName = "",
  canEdit = false,
  onNavigateToRun,
  onChanged,
  className,
}: PluginEvalResultsProps) {
  const { pluginEval, isLoading, error, refetch } = usePluginEval(evalId);
  const { cancel, isCancelling, error: cancelError } = useCancelPluginEval();
  // Stigmer Cloud writes each try's session link for the plugin's viewers;
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
  if (pluginEval === null) {
    return error !== null ? (
      <ErrorMessage error={error} retry={refetch} className={className} />
    ) : null;
  }

  const creatorId = pluginEval.status?.audit?.specAudit?.createdBy?.id ?? "";
  const viewerOpensTries =
    viewersOpenTries ||
    (creatorId !== "" && viewer?.metadata?.id === creatorId);
  const openRun = viewerOpensTries ? onNavigateToRun : undefined;

  const status = pluginEval.status;
  const labels = evalTargetLabelsOf(pluginEval);
  const rows = evalCaseRowsOf(pluginEval);
  const provisional = status?.provisionalDelta === true;
  const aggregates = status?.aggregates;
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

  return (
    <Section
      title={evalLabelOf(pluginEval, pluginName)}
      className={className}
      headerActions={
        canEdit && isEvalActive(pluginEval) ? (
          <button
            type="button"
            disabled={isCancelling}
            onClick={() => void onCancel()}
            className={DANGER_BUTTON_CLASS}
          >
            {isCancelling ? "Cancelling…" : "Cancel"}
          </button>
        ) : undefined
      }
    >
      <div className="stg:flex stg:flex-col stg:gap-3 stg:px-3 stg:py-2.5">
        <p role="status" className="stg:text-xs stg:text-muted-foreground">
          {phaseLabel(status?.phase ?? PluginEvalPhase.unspecified)}
          {partial !== "" ? ` (${partial})` : ""}{" "}
          · {status?.triesFinished ?? 0} of {status?.triesTotal ?? 0} tries ·{" "}
          {aggregates?.casesPassed ?? 0} of {aggregates?.casesTotal ?? 0} cases
          passed · mean Δ {formatDelta(aggregates?.meanDelta)}
          {provisional ? " (provisional)" : ""} ·{" "}
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
        {provisional && (
          <p className="stg:text-xs stg:text-muted-foreground">
            Δ is provisional: this eval ran before conversations listed
            plugins directly, so its runs with the plugin also carried an
            agent Stigmer composed for it, and the difference measures that
            agent as well as the plugin.
          </p>
        )}
        <EvalCaseTable
          rows={rows}
          labels={labels}
          arms="both"
          provisional={provisional}
          onNavigateToRun={openRun}
        />
        {cancelError !== null && (
          <p role="alert" className="stg:text-xs stg:text-destructive">
            {cancelError.message}
          </p>
        )}
      </div>
    </Section>
  );
}
