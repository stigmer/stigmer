"use client";

/**
 * One plugin eval's results: one row per case, one column group per
 * target (`WITH`, `W/OUT`, `Δ`, pass^k), each try a link to its run, the
 * cases not run with their reasons, and the suite's totals.
 *
 * The view reads the eval again while it is pending or running
 * ({@link usePluginEval}), so tries fill in as they finish; the plugin's
 * editors may cancel it then. `Δ` is marked provisional, with the reason,
 * while the eval says the comparison also measures the agent Stigmer
 * composes for the plugin. A try the platform could not grade shows why,
 * never a zero.
 *
 * All visual properties flow through `--stgm-*` tokens.
 */

import { useState } from "react";
import {
  PluginEvalPartialReason,
  PluginEvalPhase,
} from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
import { cn } from "@stigmer/theme";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
import { Section } from "../resource-detail/Section.js";
import { DANGER_BUTTON_CLASS } from "../vault/styles.js";
import {
  evalCaseRowsOf,
  formatDelta,
  formatScore,
  formatUsd,
  isEvalActive,
  phaseLabel,
  evalTargetLabelsOf,
  type EvalCaseRow,
  type EvalCaseCell,
} from "./eval-view.js";
import { useCancelPluginEval } from "./useCancelPluginEval.js";
import { usePluginEval } from "./usePluginEval.js";

/** Props for {@link PluginEvalResults}. */
export interface PluginEvalResultsProps {
  /** The eval's id. */
  readonly evalId: string;
  /** When `true`, a pending or running eval offers Cancel. @default false */
  readonly canEdit?: boolean;
  /** Called with a try's run id when the person opens it; tries carry no link when omitted. */
  readonly onNavigateToRun?: (runId: string) => void;
  /** Called after a cancel, so a list showing the eval can read it again. */
  readonly onChanged?: () => void;
  /** Additional CSS class names for the root element. */
  readonly className?: string;
}

/** The results of one plugin eval, case by case and target by target. */
export function PluginEvalResults({
  evalId,
  canEdit = false,
  onNavigateToRun,
  onChanged,
  className,
}: PluginEvalResultsProps) {
  const { pluginEval, isLoading, error, refetch } = usePluginEval(evalId);
  const { cancel, isCancelling, error: cancelError } = useCancelPluginEval();
  const [openCase, setOpenCase] = useState<string | null>(null);

  if (isLoading) {
    return (
      <p className={cn("stg:text-xs stg:text-muted-foreground", className)}>
        Loading the eval…
      </p>
    );
  }
  if (error !== null)
    return <ErrorMessage error={error} retry={refetch} className={className} />;
  if (pluginEval === null) return null;

  const status = pluginEval.status;
  const labels = evalTargetLabelsOf(pluginEval);
  const rows = evalCaseRowsOf(pluginEval);
  const ran = rows.filter((row) => row.notRun === "");
  const notRun = rows.filter((row) => row.notRun !== "");
  const provisional = status?.provisionalDelta === true;
  const aggregates = status?.aggregates;

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
      title={pluginEval.metadata?.name || "Eval"}
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
          {status?.partialReason
            ? ` (${partialLabel(status.partialReason)})`
            : ""}{" "}
          · {status?.triesFinished ?? 0} of {status?.triesTotal ?? 0} tries ·{" "}
          {aggregates?.casesPassed ?? 0} of {aggregates?.casesTotal ?? 0} cases
          passed · mean Δ {formatDelta(aggregates?.meanDelta)}
          {provisional ? " (provisional)" : ""} ·{" "}
          {formatUsd(status?.costUsd ?? 0)}
        </p>
        {status?.error ? (
          <ErrorMessage
            error={new Error(status.error)}
            title="The eval could not run"
          />
        ) : null}
        {provisional && (
          <p className="stg:text-xs stg:text-muted-foreground">
            Δ is provisional: the runs with the plugin also carry the agent
            Stigmer composes for it at install, whose instructions name the
            plugin, so the difference measures that agent as well as the
            plugin&apos;s parts.
          </p>
        )}
        {ran.length > 0 && (
          <div className="stg:overflow-x-auto">
            <table className="stg:w-full stg:text-xs">
              <thead>
                {labels.length > 1 && (
                  <tr className="stg:text-left stg:text-muted-foreground">
                    <td />
                    {labels.map((label) => (
                      <th
                        key={label}
                        scope="colgroup"
                        colSpan={4}
                        className={cn(CELL_CLASS, "stg:font-mono")}
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                )}
                <tr className="stg:border-b stg:border-border stg:text-left stg:text-muted-foreground">
                  <th scope="col" className={CELL_CLASS}>
                    Case
                  </th>
                  {labels.map((label) => (
                    <TargetHeaders
                      key={label}
                      label={label}
                      provisional={provisional}
                    />
                  ))}
                </tr>
              </thead>
              <tbody>
                {ran.map((row) => (
                  <CaseRowView
                    key={row.name}
                    row={row}
                    labels={labels}
                    open={openCase === row.name}
                    onToggle={() =>
                      setOpenCase(openCase === row.name ? null : row.name)
                    }
                    onNavigateToRun={onNavigateToRun}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {notRun.length > 0 && (
          <ul
            className={cn(UNSTYLED_LIST, "stg:flex stg:flex-col stg:gap-0.5")}
            aria-label="Cases not run"
          >
            {notRun.map((row) => (
              <li
                key={row.name}
                className="stg:text-xs stg:text-muted-foreground"
              >
                <span className="stg:font-medium stg:text-foreground">
                  {row.name}
                </span>
                : {row.notRun}
              </li>
            ))}
          </ul>
        )}
        {cancelError !== null && (
          <p role="alert" className="stg:text-xs stg:text-destructive">
            {cancelError.message}
          </p>
        )}
      </div>
    </Section>
  );
}

function TargetHeaders({
  label,
  provisional,
}: {
  readonly label: string;
  readonly provisional: boolean;
}) {
  return (
    <>
      <th
        scope="col"
        className={CELL_CLASS}
        aria-label={`With the plugin, ${label}`}
      >
        WITH
      </th>
      <th
        scope="col"
        className={CELL_CLASS}
        aria-label={`Without the plugin, ${label}`}
      >
        W/OUT
      </th>
      <th
        scope="col"
        className={CELL_CLASS}
        aria-label={`Difference, ${label}${provisional ? ", provisional" : ""}`}
      >
        Δ{provisional ? "*" : ""}
      </th>
      <th
        scope="col"
        className={CELL_CLASS}
        aria-label={`Every try passed, ${label}`}
      >
        PASS^k
      </th>
    </>
  );
}

function CaseRowView({
  row,
  labels,
  open,
  onToggle,
  onNavigateToRun,
}: {
  readonly row: EvalCaseRow;
  readonly labels: readonly string[];
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly onNavigateToRun?: (runId: string) => void;
}) {
  const cells = labels.map((label) =>
    row.cells.find((cell) => cell.target === label),
  );
  return (
    <>
      <tr className="stg:border-b stg:border-border stg:last:border-b-0">
        <th
          scope="row"
          className={cn(
            CELL_CLASS,
            "stg:text-left stg:font-medium stg:text-foreground",
          )}
        >
          <button
            type="button"
            aria-expanded={open}
            onClick={onToggle}
            className="stg:text-left stg:hover:underline stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring"
          >
            {row.name}
          </button>
        </th>
        {cells.map((cell, index) => (
          <CellView key={labels[index]} cell={cell} />
        ))}
      </tr>
      {open && (
        <tr>
          <td
            colSpan={1 + labels.length * 4}
            className={cn(CELL_CLASS, "stg:bg-muted-subtle")}
          >
            <TryList row={row} onNavigateToRun={onNavigateToRun} />
          </td>
        </tr>
      )}
    </>
  );
}

function CellView({ cell }: { readonly cell: EvalCaseCell | undefined }) {
  if (cell === undefined || cell.notRun !== "") {
    return (
      <td colSpan={4} className={cn(CELL_CLASS, "stg:text-muted-foreground")}>
        {cell?.notRun ?? "—"}
      </td>
    );
  }
  return (
    <>
      <td
        className={cn(
          CELL_CLASS,
          cell.passed ? "stg:text-foreground" : "stg:text-warning",
        )}
      >
        {formatScore(cell.withScore)}
      </td>
      <td className={cn(CELL_CLASS, "stg:text-muted-foreground")}>
        {formatScore(cell.withoutScore)}
      </td>
      <td className={CELL_CLASS}>{formatDelta(cell.delta)}</td>
      <td className={CELL_CLASS}>{cell.passK ? "yes" : "no"}</td>
    </>
  );
}

function TryList({
  row,
  onNavigateToRun,
}: {
  readonly row: EvalCaseRow;
  readonly onNavigateToRun?: (runId: string) => void;
}) {
  return (
    <div className="stg:flex stg:flex-col stg:gap-2">
      {row.notes.length > 0 && (
        <ul
          className={cn(UNSTYLED_LIST, "stg:text-muted-foreground")}
          aria-label={`Notes on ${row.name}`}
        >
          {row.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
      {row.cells.map((cell) => (
        <div key={cell.target} className="stg:flex stg:flex-col stg:gap-0.5">
          <span className="stg:font-mono stg:text-muted-foreground">
            {cell.target}
          </span>
          <ul
            className={cn(
              UNSTYLED_LIST,
              "stg:flex stg:flex-wrap stg:gap-x-3 stg:gap-y-0.5",
            )}
            aria-label={`Tries on ${cell.target}`}
          >
            {cell.tries.map((attempt) => {
              const label = `${attempt.arm === "with" ? "with" : "without"} #${attempt.index}: ${attempt.summary}`;
              return (
                <li key={`${attempt.arm}:${attempt.index}`}>
                  {onNavigateToRun !== undefined && attempt.runId !== "" ? (
                    <button
                      type="button"
                      onClick={() => onNavigateToRun(attempt.runId)}
                      className="stg:text-foreground stg:underline stg:underline-offset-2 stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring"
                    >
                      {label}
                    </button>
                  ) : (
                    <span className="stg:text-muted-foreground">{label}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function partialLabel(reason: PluginEvalPartialReason): string {
  switch (reason) {
    case PluginEvalPartialReason.cost_ceiling:
      return "cost limit reached";
    case PluginEvalPartialReason.out_of_credit:
      return "out of credit";
    case PluginEvalPartialReason.cancelled:
      return "cancelled";
    case PluginEvalPartialReason.unspecified:
      return "";
    default: {
      const exhaustive: never = reason;
      return String(exhaustive);
    }
  }
}

const CELL_CLASS = "stg:px-2 stg:py-1.5";
