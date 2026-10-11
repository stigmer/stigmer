"use client";

/**
 * An eval's cases as a table: one row per case, one column group per
 * target, each case opening to its notes, its MCP servers and its tries,
 * each try a link to its run when the caller passes `onNavigateToRun`;
 * the cases not run listed below with their reasons.
 *
 * Two forms. A plugin eval's, both arms: `WITH`, `W/OUT`, `Δ` (marked
 * provisional when the eval says so) and pass^k per target, each try
 * labelled with its arm. An agent eval's, one arm: the score and pass^k
 * per target, each try by its number alone, since every try ran the agent
 * with its plugins. The form is the caller's choice, never inferred from
 * the data, so a plugin eval run without the comparison keeps its columns.
 *
 * Kept apart from the results views so a plugin eval and each plugin block
 * of an agent eval render one table. Pinned through
 * `__tests__/PluginEvalResults.test.tsx` and the agent eval's tab tests.
 *
 * All visual properties flow through `--stgm-*` tokens.
 */

import { useState } from "react";
import { cn } from "@stigmer/theme";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
import {
  formatDelta,
  formatScore,
  type EvalCaseCell,
  type EvalCaseRow,
} from "./eval-view.js";

/** Which arms the table shows: both (a plugin eval) or the with-arm alone (an agent eval). */
export type EvalCaseTableArms = "both" | "with";

/** Props for {@link EvalCaseTable}. */
export interface EvalCaseTableProps {
  /** The cases, from `evalCaseRowsOf` or `caseSourceRowsOf`. */
  readonly rows: readonly EvalCaseRow[];
  /** The target columns, in order. */
  readonly labels: readonly string[];
  readonly arms: EvalCaseTableArms;
  /** Marks the difference provisional; read only when both arms show. */
  readonly provisional?: boolean;
  /** Opens a try's run; tries are not links when omitted. */
  readonly onNavigateToRun?: (runId: string) => void;
}

/** The cases that ran as a table, then the cases not run with their reasons. */
export function EvalCaseTable({
  rows,
  labels,
  arms,
  provisional = false,
  onNavigateToRun,
}: EvalCaseTableProps) {
  const [openCase, setOpenCase] = useState<string | null>(null);
  const ran = rows.filter((row) => row.notRun === "");
  const notRun = rows.filter((row) => row.notRun !== "");
  const span = arms === "both" ? 4 : 2;

  return (
    <>
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
                      colSpan={span}
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
                    arms={arms}
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
                  arms={arms}
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
            <li key={row.name} className="stg:text-xs stg:text-muted-foreground">
              <span className="stg:font-medium stg:text-foreground">
                {row.name}
              </span>
              : {row.notRun}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function TargetHeaders({
  label,
  arms,
  provisional,
}: {
  readonly label: string;
  readonly arms: EvalCaseTableArms;
  readonly provisional: boolean;
}) {
  if (arms === "with") {
    return (
      <>
        <th scope="col" className={CELL_CLASS} aria-label={`Score, ${label}`}>
          SCORE
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
  arms,
  open,
  onToggle,
  onNavigateToRun,
}: {
  readonly row: EvalCaseRow;
  readonly labels: readonly string[];
  readonly arms: EvalCaseTableArms;
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
          <CellView key={labels[index]} cell={cell} arms={arms} />
        ))}
      </tr>
      {open && (
        <tr>
          <td
            colSpan={1 + labels.length * (arms === "both" ? 4 : 2)}
            className={cn(CELL_CLASS, "stg:bg-muted-subtle")}
          >
            <TryList row={row} arms={arms} onNavigateToRun={onNavigateToRun} />
          </td>
        </tr>
      )}
    </>
  );
}

function CellView({
  cell,
  arms,
}: {
  readonly cell: EvalCaseCell | undefined;
  readonly arms: EvalCaseTableArms;
}) {
  if (cell === undefined || cell.notRun !== "") {
    return (
      <td
        colSpan={arms === "both" ? 4 : 2}
        className={cn(CELL_CLASS, "stg:text-muted-foreground")}
      >
        {cell?.notRun ?? "—"}
      </td>
    );
  }
  const score = (
    <td
      className={cn(
        CELL_CLASS,
        cell.passed ? "stg:text-foreground" : "stg:text-warning",
      )}
    >
      {formatScore(cell.withScore)}
    </td>
  );
  const passK = <td className={CELL_CLASS}>{cell.passK ? "yes" : "no"}</td>;
  if (arms === "with") {
    return (
      <>
        {score}
        {passK}
      </>
    );
  }
  return (
    <>
      {score}
      <td className={cn(CELL_CLASS, "stg:text-muted-foreground")}>
        {formatScore(cell.withoutScore)}
      </td>
      <td className={CELL_CLASS}>{formatDelta(cell.delta)}</td>
      {passK}
    </>
  );
}

function TryList({
  row,
  arms,
  onNavigateToRun,
}: {
  readonly row: EvalCaseRow;
  readonly arms: EvalCaseTableArms;
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
      {row.mocked.length > 0 && (
        <ul
          className={cn(UNSTYLED_LIST, "stg:font-mono stg:text-muted-foreground")}
          aria-label={`MCP servers of ${row.name}`}
        >
          {row.mocked.map((server) => (
            <li key={server}>{server}</li>
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
              const label =
                arms === "with"
                  ? `#${attempt.index}: ${attempt.summary}`
                  : `${attempt.arm === "with" ? "with" : "without"} #${attempt.index}: ${attempt.summary}`;
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

const CELL_CLASS = "stg:px-2 stg:py-1.5";
