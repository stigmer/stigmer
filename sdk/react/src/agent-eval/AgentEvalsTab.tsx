"use client";

/**
 * An agent's Evals tab: the eval cases of the plugins the agent attaches,
 * run on the agent itself, and what came of each run of them.
 *
 * Top to bottom: what an agent eval is, and that a plugin's cases were
 * written for the plugin, so a case can fail because the agent was told to
 * do something else and the case filters leave such a case out; for an
 * agent that attaches no plugins, why there is nothing to run (the cases
 * live in plugins) and a way to its plugins; the Run evals form, for the
 * agent's editors only (the agent as it runs or the models picked, tries
 * per case, which plugins, the case filters, the cost limit, tries at
 * once, and the tools every try may use beyond its case's own, since a try
 * gets only those); the past evals, newest first, each labelled by the
 * agent version it ran and when it started, with its score, listed again
 * while any runs; the eval opened ({@link AgentEvalResults}); and Compare,
 * which puts two evals side by side plugin by plugin and case by case,
 * labelled with both agent versions, and marks a plugin whose version
 * differs between them.
 *
 * The form and an eval's Cancel are gated on `can_edit` on the agent,
 * failing closed, as the plugin's Evals tab gates them on the plugin: they
 * show only once the check answers yes, never while it is in flight or
 * after it failed. The agent's organization pays for every try.
 *
 * All visual properties flow through `--stgm-*` tokens.
 */

import { useId, useState } from "react";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { AgentEval } from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/api_pb";
import { PluginEvalPhase } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
import { cn } from "@stigmer/theme";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { useCheckPermission } from "../grant/useCheckPermission.js";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
import { Section } from "../resource-detail/Section.js";
import {
  INPUT_CLASS,
  PRIMARY_BUTTON_CLASS,
  QUIET_BUTTON_CLASS,
} from "../vault/styles.js";
import {
  HINT_CLASS,
  LABEL_CLASS,
  EvalModelsField,
  NumberField,
} from "../plugin-eval/EvalFormFields.js";
import {
  MAX_EVAL_CONCURRENCY,
  MAX_EVAL_COST_USD,
  MAX_EVAL_RUNS,
  formatScore,
  formatUsd,
  parseAllowTools,
  phaseLabel,
} from "../plugin-eval/eval-view.js";
import {
  agentEvalFormProblem,
  agentEvalInputOf,
  agentEvalLabelOf,
  agentEvalVersionOf,
  compareAgentEvals,
  defaultAgentEvalForm,
  parseCaseTags,
  shortDigest,
  shortVersion,
  type AgentEvalCompareSection,
  type AgentEvalFormSettings,
} from "./agent-eval-view.js";
import { AgentEvalResults } from "./AgentEvalResults.js";
import { useAgentEval } from "./useAgentEval.js";
import { useAgentEvals } from "./useAgentEvals.js";
import { useStartAgentEval } from "./useStartAgentEval.js";
import { LoadMoreFooter } from "../internal/LoadMoreFooter.js";

/** Props for {@link AgentEvalsTab}. */
export interface AgentEvalsTabProps {
  /** The agent whose evals the tab shows and runs. */
  readonly agent: Agent;
  /**
   * Called with a try's run id when the person opens it; the host owns the
   * route. Tries are listed without links when omitted.
   */
  readonly onNavigateToRun?: (runId: string) => void;
  /**
   * Opens the agent's plugins, where one is attached: offered when the
   * agent attaches none. `AgentDetailView` opens its Overview tab.
   */
  readonly onOpenPlugins?: () => void;
  /**
   * The eval opened when the tab mounts, as when the Quality tab's version
   * table links one; the newest when omitted.
   */
  readonly initialEvalId?: string;
  /** Additional CSS class names for the root element. */
  readonly className?: string;
}

/**
 * The agent page's Evals tab: what an agent eval runs, Run evals for
 * editors, past evals with their results, and Compare.
 *
 * @example
 * ```tsx
 * <AgentEvalsTab agent={agent} onNavigateToRun={(runId) => router.push(`/runs/${runId}`)} />
 * ```
 */
export function AgentEvalsTab({
  agent,
  onNavigateToRun,
  onOpenPlugins,
  initialEvalId,
  className,
}: AgentEvalsTabProps) {
  const meta = agent.metadata;
  const agentId = meta?.id ?? "";
  const agentSlug = meta?.slug ?? "";
  // A plugin deleted since it was attached comes back with no slug, and no
  // eval can select it.
  const attached = (agent.spec?.plugins ?? [])
    .map((ref) => ref.slug)
    .filter((slug) => slug !== "");
  const { allowed: canEdit } = useCheckPermission(
    agentId ? { kind: "agent", id: agentId } : null,
    "can_edit",
    { fail: "closed" },
  );
  const { evals, isLoading, error, refetch, hasMore, loadMore, isLoadingMore, loadMoreError } =
    useAgentEvals(agentId);
  const [selected, setSelected] = useState<string | null>(
    initialEvalId ?? null,
  );
  const shown = selected ?? evals[0]?.metadata?.id ?? null;

  return (
    <div className={cn("stg:flex stg:flex-col stg:gap-6", className)}>
      <Section title="About agent evals">
        <div className="stg:flex stg:flex-col stg:gap-2 stg:px-3 stg:py-2.5 stg:text-xs stg:text-muted-foreground">
          <p>
            An eval runs the eval cases of the plugins this agent attaches on
            the agent itself: its instructions, its tools and all its plugins,
            each plugin&apos;s cases at the version the agent attaches. Every
            eval is stamped with the agent version it ran, so two versions
            compare side by side.
          </p>
          <p>
            A plugin&apos;s cases were written for the plugin, not for this
            agent, so a case can fail because the agent was told to do
            something else. The case filters leave such a case out.
          </p>
        </div>
      </Section>
      {attached.length === 0 ? (
        <Section title="Test cases">
          <div className="stg:flex stg:flex-col stg:gap-2 stg:px-3 stg:py-2.5">
            <p className="stg:text-sm stg:text-muted-foreground">
              This agent attaches no plugins, so there is nothing to run: an
              eval&apos;s cases live in the plugins an agent attaches, in each
              plugin&apos;s evals/ folder. Attach a plugin that has eval cases
              to run them here.
            </p>
            {onOpenPlugins !== undefined && (
              <div>
                <button
                  type="button"
                  onClick={onOpenPlugins}
                  className={QUIET_BUTTON_CLASS}
                >
                  Go to the agent&apos;s plugins
                </button>
              </div>
            )}
          </div>
        </Section>
      ) : (
        canEdit &&
        meta !== undefined && (
          <RunEvalsForm
            agent={{ id: meta.id, org: meta.org }}
            attached={attached}
            onStarted={(started) => {
              setSelected(started.metadata?.id ?? null);
              refetch();
            }}
          />
        )
      )}
      <Section title="Past evals" count={evals.length} countIsLowerBound={hasMore}>
        {isLoading ? (
          <p className="stg:px-3 stg:py-2.5 stg:text-xs stg:text-muted-foreground">
            Loading evals…
          </p>
        ) : evals.length > 0 ? (
          <>
            {error !== null && (
              <p className="stg:px-3 stg:pt-2.5 stg:text-xs stg:text-warning">
                Could not refresh the evals ({error.message}); this is the
                last list read.
              </p>
            )}
            <EvalList evals={evals} selected={shown} onSelect={setSelected} />
            <LoadMoreFooter
              className="stg:px-3 stg:pb-2.5"
              hasMore={hasMore}
              loadMore={loadMore}
              isLoadingMore={isLoadingMore}
              loadMoreError={loadMoreError}
            />
          </>
        ) : error !== null ? (
          <div className="stg:p-3">
            <ErrorMessage error={error} retry={refetch} />
          </div>
        ) : (
          <p className="stg:px-3 stg:py-2.5 stg:text-sm stg:text-muted-foreground">
            No evals have run yet.
          </p>
        )}
      </Section>
      {shown !== null && (
        <AgentEvalResults
          key={shown}
          evalId={shown}
          agentSlug={agentSlug}
          canEdit={canEdit}
          onNavigateToRun={onNavigateToRun}
          onChanged={refetch}
        />
      )}
      {evals.length >= 2 && <CompareEvals evals={evals} />}
    </div>
  );
}

function RunEvalsForm({
  agent,
  attached,
  onStarted,
}: {
  readonly agent: { readonly id: string; readonly org: string };
  readonly attached: readonly string[];
  readonly onStarted: (started: AgentEval) => void;
}) {
  const baseId = useId();
  const { start, isStarting, error } = useStartAgentEval();
  const [settings, setSettings] = useState<AgentEvalFormSettings>(() =>
    defaultAgentEvalForm(attached),
  );
  const [costText, setCostText] = useState(String(settings.maxCostUsd));
  // Empty is each case's own runs, sent as 0.
  const [runsText, setRunsText] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [toolsText, setToolsText] = useState("");
  const draft: AgentEvalFormSettings = {
    ...settings,
    runs: runsText.trim() === "" ? 0 : Number(runsText),
    maxCostUsd: Number(costText),
    caseTags: parseCaseTags(tagsText),
    allowTools: parseAllowTools(toolsText),
  };
  const problem = agentEvalFormProblem(draft);

  const togglePlugin = (slug: string, on: boolean): void => {
    setSettings({
      ...settings,
      plugins: on
        ? attached.filter(
            (each) => each === slug || settings.plugins.includes(each),
          )
        : settings.plugins.filter((each) => each !== slug),
    });
  };

  const onRun = async (): Promise<void> => {
    try {
      onStarted(await start(agentEvalInputOf(agent, draft, attached)));
    } catch {
      // The hook keeps the error; the form shows it below.
    }
  };

  return (
    <Section title="Run evals">
      <div className="stg:flex stg:flex-col stg:gap-4 stg:px-3 stg:py-2.5">
        <p className="stg:text-xs stg:text-muted-foreground">
          Every case runs on the agent as it runs, or on each model you pick,
          on the agent&apos;s current version. Every try is a real
          conversation, charged to this organization; the cost limit stops new
          tries once it is reached.
        </p>
        <EvalModelsField
          id={`${baseId}-agent-model`}
          switchLabel="Run the agent as it runs, on its own engine and model"
          settings={settings}
          disabled={isStarting}
          onChange={setSettings}
        />
        <fieldset className="stg:flex stg:flex-col stg:gap-1">
          <legend className={LABEL_CLASS}>Plugins</legend>
          <div className="stg:flex stg:flex-wrap stg:gap-x-4 stg:gap-y-1">
            {attached.map((slug) => (
              <label
                key={slug}
                className="stg:inline-flex stg:cursor-pointer stg:items-center stg:gap-2 stg:text-xs stg:text-foreground"
              >
                <input
                  type="checkbox"
                  checked={settings.plugins.includes(slug)}
                  disabled={isStarting}
                  onChange={(event) =>
                    togglePlugin(slug, event.target.checked)
                  }
                />
                {slug}
              </label>
            ))}
          </div>
          <p className={HINT_CLASS}>
            Whose cases run; every plugin the agent attaches unless you clear
            some.
          </p>
        </fieldset>
        <div className="stg:grid stg:grid-cols-1 stg:gap-4 stg:sm:grid-cols-2">
          <TextField
            id={`${baseId}-case-glob`}
            label="Cases matching"
            hint={'Only the cases whose name matches, as in "review-*"; empty for every case.'}
            value={settings.caseGlob}
            disabled={isStarting}
            onChange={(caseGlob) => setSettings({ ...settings, caseGlob })}
          />
          <TextField
            id={`${baseId}-case-tags`}
            label="Case tags"
            hint="Only the cases carrying one of these tags, comma-separated; empty for every case."
            value={tagsText}
            disabled={isStarting}
            onChange={setTagsText}
          />
        </div>
        <div className="stg:grid stg:grid-cols-1 stg:gap-4 stg:sm:grid-cols-3">
          <NumberField
            id={`${baseId}-runs`}
            label="Tries per case"
            hint={`1 to ${MAX_EVAL_RUNS}; empty for each case's own, else 3.`}
            value={runsText}
            min={1}
            max={MAX_EVAL_RUNS}
            disabled={isStarting}
            onChange={setRunsText}
          />
          <NumberField
            id={`${baseId}-cost`}
            label="Cost limit (USD)"
            hint={`Estimated model spend, at most $${MAX_EVAL_COST_USD}.`}
            value={costText}
            min={0}
            max={MAX_EVAL_COST_USD}
            disabled={isStarting}
            onChange={setCostText}
          />
          <NumberField
            id={`${baseId}-concurrency`}
            label="Tries at once"
            hint={`1 to ${MAX_EVAL_CONCURRENCY}.`}
            value={String(settings.concurrency)}
            min={1}
            max={MAX_EVAL_CONCURRENCY}
            disabled={isStarting}
            onChange={(text) =>
              setSettings({ ...settings, concurrency: Number(text) })
            }
          />
        </div>
        <div className="stg:flex stg:flex-col stg:gap-1">
          <label htmlFor={`${baseId}-allow-tools`} className={LABEL_CLASS}>
            Allowed tools
          </label>
          <textarea
            id={`${baseId}-allow-tools`}
            rows={2}
            value={toolsText}
            onChange={(event) => setToolsText(event.target.value)}
            disabled={isStarting}
            placeholder={"Skill\nAgent"}
            className={cn(INPUT_CLASS, "stg:font-mono")}
          />
          <p className={HINT_CLASS}>
            A try gets only the tools its case and this list grant, within the
            agent&apos;s own tool lists, so name the agent&apos;s working tools
            here: Skill for its skills, Agent for its hand-offs to subagents.
            One per line or comma-separated, in Claude Code&apos;s names, as in
            Bash(npm test *) or mcp__&lt;server&gt;__*.
          </p>
        </div>
        {problem !== null && (
          <p className="stg:text-xs stg:text-destructive">{problem}</p>
        )}
        <div>
          <button
            type="button"
            disabled={problem !== null || isStarting}
            onClick={() => void onRun()}
            className={PRIMARY_BUTTON_CLASS}
          >
            {isStarting ? "Starting…" : "Run evals"}
          </button>
        </div>
        {error !== null && (
          <p role="alert" className="stg:text-xs stg:text-destructive">
            {error.message}
          </p>
        )}
      </div>
    </Section>
  );
}

function TextField({
  id,
  label,
  hint,
  value,
  disabled,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly value: string;
  readonly disabled: boolean;
  readonly onChange: (text: string) => void;
}) {
  return (
    <div className="stg:flex stg:flex-col stg:gap-1">
      <label htmlFor={id} className={LABEL_CLASS}>
        {label}
      </label>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className={INPUT_CLASS}
      />
      <p className={HINT_CLASS}>{hint}</p>
    </div>
  );
}

function EvalList({
  evals,
  selected,
  onSelect,
}: {
  readonly evals: readonly AgentEval[];
  readonly selected: string | null;
  readonly onSelect: (id: string) => void;
}) {
  return (
    <ul
      className={cn(
        UNSTYLED_LIST,
        "stg:flex stg:flex-col stg:divide-y stg:divide-border",
      )}
      aria-label="Past evals"
    >
      {evals.map((agentEval) => {
        const id = agentEval.metadata?.id ?? "";
        return (
          <li key={id}>
            <button
              type="button"
              aria-current={id === selected ? "true" : undefined}
              onClick={() => onSelect(id)}
              className={cn(
                "stg:flex stg:w-full stg:flex-wrap stg:items-center stg:gap-x-3 stg:gap-y-0.5 stg:px-3 stg:py-2 stg:text-left stg:text-xs stg:transition-colors",
                "stg:hover:bg-accent-hover stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-inset stg:focus-visible:ring-ring",
                id === selected
                  ? "stg:text-foreground stg:font-medium"
                  : "stg:text-muted-foreground",
              )}
            >
              {evalSummary(agentEval)}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** One line for an eval: its agent version and when it started, where it is, its score, what passed, the cost. */
function evalSummary(agentEval: AgentEval): string {
  const status = agentEval.status;
  const aggregates = status?.aggregates;
  const parts = [
    agentEvalLabelOf(agentEval),
    phaseLabel(status?.phase ?? PluginEvalPhase.unspecified),
    `score ${formatScore(aggregates?.overallScore)}`,
    `${aggregates?.casesPassed ?? 0}/${aggregates?.casesTotal ?? 0} passed`,
    formatUsd(status?.costUsd ?? 0),
  ];
  return parts.filter((part) => part !== "").join(" · ");
}

function CompareEvals({ evals }: { readonly evals: readonly AgentEval[] }) {
  const baseId = useId();
  const [beforeId, setBeforeId] = useState(evals[1]?.metadata?.id ?? "");
  const [afterId, setAfterId] = useState(evals[0]?.metadata?.id ?? "");
  const before = useAgentEval(beforeId);
  const after = useAgentEval(afterId);
  const failed = [
    { label: "Before", read: before },
    { label: "After", read: after },
  ].filter(({ read }) => read.agentEval === null && read.error !== null);
  const sections =
    before.agentEval !== null &&
    after.agentEval !== null &&
    beforeId !== afterId
      ? compareAgentEvals(before.agentEval, after.agentEval)
      : null;
  const beforeVersion =
    before.agentEval === null
      ? ""
      : shortVersion(agentEvalVersionOf(before.agentEval));
  const afterVersion =
    after.agentEval === null
      ? ""
      : shortVersion(agentEvalVersionOf(after.agentEval));

  const picker = (
    id: string,
    label: string,
    value: string,
    onChange: (next: string) => void,
  ) => (
    <div className="stg:flex stg:flex-col stg:gap-1">
      <label htmlFor={id} className={LABEL_CLASS}>
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={INPUT_CLASS}
      >
        {evals.map((agentEval) => (
          <option
            key={agentEval.metadata?.id}
            value={agentEval.metadata?.id ?? ""}
          >
            {evalSummary(agentEval)}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <Section title="Compare">
      <div className="stg:flex stg:flex-col stg:gap-3 stg:px-3 stg:py-2.5">
        <div className="stg:grid stg:grid-cols-1 stg:gap-3 stg:sm:grid-cols-2">
          {picker(`${baseId}-before`, "Before", beforeId, setBeforeId)}
          {picker(`${baseId}-after`, "After", afterId, setAfterId)}
        </div>
        {beforeId === afterId ? (
          <p className="stg:text-xs stg:text-muted-foreground">
            Pick two different evals.
          </p>
        ) : failed.length > 0 ? (
          <div className="stg:flex stg:flex-col stg:gap-2">
            {failed.map(({ label, read }) => (
              <ErrorMessage
                key={label}
                error={read.error}
                title={`Could not read the ${label} eval`}
                retry={read.refetch}
              />
            ))}
          </div>
        ) : sections === null ? (
          <p className="stg:text-xs stg:text-muted-foreground">
            Loading the comparison…
          </p>
        ) : sections.length === 0 ? (
          <p className="stg:text-xs stg:text-muted-foreground">
            Neither eval ran a plugin&apos;s cases.
          </p>
        ) : (
          sections.map((section) => (
            <CompareSectionView
              key={section.slug}
              section={section}
              beforeVersion={beforeVersion}
              afterVersion={afterVersion}
            />
          ))
        )}
      </div>
    </Section>
  );
}

function CompareSectionView({
  section,
  beforeVersion,
  afterVersion,
}: {
  readonly section: AgentEvalCompareSection;
  readonly beforeVersion: string;
  readonly afterVersion: string;
}) {
  const beforeHeading = `Before (version ${beforeVersion})`;
  const afterHeading = `After (version ${afterVersion})`;
  return (
    <section
      aria-label={`Compare plugin ${section.slug}`}
      data-digest-changed={section.digestChanged ? "true" : undefined}
      className="stg:flex stg:flex-col stg:gap-1.5"
    >
      <h4 className="stg:flex stg:flex-wrap stg:items-baseline stg:gap-x-2 stg:text-xs">
        <span className="stg:font-medium stg:text-foreground">
          {section.slug}
        </span>
        <span className="stg:font-mono stg:text-muted-foreground">
          {section.beforeDigest === null
            ? "not in Before"
            : shortDigest(section.beforeDigest)}
          {" → "}
          {section.afterDigest === null
            ? "not in After"
            : shortDigest(section.afterDigest)}
        </span>
        {section.digestChanged && (
          <span className="stg:font-normal stg:text-warning">
            plugin version changed: its cases may differ
          </span>
        )}
      </h4>
      {[
        { label: "Before", reason: section.beforeNotRun },
        { label: "After", reason: section.afterNotRun },
      ]
        .filter(({ reason }) => reason !== "")
        .map(({ label, reason }) => (
          <p key={label} className="stg:text-xs stg:text-muted-foreground">
            Not run in {label}: {reason}
          </p>
        ))}
      {section.rows.length > 0 && (
        <div className="stg:overflow-x-auto">
          <table className="stg:w-full stg:text-xs">
            <thead>
              <tr className="stg:border-b stg:border-border stg:text-left stg:text-muted-foreground">
                <th scope="col" className={CELL_CLASS}>
                  Case
                </th>
                <th scope="col" className={CELL_CLASS}>
                  Model
                </th>
                <th scope="col" className={CELL_CLASS}>
                  {beforeHeading}
                </th>
                <th scope="col" className={CELL_CLASS}>
                  {afterHeading}
                </th>
              </tr>
            </thead>
            <tbody>
              {section.rows.map((row) => (
                <tr
                  key={`${row.name}:${row.target}`}
                  data-changed={row.changed ? "true" : undefined}
                  className={cn(
                    "stg:border-b stg:border-border stg:last:border-b-0",
                    row.changed
                      ? "stg:bg-muted stg:font-medium stg:text-foreground"
                      : "stg:text-muted-foreground",
                  )}
                >
                  <th
                    scope="row"
                    className={cn(CELL_CLASS, "stg:text-left stg:font-medium")}
                  >
                    {row.name}
                    {row.changed && (
                      <span className="stg:ml-1 stg:text-warning">changed</span>
                    )}
                  </th>
                  <td className={cn(CELL_CLASS, "stg:font-mono")}>
                    {row.target}
                  </td>
                  <td className={CELL_CLASS}>
                    {row.before === null
                      ? "not run"
                      : formatScore(row.before.score)}
                  </td>
                  <td className={CELL_CLASS}>
                    {row.after === null
                      ? "not run"
                      : formatScore(row.after.score)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const CELL_CLASS = "stg:px-2 stg:py-1.5";
