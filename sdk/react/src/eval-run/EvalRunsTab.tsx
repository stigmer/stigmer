"use client";

/**
 * The Evals tab of an agent or of a plugin: test cases run on the agent,
 * or a plugin's own cases run on the built-in assistant, with and without
 * a plugin, and what came of each eval run.
 *
 * Top to bottom. On a plugin: the suite as install read it (cases, tags,
 * findings, each shown by its message, which already starts with its
 * file's path, and the cases Stigmer does not run yet, the feature named).
 * On an agent: what an eval run on the agent is, and that a plugin's cases
 * were written for the plugin, so a case can fail because the agent was
 * told to do something else and the case filters leave such a case out;
 * for an agent that attaches no plugins, that its cases live in plugins,
 * and a way to its plugins. Then the Run evals form, for editors only:
 * each case's own model (on an agent, the agent as it runs) or the models
 * picked, tries per case, the cost limit, tries at once, and the
 * comparison: on a plugin, whether each case also runs without it; on an
 * agent, a plugin to compare (attached or not, among the organization's
 * plugins), whether each case also runs without it, whose cases run (the
 * compared plugin's when one is picked, else every attached one's), the
 * case filters and the tools every try may use beyond its case's own,
 * since a try gets only those. Then the past eval runs, newest first, each
 * labelled by the plugin, or by the agent version and the plugin it
 * compared, and when it started, listed again while any of them runs (a
 * read again that fails keeps the last list with a small notice; only a
 * first read that fails shows the error alone); the eval run opened
 * ({@link EvalRunResults}); and Compare, which puts two eval runs side by
 * side plugin by plugin and case by case, how a new version is judged
 * against the last, marks a plugin whose version differs between them, and
 * shows a read that failed rather than loading forever.
 *
 * The form and an eval run's Cancel are gated on `can_edit` on the agent
 * or plugin, failing closed: they show only once the check answers yes,
 * never while it is in flight or after it failed, so a viewer is never
 * offered a control the server would refuse. The organization of the
 * agent or plugin pays for every try.
 *
 * All visual properties flow through `--stgm-*` tokens.
 */

import { useId, useState } from "react";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { EvalRun } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/api_pb";
import { EvalRunPhase } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/status_pb";
import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import type { PluginEvalSuite } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import { cn } from "@stigmer/theme";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { useCheckPermission } from "../grant/useCheckPermission.js";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
import { LoadMoreFooter } from "../internal/LoadMoreFooter.js";
import { usePluginList } from "../plugin/usePluginList.js";
import { Section } from "../resource-detail/Section.js";
import { Switch } from "../switch/Switch.js";
import {
  INPUT_CLASS,
  PRIMARY_BUTTON_CLASS,
  QUIET_BUTTON_CLASS,
} from "../vault/styles.js";
import {
  DEFAULT_EVAL_FORM,
  MAX_EVAL_CONCURRENCY,
  MAX_EVAL_COST_USD,
  MAX_EVAL_RUNS,
  evalFormForAgent,
  compareEvalRuns,
  evalFormProblem,
  evalRunInputOf,
  evalRunLabelOf,
  evalRunVersionOf,
  formatDelta,
  formatScore,
  formatUsd,
  isAboutAgent,
  isComparing,
  parseAllowTools,
  parseCaseTags,
  phaseLabel,
  shortDigest,
  shortVersion,
  type EvalFormSettings,
  type EvalRunCompareSection,
  type EvalSubjectRef,
} from "./eval-view.js";
import {
  EvalModelsField,
  HINT_CLASS,
  LABEL_CLASS,
  NumberField,
} from "./EvalFormFields.js";
import { EvalRunResults } from "./EvalRunResults.js";
import { useEvalRun } from "./useEvalRun.js";
import { useEvalRuns } from "./useEvalRuns.js";
import { useStartEvalRun } from "./useStartEvalRun.js";

/** The most of the organization's plugins the compare picker lists. */
const COMPARE_PICKER_PAGE = 100;

/** Props for {@link EvalRunsTab}: an agent's tab, or a plugin's. */
export type EvalRunsTabProps = (
  | {
      /** The agent whose eval runs the tab shows and runs. */
      readonly agent: Agent;
      readonly plugin?: undefined;
    }
  | {
      /** The installed plugin whose eval runs the tab shows and runs. */
      readonly plugin: Plugin;
      readonly agent?: undefined;
    }
) & {
  /**
   * Called with a try's run id when the person opens it; the host owns the
   * route. Tries are listed without links when omitted.
   */
  readonly onNavigateToRun?: (runId: string) => void;
  /**
   * On an agent: opens its plugins, where one is attached, offered when it
   * attaches none. `AgentDetailView` opens its Overview tab.
   */
  readonly onOpenPlugins?: () => void;
  /**
   * The eval run opened when the tab mounts, as when the Quality tab's
   * version table links one; the newest when omitted.
   */
  readonly initialEvalRunId?: string;
  /** Additional CSS class names for the root element. */
  readonly className?: string;
};

/**
 * The Evals tab of an agent or a plugin: what runs, Run evals for editors,
 * past eval runs with their results, and Compare.
 *
 * @example
 * ```tsx
 * <EvalRunsTab agent={agent} onNavigateToRun={(runId) => router.push(`/runs/${runId}`)} />
 * <EvalRunsTab plugin={plugin} onNavigateToRun={(runId) => router.push(`/runs/${runId}`)} />
 * ```
 */
export function EvalRunsTab(props: EvalRunsTabProps) {
  const { onNavigateToRun, onOpenPlugins, initialEvalRunId, className } = props;
  const meta = props.agent !== undefined ? props.agent.metadata : props.plugin.metadata;
  const kind = props.agent !== undefined ? "agent" : "plugin";
  const id = meta?.id ?? "";
  const subject: EvalSubjectRef = { kind, id, org: meta?.org ?? "" };
  const slug = meta?.slug || meta?.name || "";
  // A plugin deleted since it was attached comes back with no slug, and no
  // eval run can select it.
  const attached =
    props.agent === undefined
      ? []
      : (props.agent.spec?.plugins ?? [])
          .map((ref) => ref.slug)
          .filter((each) => each !== "");
  const suite = props.plugin?.status?.evals;
  const { allowed: canEdit } = useCheckPermission(
    id ? { kind, id } : null,
    "can_edit",
    { fail: "closed" },
  );
  const {
    evalRuns,
    isLoading,
    error,
    refetch,
    hasMore,
    loadMore,
    isLoadingMore,
    loadMoreError,
  } = useEvalRuns(kind === "agent" ? { agentId: id } : { pluginId: id });
  const [selected, setSelected] = useState<string | null>(
    initialEvalRunId ?? null,
  );
  const shown = selected ?? evalRuns[0]?.metadata?.id ?? null;
  const onStarted = (started: EvalRun): void => {
    setSelected(started.metadata?.id ?? null);
    refetch();
  };
  const canRun =
    canEdit &&
    id !== "" &&
    (kind === "agent" || (suite !== undefined && suite.caseCount > 0));

  return (
    <div className={cn("stg:flex stg:flex-col stg:gap-6", className)}>
      {kind === "plugin" ? (
        <SuiteSummary suite={suite} />
      ) : (
        <AboutEvalRunsOnAgent attached={attached} onOpenPlugins={onOpenPlugins} />
      )}
      {canRun && (
        <RunEvalsForm subject={subject} attached={attached} onStarted={onStarted} />
      )}
      <Section
        title="Past eval runs"
        count={evalRuns.length}
        countIsLowerBound={hasMore}
      >
        {isLoading ? (
          <p className="stg:px-3 stg:py-2.5 stg:text-xs stg:text-muted-foreground">
            Loading eval runs…
          </p>
        ) : evalRuns.length > 0 ? (
          <>
            {error !== null && (
              <p className="stg:px-3 stg:pt-2.5 stg:text-xs stg:text-warning">
                Could not refresh the eval runs ({error.message}); this is the
                last list read.
              </p>
            )}
            <EvalRunList
              evalRuns={evalRuns}
              pluginName={slug}
              selected={shown}
              onSelect={setSelected}
            />
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
            No eval runs yet.
          </p>
        )}
      </Section>
      {shown !== null && (
        <EvalRunResults
          key={shown}
          evalRunId={shown}
          subjectSlug={slug}
          canEdit={canEdit}
          onNavigateToRun={onNavigateToRun}
          onChanged={refetch}
        />
      )}
      {evalRuns.length >= 2 && (
        <CompareEvalRuns evalRuns={evalRuns} pluginName={slug} />
      )}
    </div>
  );
}

function AboutEvalRunsOnAgent({
  attached,
  onOpenPlugins,
}: {
  readonly attached: readonly string[];
  readonly onOpenPlugins?: () => void;
}) {
  return (
    <Section title="About eval runs">
      <div className="stg:flex stg:flex-col stg:gap-2 stg:px-3 stg:py-2.5 stg:text-xs stg:text-muted-foreground">
        <p>
          An eval run runs test cases on the agent itself: its instructions,
          its tools and all its plugins, each plugin&apos;s cases at the
          version the agent attaches. Compare a plugin to run each case with
          and without it, and see whether the agent does better with it.
          Every eval run is stamped with the agent version it ran, so two
          versions compare side by side.
        </p>
        <p>
          A plugin&apos;s cases were written for the plugin, not for this
          agent, so a case can fail because the agent was told to do
          something else. The case filters leave such a case out.
        </p>
        {attached.length === 0 && (
          <>
            <p className="stg:text-sm">
              This agent attaches no plugins. A case lives in a plugin&apos;s
              evals/ folder: attach a plugin that has eval cases, or compare
              one below.
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
          </>
        )}
      </div>
    </Section>
  );
}

function SuiteSummary({
  suite,
}: {
  readonly suite: PluginEvalSuite | undefined;
}) {
  if (
    suite === undefined ||
    (suite.caseCount === 0 && suite.findings.length === 0)
  ) {
    return (
      <Section title="Test cases">
        <p className="stg:px-3 stg:py-2.5 stg:text-sm stg:text-muted-foreground">
          This plugin has no evals/ cases. Add test cases to the plugin&apos;s
          evals/ folder in Claude Code&apos;s plugin-eval format and push it
          again.
        </p>
      </Section>
    );
  }
  const unsupported = suite.cases.filter(
    (evalCase) => evalCase.unsupported !== "",
  );
  return (
    <Section title="Test cases" count={suite.caseCount}>
      <div className="stg:flex stg:flex-col stg:gap-2 stg:px-3 stg:py-2.5 stg:text-sm">
        <p className="stg:text-muted-foreground">
          {suite.caseCount} {suite.caseCount === 1 ? "case" : "cases"} in{" "}
          <span className="stg:font-mono stg:text-xs">{suite.dir}/</span>
          {suite.caseTags.length > 0 && (
            <> · tags: {suite.caseTags.join(", ")}</>
          )}
        </p>
        {unsupported.length > 0 && (
          <ul
            className={cn(UNSTYLED_LIST, "stg:flex stg:flex-col stg:gap-0.5")}
            aria-label="Cases not run yet"
          >
            {unsupported.map((evalCase) => (
              <li
                key={evalCase.path}
                className="stg:text-xs stg:text-muted-foreground"
              >
                <span className="stg:font-medium stg:text-foreground">
                  {evalCase.caseName}
                </span>
                : not run yet: {evalCase.unsupported}
              </li>
            ))}
          </ul>
        )}
        {suite.findings.length > 0 && (
          <ul
            className={cn(UNSTYLED_LIST, "stg:flex stg:flex-col stg:gap-0.5")}
            aria-label="Problems reading the cases"
          >
            {suite.findings.map((finding, index) => (
              <li
                key={`${finding.path}:${index}`}
                className="stg:text-xs stg:text-warning"
              >
                {finding.message}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}

function RunEvalsForm({
  subject,
  attached,
  onStarted,
}: {
  readonly subject: EvalSubjectRef;
  /** On an agent, the slugs of the plugins it attaches. */
  readonly attached: readonly string[];
  readonly onStarted: (started: EvalRun) => void;
}) {
  const baseId = useId();
  const onAgent = subject.kind === "agent";
  const { start, isStarting, error } = useStartEvalRun();
  const { plugins: orgPlugins } = usePluginList(onAgent ? subject.org : null, {
    pageSize: COMPARE_PICKER_PAGE,
  });
  const [settings, setSettings] = useState<EvalFormSettings>(() =>
    onAgent ? evalFormForAgent(attached) : DEFAULT_EVAL_FORM,
  );
  const [costText, setCostText] = useState(String(settings.maxCostUsd));
  // Empty is each case's own runs, sent as 0.
  const [runsText, setRunsText] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [toolsText, setToolsText] = useState("");
  const comparedSlug =
    orgPlugins.find((plugin) => plugin.id === settings.comparedPluginId)
      ?.slug ?? "";
  const defaultCaseSources =
    comparedSlug === "" ? attached : [comparedSlug];
  const sourceChoices = [
    ...attached,
    ...(comparedSlug === "" || attached.includes(comparedSlug)
      ? []
      : [comparedSlug]),
  ];
  const draft: EvalFormSettings = {
    ...settings,
    runs: runsText.trim() === "" ? 0 : Number(runsText),
    maxCostUsd: Number(costText),
    caseTags: parseCaseTags(tagsText),
    allowTools: parseAllowTools(toolsText),
  };
  const problem = evalFormProblem(draft, subject.kind);

  const pickCompared = (pluginId: string): void => {
    const slug = orgPlugins.find((plugin) => plugin.id === pluginId)?.slug ?? "";
    setSettings({
      ...settings,
      comparedPluginId: pluginId,
      caseSources: slug === "" ? attached : [slug],
    });
  };

  const toggleSource = (slug: string, on: boolean): void => {
    setSettings({
      ...settings,
      caseSources: on
        ? sourceChoices.filter(
            (each) => each === slug || settings.caseSources.includes(each),
          )
        : settings.caseSources.filter((each) => each !== slug),
    });
  };

  const onRun = async (): Promise<void> => {
    try {
      onStarted(await start(evalRunInputOf(subject, draft, defaultCaseSources)));
    } catch {
      // The hook keeps the error; the form shows it below.
    }
  };

  const compareSwitch = (label: string) => (
    <div className="stg:flex stg:items-center stg:gap-2">
      <Switch
        id={`${baseId}-compare`}
        checked={settings.compare}
        onCheckedChange={(compare) => setSettings({ ...settings, compare })}
        disabled={isStarting}
      />
      <label
        htmlFor={`${baseId}-compare`}
        className="stg:text-xs stg:font-medium stg:text-foreground"
      >
        {label}
      </label>
    </div>
  );

  return (
    <Section title="Run evals">
      <div className="stg:flex stg:flex-col stg:gap-4 stg:px-3 stg:py-2.5">
        <p className="stg:text-xs stg:text-muted-foreground">
          {onAgent
            ? "Every case runs on the agent as it runs, or on each model you pick, on the agent's current version."
            : "Every case runs on its own model, or on each model you pick, with the plugin and without it."}{" "}
          Every try is a real conversation, charged to this organization; the
          cost limit stops new tries once it is reached.
        </p>
        <EvalModelsField
          id={`${baseId}-models`}
          switchLabel={
            onAgent
              ? "Run the agent as it runs, on its own engine and model"
              : "Use each case's own model"
          }
          settings={settings}
          disabled={isStarting}
          onChange={setSettings}
        />
        {onAgent && (
          <div className="stg:flex stg:flex-col stg:gap-1">
            <label htmlFor={`${baseId}-compared`} className={LABEL_CLASS}>
              Compare with a plugin
            </label>
            <select
              id={`${baseId}-compared`}
              value={settings.comparedPluginId}
              disabled={isStarting}
              onChange={(event) => pickCompared(event.target.value)}
              className={INPUT_CLASS}
            >
              <option value="">No comparison</option>
              {orgPlugins.map((plugin) => (
                <option key={plugin.id} value={plugin.id}>
                  {plugin.slug || plugin.name}
                  {attached.includes(plugin.slug) ? " (attached)" : ""}
                </option>
              ))}
            </select>
            <p className={HINT_CLASS}>
              Each case runs on the agent with this plugin and without it,
              whether the agent attaches it or not, so you see the difference
              it makes.
            </p>
          </div>
        )}
        {onAgent && settings.comparedPluginId !== "" &&
          compareSwitch("Also run each case without the plugin")}
        {onAgent && (
          <fieldset className="stg:flex stg:flex-col stg:gap-1">
            <legend className={LABEL_CLASS}>Whose cases run</legend>
            {sourceChoices.length === 0 ? (
              <p className={HINT_CLASS}>
                Attach a plugin, or compare one, to run its cases.
              </p>
            ) : (
              <div className="stg:flex stg:flex-wrap stg:gap-x-4 stg:gap-y-1">
                {sourceChoices.map((slug) => (
                  <label
                    key={slug}
                    className="stg:inline-flex stg:cursor-pointer stg:items-center stg:gap-2 stg:text-xs stg:text-foreground"
                  >
                    <input
                      type="checkbox"
                      checked={settings.caseSources.includes(slug)}
                      disabled={isStarting}
                      onChange={(event) =>
                        toggleSource(slug, event.target.checked)
                      }
                    />
                    {slug}
                  </label>
                ))}
              </div>
            )}
            <p className={HINT_CLASS}>
              The compared plugin&apos;s cases when you compare one, else
              every plugin the agent attaches, unless you clear some.
            </p>
          </fieldset>
        )}
        {onAgent && (
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
        )}
        <div className="stg:grid stg:grid-cols-1 stg:gap-4 stg:sm:grid-cols-3">
          <NumberField
            id={`${baseId}-runs`}
            label="Tries per case"
            hint={`1 to ${MAX_EVAL_RUNS}, with and without the plugin each when compared; empty for each case's own, else 3.`}
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
        {!onAgent &&
          compareSwitch(
            "Also run each case without the plugin, to see the difference it makes",
          )}
        {onAgent && (
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
              A try gets only the tools its case and this list grant, within
              the agent&apos;s own tool lists, so name the agent&apos;s
              working tools here: Skill for its skills, Agent for its
              hand-offs to subagents. One per line or comma-separated, in
              Claude Code&apos;s names, as in Bash(npm test *) or
              mcp__&lt;server&gt;__*.
            </p>
          </div>
        )}
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

function EvalRunList({
  evalRuns,
  pluginName,
  selected,
  onSelect,
}: {
  readonly evalRuns: readonly EvalRun[];
  readonly pluginName: string;
  readonly selected: string | null;
  readonly onSelect: (id: string) => void;
}) {
  return (
    <ul
      className={cn(
        UNSTYLED_LIST,
        "stg:flex stg:flex-col stg:divide-y stg:divide-border",
      )}
      aria-label="Past eval runs"
    >
      {evalRuns.map((evalRun) => {
        const id = evalRun.metadata?.id ?? "";
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
              {evalRunSummary(evalRun, pluginName)}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** One line for an eval run: its label, where it is, its score, what passed, the difference when it compares, the cost. */
function evalRunSummary(evalRun: EvalRun, pluginName: string): string {
  const status = evalRun.status;
  const aggregates = status?.aggregates;
  const parts = [
    evalRunLabelOf(evalRun, pluginName),
    phaseLabel(status?.phase ?? EvalRunPhase.unspecified),
    `score ${formatScore(aggregates?.overallScore)}`,
    `${aggregates?.casesPassed ?? 0}/${aggregates?.casesTotal ?? 0} passed`,
    isComparing(evalRun) ? `Δ ${formatDelta(aggregates?.meanDelta)}` : "",
    formatUsd(status?.costUsd ?? 0),
  ];
  return parts.filter((part) => part !== "").join(" · ");
}

function CompareEvalRuns({
  evalRuns,
  pluginName,
}: {
  readonly evalRuns: readonly EvalRun[];
  readonly pluginName: string;
}) {
  const baseId = useId();
  const [beforeId, setBeforeId] = useState(evalRuns[1]?.metadata?.id ?? "");
  const [afterId, setAfterId] = useState(evalRuns[0]?.metadata?.id ?? "");
  const before = useEvalRun(beforeId);
  const after = useEvalRun(afterId);
  const failed = [
    { label: "Before", read: before },
    { label: "After", read: after },
  ].filter(({ read }) => read.evalRun === null && read.error !== null);
  const sections =
    before.evalRun !== null && after.evalRun !== null && beforeId !== afterId
      ? compareEvalRuns(before.evalRun, after.evalRun)
      : null;
  const withDelta =
    (before.evalRun !== null && isComparing(before.evalRun)) ||
    (after.evalRun !== null && isComparing(after.evalRun));
  const heading = (label: string, evalRun: EvalRun | null): string =>
    evalRun !== null && isAboutAgent(evalRun)
      ? `${label} (version ${shortVersion(evalRunVersionOf(evalRun))})`
      : label;

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
        {evalRuns.map((evalRun) => (
          <option key={evalRun.metadata?.id} value={evalRun.metadata?.id ?? ""}>
            {evalRunSummary(evalRun, pluginName)}
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
            Pick two different eval runs.
          </p>
        ) : failed.length > 0 ? (
          <div className="stg:flex stg:flex-col stg:gap-2">
            {failed.map(({ label, read }) => (
              <ErrorMessage
                key={label}
                error={read.error}
                title={`Could not read the ${label} eval run`}
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
            Neither eval run ran a plugin&apos;s cases.
          </p>
        ) : (
          sections.map((section) => (
            <CompareSectionView
              key={section.slug}
              section={section}
              beforeHeading={heading("Before", before.evalRun)}
              afterHeading={heading("After", after.evalRun)}
              withDelta={withDelta}
            />
          ))
        )}
      </div>
    </Section>
  );
}

function CompareSectionView({
  section,
  beforeHeading,
  afterHeading,
  withDelta,
}: {
  readonly section: EvalRunCompareSection;
  readonly beforeHeading: string;
  readonly afterHeading: string;
  /** Show each side's difference: either eval run compares a plugin. */
  readonly withDelta: boolean;
}) {
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
                {withDelta && (
                  <>
                    <th scope="col" className={CELL_CLASS}>
                      Δ before
                    </th>
                    <th scope="col" className={CELL_CLASS}>
                      Δ after
                    </th>
                  </>
                )}
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
                    {row.after === null ? "not run" : formatScore(row.after.score)}
                  </td>
                  {withDelta && (
                    <>
                      <td className={CELL_CLASS}>
                        {row.before === null ? "—" : formatDelta(row.before.delta)}
                      </td>
                      <td className={CELL_CLASS}>
                        {row.after === null ? "—" : formatDelta(row.after.delta)}
                      </td>
                    </>
                  )}
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
