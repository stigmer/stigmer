"use client";

/**
 * How an agent's runs went, at the top of its Quality tab: the last 7, 30
 * or 90 days in the active organization, as summary tiles with a daily
 * trend each, a table by agent version beside that version's latest
 * finished agent eval, and the flagged runs the viewer can open.
 *
 * The tiles read the report's total: the runs graded, the run-health pass
 * rate, the AI judge's pass rate per rubric with how many runs it graded,
 * and the thumbs up and down. Each metric is read at its current evaluator
 * version (`quality-view.ts`): a trend breaks where the judge's rules
 * changed, and a dot under it marks the day a new agent version was first
 * seen. A rate always shows with its count. The version table names a
 * version by its tag, else its short hash, and an unversioned agent's runs
 * as "unversioned"; its eval column reads "no eval" when the version has
 * no finished eval the viewer can see (a child organization's viewer is
 * shown none by design). A flagged run names what failed, never why: a
 * reason or a comment can quote the conversation.
 *
 * The report and the flagged list are read apart, so a refused report
 * (no access, or too many grades to count at once) shows the server's
 * message while the flagged list still loads. Navigation is the host's:
 * `onNavigateToRun` opens a run and `onOpenEval` an eval; without them the
 * rows are not links. All visual properties flow through `--stgm-*`
 * tokens. Pinned by `__tests__/AgentQualityReportView.test.tsx`.
 */

import { useState, type ReactNode } from "react";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { Score } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import type { AgentQualityReport } from "@stigmer/protos/ai/stigmer/agentic/score/v1/io_pb";
import { cn } from "@stigmer/theme";
import { useAgentEvals } from "../agent-eval/useAgentEvals.js";
import { agentVersionLabel, useAgentVersions } from "../agent/useAgentVersions.js";
import { TrendChart } from "../charts/TrendChart.js";
import type { TrendMarker } from "../charts/trend-layout.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
import { LoadingRegion } from "../internal/LoadingRegion.js";
import { useActiveOrgId, useOrg } from "../organization/OrgProvider.js";
import { Section } from "../resource-detail/Section.js";
import { QUIET_BUTTON_CLASS } from "../vault/styles.js";
import {
  DEFAULT_QUALITY_WINDOW,
  QUALITY_WINDOWS,
  criterionNamesOf,
  criterionRateOf,
  currentEvaluatorVersionOf,
  dailyRateSeries,
  dailyRunsSeries,
  evalPassRateOf,
  evaluatorChangedIn,
  flaggedWhatOf,
  formatPassRate,
  formatPercent,
  latestFinishedEvalByVersion,
  metricLabelOf,
  metricRateOf,
  metricTallyOf,
  versionChangesOf,
  type PassRate,
  type QualityWindow,
} from "./quality-view.js";
import { FEEDBACK_METRIC, JUDGE_METRIC, RUN_HEALTH_METRIC } from "./score-view.js";
import { useAgentQualityReport } from "./useAgentQualityReport.js";
import { useFlaggedRuns } from "./useFlaggedRuns.js";

/** Props for {@link AgentQualityReportView}. */
export interface AgentQualityReportViewProps {
  /** The agent whose runs the report counts. */
  readonly agent: Agent;
  /**
   * Called with a run id when the person opens a flagged run; the host owns
   * the route. Flagged runs are listed without links when omitted.
   */
  readonly onNavigateToRun?: (runId: string) => void;
  /**
   * Called with an agent eval's id when the person opens a version's eval;
   * `AgentDetailView` opens its Evals tab on it. The eval column is plain
   * text when omitted.
   */
  readonly onOpenEval?: (evalId: string) => void;
  /** Additional CSS class names for the root element. */
  readonly className?: string;
}

/** Turns a version hash into what the person reads. */
type VersionLabeller = (hash: string) => string;

/**
 * An agent's quality over the last 7, 30 or 90 days in the active
 * organization: tiles, daily trends, a by-version table and the flagged
 * runs.
 *
 * @example
 * ```tsx
 * <AgentQualityReportView
 *   agent={agent}
 *   onNavigateToRun={(runId) => router.push(`/runs/${runId}`)}
 * />
 * ```
 */
export function AgentQualityReportView({
  agent,
  onNavigateToRun,
  onOpenEval,
  className,
}: AgentQualityReportViewProps) {
  const agentId = agent.metadata?.id ?? "";
  const [days, setDays] = useState<QualityWindow>(DEFAULT_QUALITY_WINDOW);
  const { isLoading: orgLoading } = useOrg();
  const org = useActiveOrgId();
  const { report, isLoading, error, refetch } = useAgentQualityReport(agentId, days);
  const { versions } = useAgentVersions(
    agent.metadata?.org ?? null,
    agent.metadata?.slug ?? null,
  );
  const labelOf: VersionLabeller = (hash) =>
    hash === "" ? "unversioned" : agentVersionLabel(versions, hash);

  let body: ReactNode;
  if (orgLoading || isLoading) {
    body = (
      <LoadingRegion
        label="Loading how this agent's runs went"
        className="stg:grid stg:grid-cols-1 stg:gap-3 stg:sm:grid-cols-2"
      >
        {[0, 1, 2, 3].map((slot) => (
          <div
            key={slot}
            className="stg:h-36 stg:animate-pulse stg:rounded-lg stg:bg-muted"
          />
        ))}
      </LoadingRegion>
    );
  } else if (org === "") {
    body = (
      <p className="stg:text-sm stg:text-muted-foreground">
        Pick an organization to see how this agent&apos;s runs went in it.
      </p>
    );
  } else if (error !== null) {
    body = <ErrorMessage error={error} retry={refetch} />;
  } else if (report === null || (report.total?.runs ?? 0) === 0) {
    body = (
      <p className="stg:text-sm stg:text-muted-foreground">
        No graded runs in the last {days} days.
      </p>
    );
  } else {
    body = (
      <ReportBody
        report={report}
        labelOf={labelOf}
        agentId={agentId}
        onOpenEval={onOpenEval}
      />
    );
  }

  return (
    <div className={cn("stg:flex stg:flex-col stg:gap-6", className)}>
      <Section
        title="How runs went"
        headerActions={<WindowPicker days={days} onChange={setDays} />}
      >
        {body}
      </Section>
      <FlaggedRuns
        agentId={agentId}
        days={days}
        labelOf={labelOf}
        onNavigateToRun={onNavigateToRun}
      />
      <p className="stg:text-xs stg:text-muted-foreground">
        Days are UTC. The numbers count everyone&apos;s runs of this agent in
        this organization and show no conversation text; the flagged list
        shows only runs you can open.
      </p>
    </div>
  );
}

function WindowPicker({
  days,
  onChange,
}: {
  readonly days: QualityWindow;
  readonly onChange: (days: QualityWindow) => void;
}) {
  return (
    <div role="group" aria-label="Days shown" className="stg:flex stg:gap-1.5">
      {QUALITY_WINDOWS.map((window) => (
        <button
          key={window}
          type="button"
          aria-pressed={window === days}
          onClick={() => onChange(window)}
          className={cn(
            "stg:rounded-md stg:px-2.5 stg:py-1 stg:text-xs stg:font-medium stg:transition-colors",
            window === days
              ? "stg:bg-primary stg:text-primary-foreground"
              : "stg:bg-muted stg:text-muted-foreground stg:hover:bg-accent stg:hover:text-foreground",
          )}
        >
          {window} days
        </button>
      ))}
    </div>
  );
}

function ReportBody({
  report,
  labelOf,
  agentId,
  onOpenEval,
}: {
  readonly report: AgentQualityReport;
  readonly labelOf: VersionLabeller;
  readonly agentId: string;
  readonly onOpenEval?: (evalId: string) => void;
}) {
  const total = report.total;
  const healthVersion = currentEvaluatorVersionOf(total, RUN_HEALTH_METRIC);
  const judgeVersion = currentEvaluatorVersionOf(total, JUDGE_METRIC);
  const rubrics =
    judgeVersion === null ? [] : criterionNamesOf(total, JUDGE_METRIC, judgeVersion);
  const thumbs = metricTallyOf(total, FEEDBACK_METRIC);
  const markers: readonly TrendMarker[] = versionChangesOf(report).map((change) => ({
    date: change.date,
    label: `agent version ${labelOf(change.agentVersionHash)} first seen`,
  }));
  const chartProps = {
    markers,
    from: report.fromDate,
    to: report.toDate,
    max: 1,
    formatValue: formatPercent,
    formatCount: (count: number) => `${count} ${count === 1 ? "run" : "runs"}`,
  };

  return (
    <div className="stg:flex stg:flex-col stg:gap-4">
      <div className="stg:grid stg:grid-cols-1 stg:gap-3 stg:sm:grid-cols-2">
        <Tile
          title="Runs graded"
          value={String(total?.runs ?? 0)}
          detail={`${report.fromDate} to ${report.toDate}`}
        >
          <TrendChart
            {...chartProps}
            label="Runs graded per day"
            points={dailyRunsSeries(report)}
            max={undefined}
            formatValue={(runs) => String(Math.round(runs))}
          />
        </Tile>
        {healthVersion !== null && (
          <RateTile
            title="Run health"
            rate={metricRateOf(total, RUN_HEALTH_METRIC, healthVersion)}
            countWord="checked"
          >
            <TrendChart
              {...chartProps}
              label="Run health, daily pass rate"
              points={dailyRateSeries(report, RUN_HEALTH_METRIC, healthVersion)}
            />
          </RateTile>
        )}
        {judgeVersion !== null &&
          rubrics.map((rubric) => (
            <RateTile
              key={rubric}
              title={`AI judge: ${rubric}`}
              rate={criterionRateOf(total, JUDGE_METRIC, judgeVersion, rubric)}
              countWord="graded"
            >
              <TrendChart
                {...chartProps}
                label={`AI judge, ${rubric}, daily pass rate`}
                points={dailyRateSeries(report, JUDGE_METRIC, judgeVersion, rubric)}
              />
            </RateTile>
          ))}
        {thumbs !== null && (
          <Tile
            title="Thumbs"
            value={`${thumbs.passed} up · ${thumbs.failed} down`}
            detail={`${thumbs.passed + thumbs.failed} rated`}
          >
            <TrendChart
              {...chartProps}
              label="Thumbs up, daily share"
              points={dailyRateSeries(report, FEEDBACK_METRIC, thumbs.evaluatorVersion)}
            />
          </Tile>
        )}
      </div>
      {evaluatorChangedIn(total, JUDGE_METRIC) && (
        <p className="stg:text-xs stg:text-muted-foreground">
          The AI judge&apos;s rules changed in these days. Its rates count only
          grades under the current rules; a break in its trend is a day graded
          only under the earlier ones.
        </p>
      )}
      <VersionTable
        report={report}
        labelOf={labelOf}
        agentId={agentId}
        healthVersion={healthVersion}
        judgeVersion={judgeVersion}
        rubrics={rubrics}
        onOpenEval={onOpenEval}
      />
    </div>
  );
}

function Tile({
  title,
  value,
  detail,
  children,
}: {
  readonly title: string;
  readonly value: string;
  readonly detail: string;
  readonly children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="stg:flex stg:flex-col stg:gap-2 stg:rounded-lg stg:border stg:border-border stg:p-3"
    >
      <div className="stg:flex stg:flex-col stg:gap-0.5">
        <h4 className="stg:text-xs stg:font-medium stg:text-muted-foreground">
          {title}
        </h4>
        <p className="stg:text-lg stg:font-semibold stg:tabular-nums stg:text-foreground">
          {value}
        </p>
        <p className="stg:text-xs stg:text-muted-foreground">{detail}</p>
      </div>
      {children}
    </section>
  );
}

function RateTile({
  title,
  rate,
  countWord,
  children,
}: {
  readonly title: string;
  readonly rate: PassRate | null;
  readonly countWord: string;
  readonly children: ReactNode;
}) {
  return (
    <Tile
      title={title}
      value={rate === null ? "—" : `${formatPercent(rate.rate)} passed`}
      detail={
        rate === null
          ? `No run ${countWord}`
          : `of ${rate.count} ${rate.count === 1 ? "run" : "runs"} ${countWord}`
      }
    >
      {children}
    </Tile>
  );
}

function VersionTable({
  report,
  labelOf,
  agentId,
  healthVersion,
  judgeVersion,
  rubrics,
  onOpenEval,
}: {
  readonly report: AgentQualityReport;
  readonly labelOf: VersionLabeller;
  readonly agentId: string;
  readonly healthVersion: string | null;
  readonly judgeVersion: string | null;
  readonly rubrics: readonly string[];
  readonly onOpenEval?: (evalId: string) => void;
}) {
  const { evals } = useAgentEvals(agentId);
  const latestEval = latestFinishedEvalByVersion(evals);
  return (
    <div className="stg:overflow-x-auto">
      <table className="stg:w-full stg:text-xs">
        <caption className="stg:pb-1 stg:text-left stg:text-xs stg:font-medium stg:text-muted-foreground">
          By agent version
        </caption>
        <thead>
          <tr className="stg:border-b stg:border-border stg:text-left stg:text-muted-foreground">
            <th scope="col" className={CELL_CLASS}>Version</th>
            <th scope="col" className={CELL_CLASS}>Seen</th>
            <th scope="col" className={CELL_CLASS}>Runs</th>
            <th scope="col" className={CELL_CLASS}>Run health</th>
            {rubrics.map((rubric) => (
              <th key={rubric} scope="col" className={CELL_CLASS}>
                AI judge: {rubric}
              </th>
            ))}
            <th scope="col" className={CELL_CLASS}>Thumbs</th>
            <th scope="col" className={CELL_CLASS}>Latest eval</th>
          </tr>
        </thead>
        <tbody>
          {report.versions.map((version) => {
            const summary = version.summary;
            const thumbs = metricTallyOf(summary, FEEDBACK_METRIC);
            const agentEval = latestEval.get(version.agentVersionHash);
            const evalRate = agentEval === undefined ? null : evalPassRateOf(agentEval);
            const evalId = agentEval?.metadata?.id ?? "";
            return (
              <tr
                key={version.agentVersionHash}
                className="stg:border-b stg:border-border stg:text-foreground stg:last:border-b-0"
              >
                <th scope="row" className={cn(CELL_CLASS, "stg:text-left stg:font-mono stg:font-medium")}>
                  {labelOf(version.agentVersionHash)}
                </th>
                <td className={cn(CELL_CLASS, "stg:tabular-nums stg:text-muted-foreground")}>
                  {version.firstDate === version.lastDate
                    ? version.firstDate
                    : `${version.firstDate} to ${version.lastDate}`}
                </td>
                <td className={cn(CELL_CLASS, "stg:tabular-nums")}>{summary?.runs ?? 0}</td>
                <td className={cn(CELL_CLASS, "stg:tabular-nums")}>
                  {healthVersion === null
                    ? "—"
                    : formatPassRate(metricRateOf(summary, RUN_HEALTH_METRIC, healthVersion))}
                </td>
                {rubrics.map((rubric) => (
                  <td key={rubric} className={cn(CELL_CLASS, "stg:tabular-nums")}>
                    {judgeVersion === null
                      ? "—"
                      : formatPassRate(
                          criterionRateOf(summary, JUDGE_METRIC, judgeVersion, rubric),
                        )}
                  </td>
                ))}
                <td className={cn(CELL_CLASS, "stg:tabular-nums")}>
                  {thumbs === null ? "—" : `${thumbs.passed} up · ${thumbs.failed} down`}
                </td>
                <td className={cn(CELL_CLASS, "stg:tabular-nums")}>
                  {agentEval === undefined ? (
                    <span className="stg:text-muted-foreground">no eval</span>
                  ) : onOpenEval !== undefined && evalId !== "" ? (
                    <button
                      type="button"
                      onClick={() => onOpenEval(evalId)}
                      className="stg:text-primary stg:underline-offset-2 stg:hover:underline stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring"
                    >
                      {evalCellText(evalRate)}
                    </button>
                  ) : (
                    evalCellText(evalRate)
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function evalCellText(rate: PassRate | null): string {
  return rate === null
    ? "no case graded"
    : `${formatPercent(rate.rate)} of ${rate.count} ${rate.count === 1 ? "case" : "cases"}`;
}

function FlaggedRuns({
  agentId,
  days,
  labelOf,
  onNavigateToRun,
}: {
  readonly agentId: string;
  readonly days: QualityWindow;
  readonly labelOf: VersionLabeller;
  readonly onNavigateToRun?: (runId: string) => void;
}) {
  const {
    items,
    isLoading,
    error,
    hasMore,
    loadMore,
    isLoadingMore,
    loadMoreError,
    refetch,
  } = useFlaggedRuns(agentId, days);

  let body: ReactNode;
  if (isLoading) {
    body = (
      <LoadingRegion label="Loading flagged runs" className="stg:flex stg:flex-col stg:gap-2">
        {[0, 1, 2].map((slot) => (
          <div key={slot} className="stg:h-6 stg:animate-pulse stg:rounded stg:bg-muted" />
        ))}
      </LoadingRegion>
    );
  } else if (error !== null) {
    body = <ErrorMessage error={error} retry={refetch} />;
  } else {
    body = (
      <div className="stg:flex stg:flex-col stg:gap-2">
        {items.length === 0 && !hasMore ? (
          <p className="stg:text-sm stg:text-muted-foreground">
            No flagged runs in the last {days} days.
          </p>
        ) : (
          <ul
            aria-label="Flagged runs"
            className={cn(UNSTYLED_LIST, "stg:flex stg:flex-col stg:divide-y stg:divide-border")}
          >
            {items.map((score) => (
              <FlaggedRow
                key={score.metadata?.id ?? ""}
                score={score}
                labelOf={labelOf}
                onNavigateToRun={onNavigateToRun}
              />
            ))}
          </ul>
        )}
        {loadMoreError !== null && (
          <p role="alert" className="stg:text-xs stg:text-destructive">
            Could not read more flagged runs: {loadMoreError.message}
          </p>
        )}
        {hasMore && (
          <div>
            <button
              type="button"
              onClick={loadMore}
              disabled={isLoadingMore}
              className={QUIET_BUTTON_CLASS}
            >
              {isLoadingMore ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </div>
    );
  }

  return <Section title="Flagged runs">{body}</Section>;
}

function FlaggedRow({
  score,
  labelOf,
  onNavigateToRun,
}: {
  readonly score: Score;
  readonly labelOf: VersionLabeller;
  readonly onNavigateToRun?: (runId: string) => void;
}) {
  const created = score.status?.audit?.specAudit?.createdAt;
  const at = created === undefined ? null : timestampDate(created);
  const runId = score.spec?.runId ?? "";
  const metric = score.spec?.metric ?? "";
  const what = flaggedWhatOf(score);
  const label = metricLabelOf(metric);
  // A thumbs down, or a grade with no failed criterion named, reads alone.
  const failed =
    metric === FEEDBACK_METRIC || what === label ? what : `${label}: ${what}`;
  return (
    <li className="stg:flex stg:flex-wrap stg:items-baseline stg:gap-x-3 stg:gap-y-0.5 stg:py-1.5 stg:text-xs">
      {at === null ? (
        <span className="stg:text-muted-foreground">—</span>
      ) : (
        <time dateTime={at.toISOString()} className="stg:tabular-nums stg:text-muted-foreground">
          {at.toLocaleString()}
        </time>
      )}
      <span className="stg:font-mono stg:text-muted-foreground">
        {labelOf(score.status?.agentVersionHash ?? "")}
      </span>
      <span className="stg:text-foreground">{failed}</span>
      {onNavigateToRun !== undefined && runId !== "" && (
        <button
          type="button"
          aria-label={`Open run: ${failed}${at === null ? "" : `, ${at.toLocaleString()}`}`}
          onClick={() => onNavigateToRun(runId)}
          className="stg:ml-auto stg:text-primary stg:underline-offset-2 stg:hover:underline stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring"
        >
          Open run
        </button>
      )}
    </li>
  );
}

const CELL_CLASS = "stg:px-2 stg:py-1.5 stg:whitespace-nowrap";
