"use client";

/**
 * One eval run's results: headed by its label (on a plugin, the plugin and
 * when it started; on an agent, the version it ran, the plugin it
 * compared, and when it started), its totals, then one section per plugin
 * a try loaded, each named by its slug and its version (digest, short),
 * marked when it is the plugin compared, with its cases in the table's
 * two-arm form when the eval run compares a plugin (`WITH`, `W/OUT`, `Δ`,
 * pass^k per target) and its one-arm form when it compares none (the score
 * and pass^k), each try a link to its run where the viewer can open it; a
 * plugin whose cases did not run shows why.
 *
 * The view reads the eval run again while it is pending or running
 * ({@link useEvalRun}), so tries fill in as they finish; the editors of
 * its agent or plugin may cancel it then. Anyone who reads it may download
 * its result document (`toResultDocument`, the CLI's file). A read again
 * that fails keeps the last results on screen with a small notice; only a
 * first read that fails shows the error alone.
 *
 * Who opens a try is the edition's rule, and no try carries its own
 * `can_view`: Stigmer Cloud writes each try's read-only session link for
 * the eval run's viewers, so every viewer there opens every try; elsewhere
 * the tries are their creator's conversations, so they are links only when
 * the viewer is the eval run's creator (`useWhoAmI`, a cached read, asked
 * only there and only when the host can open a run). A try that is not a
 * link still shows its result. A try the platform could not grade shows
 * why, never a zero; a reason the eval run stopped that a newer server
 * added reads "stopped early".
 *
 * All visual properties flow through `--stgm-*` tokens.
 */

import { toResultDocument } from "@stigmer/sdk";
import {
  EvalRunPartialReason,
  EvalRunPhase,
} from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/status_pb";
import { cn } from "@stigmer/theme";
import { useDeploymentMode } from "../deployment-mode.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { useWhoAmI } from "../grant/useWhoAmI.js";
import { downloadTextFile } from "../internal/download.js";
import { Section } from "../resource-detail/Section.js";
import { DANGER_BUTTON_CLASS, QUIET_BUTTON_CLASS } from "../vault/styles.js";
import { EvalCaseTable, type EvalCaseTableArms } from "./EvalCaseTable.js";
import {
  evalRunLabelOf,
  evalRunSectionsOf,
  formatDelta,
  formatScore,
  formatUsd,
  isAboutAgent,
  isComparing,
  isEvalActive,
  partialLabel,
  phaseLabel,
  shortDigest,
  type EvalRunPluginSection,
} from "./eval-view.js";
import { useCancelEvalRun } from "./useCancelEvalRun.js";
import { useEvalRun } from "./useEvalRun.js";

/** Props for {@link EvalRunResults}. */
export interface EvalRunResultsProps {
  /** The eval run's id. */
  readonly evalRunId: string;
  /**
   * The slug of what the eval run is about, for the heading of one about a
   * plugin and for the result document's `subject.slug` and its file name.
   */
  readonly subjectSlug?: string;
  /** When `true`, a pending or running eval run offers Cancel. @default false */
  readonly canEdit?: boolean;
  /**
   * Called with a try's run id when the person opens it; tries carry no
   * link when omitted, nor where the viewer cannot open them (outside
   * Stigmer Cloud, anyone but the eval run's creator).
   */
  readonly onNavigateToRun?: (runId: string) => void;
  /** Called after a cancel, so a list showing the eval run can read it again. */
  readonly onChanged?: () => void;
  /** Additional CSS class names for the root element. */
  readonly className?: string;
}

/**
 * The results of one eval run, plugin by plugin and case by case.
 *
 * @example
 * ```tsx
 * <EvalRunResults evalRunId={id} subjectSlug="reviewer" canEdit onNavigateToRun={openRun} />
 * ```
 */
export function EvalRunResults({
  evalRunId,
  subjectSlug = "",
  canEdit = false,
  onNavigateToRun,
  onChanged,
  className,
}: EvalRunResultsProps) {
  const { evalRun, isLoading, error, refetch } = useEvalRun(evalRunId);
  const { cancel, isCancelling, error: cancelError } = useCancelEvalRun();
  // Stigmer Cloud writes each try's session link for the eval run's
  // viewers; elsewhere only its creator opens a try.
  const viewersOpenTries = useDeploymentMode() === "cloud";
  const { account: viewer } = useWhoAmI({
    enabled: onNavigateToRun !== undefined && !viewersOpenTries,
  });

  if (isLoading) {
    return (
      <p className={cn("stg:text-xs stg:text-muted-foreground", className)}>
        Loading the eval run…
      </p>
    );
  }
  if (evalRun === null) {
    return error !== null ? (
      <ErrorMessage error={error} retry={refetch} className={className} />
    ) : null;
  }

  const creatorId = evalRun.status?.audit?.specAudit?.createdBy?.id ?? "";
  const viewerOpensTries =
    viewersOpenTries ||
    (creatorId !== "" && viewer?.metadata?.id === creatorId);
  const openRun = viewerOpensTries ? onNavigateToRun : undefined;

  const status = evalRun.status;
  const aggregates = status?.aggregates;
  const comparing = isComparing(evalRun);
  const sections = evalRunSectionsOf(evalRun);
  const partial = partialLabel(
    status?.partialReason ?? EvalRunPartialReason.unspecified,
  );

  const onCancel = async (): Promise<void> => {
    try {
      await cancel(evalRunId);
      refetch();
      onChanged?.();
    } catch {
      // The hook keeps the error; the view shows it below.
    }
  };

  const onDownload = (): void => {
    const resultDocument = toResultDocument(evalRun, { subjectSlug });
    downloadTextFile(
      `${JSON.stringify(resultDocument, null, 2)}\n`,
      `${subjectSlug || "eval-run"}-${evalRunId}.json`,
      "application/json",
    );
  };

  return (
    <Section
      title={evalRunLabelOf(evalRun, subjectSlug)}
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
          {canEdit && isEvalActive(evalRun) && (
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
          {phaseLabel(status?.phase ?? EvalRunPhase.unspecified)}
          {partial !== "" ? ` (${partial})` : ""}{" "}
          · {status?.triesFinished ?? 0} of {status?.triesTotal ?? 0} tries ·{" "}
          {aggregates?.casesPassed ?? 0} of {aggregates?.casesTotal ?? 0} cases
          passed · score {formatScore(aggregates?.overallScore)}
          {comparing ? ` · mean Δ ${formatDelta(aggregates?.meanDelta)}` : ""}{" "}
          · {formatUsd(status?.costUsd ?? 0)}
        </p>
        {error !== null && (
          <p className="stg:text-xs stg:text-warning">
            Could not refresh the eval run ({error.message}); these are the
            last results read.
          </p>
        )}
        {status?.error ? (
          <ErrorMessage
            error={new Error(status.error)}
            title="The eval run could not run"
          />
        ) : null}
        {sections.map((section) => (
          <PluginSectionView
            key={section.pluginId || section.slug}
            section={section}
            arms={comparing ? "both" : "with"}
            aboutAgent={isAboutAgent(evalRun)}
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
  arms,
  aboutAgent,
  onNavigateToRun,
}: {
  readonly section: EvalRunPluginSection;
  readonly arms: EvalCaseTableArms;
  /** Whether the eval run is about an agent, where the compared plugin is marked. */
  readonly aboutAgent: boolean;
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
        {aboutAgent && section.compared && (
          <span className="stg:text-muted-foreground">
            {section.attached ? "compared" : "compared, not attached"}
          </span>
        )}
        {section.notRun === "" && (
          <span className="stg:font-normal stg:text-muted-foreground">
            {section.casesPassed} of {section.casesTotal} cases passed · score{" "}
            {formatScore(section.score)}
            {arms === "both" ? ` · mean Δ ${formatDelta(section.meanDelta)}` : ""}
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
          arms={arms}
          onNavigateToRun={onNavigateToRun}
        />
      )}
    </section>
  );
}
