"use client";

/**
 * A plugin's Evals tab: the plugin's own evals/ test cases, run on
 * Stigmer's engines with and without the plugin, and what came of each
 * run of them.
 *
 * Top to bottom: the suite as install read it (cases, tags, findings, and
 * the cases Stigmer does not run yet, the feature named); the Run evals
 * form, for the plugin's editors only (the models, tries per case, the
 * comparison without the plugin, the cost limit, tries at once); the past
 * evals, newest first, each opening its results; and Compare, which puts
 * two evals side by side case by case, how a new version is judged against
 * the last. The results themselves are {@link PluginEvalResults}.
 *
 * The form is gated on `can_edit` on the plugin, failing open while the
 * check is in flight because the server refuses a create from anyone else
 * anyway. The organization that installed the plugin pays for every try.
 *
 * All visual properties flow through `--stgm-*` tokens.
 */

import { useId, useState } from "react";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import type { PluginEvalSuite } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import type { PluginEval } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import { PluginEvalPhase } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
import { cn } from "@stigmer/theme";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { useCheckPermission } from "../iam-policy/useCheckPermission.js";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
import { HARNESS_OPTIONS, type HarnessOption } from "../models/harness.js";
import { ModelSelector } from "../models/ModelSelector.js";
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
  MAX_EVAL_TARGETS,
  compareEvals,
  evalFormProblem,
  formatDelta,
  formatScore,
  formatUsd,
  phaseLabel,
  pluginEvalInputOf,
  type EvalFormSettings,
} from "./eval-view.js";
import { PluginEvalResults } from "./PluginEvalResults.js";
import { usePluginEval } from "./usePluginEval.js";
import { usePluginEvals } from "./usePluginEvals.js";
import { useStartPluginEval } from "./useStartPluginEval.js";

/** Props for {@link PluginEvalsTab}. */
export interface PluginEvalsTabProps {
  /** The installed plugin whose evals the tab shows and runs. */
  readonly plugin: Plugin;
  /**
   * Called with a try's run id when the person opens it; the host owns the
   * route. Tries are listed without links when omitted.
   */
  readonly onNavigateToRun?: (runId: string) => void;
  /** Additional CSS class names for the root element. */
  readonly className?: string;
}

/**
 * The plugin page's Evals tab: the suite, Run evals for editors, past
 * evals with their results, and Compare.
 *
 * @example
 * ```tsx
 * <PluginEvalsTab plugin={plugin} onNavigateToRun={(runId) => router.push(`/runs/${runId}`)} />
 * ```
 */
export function PluginEvalsTab({
  plugin,
  onNavigateToRun,
  className,
}: PluginEvalsTabProps) {
  const meta = plugin.metadata;
  const pluginId = meta?.id ?? "";
  const suite = plugin.status?.evals;
  const { allowed: canEdit } = useCheckPermission(
    pluginId ? { kind: "plugin", id: pluginId } : null,
    "can_edit",
  );
  const { evals, isLoading, error, refetch } = usePluginEvals(pluginId);
  const [selected, setSelected] = useState<string | null>(null);
  const shown = selected ?? evals[0]?.metadata?.id ?? null;

  return (
    <div className={cn("stg:flex stg:flex-col stg:gap-6", className)}>
      <SuiteSummary suite={suite} />
      {canEdit &&
        suite !== undefined &&
        suite.caseCount > 0 &&
        meta !== undefined && (
          <RunEvalsForm
            plugin={{
              id: meta.id,
              org: meta.org,
              name: meta.name || meta.slug,
            }}
            onStarted={(started) => {
              setSelected(started.metadata?.id ?? null);
              refetch();
            }}
          />
        )}
      <Section title="Past evals" count={evals.length}>
        {isLoading ? (
          <p className="stg:px-3 stg:py-2.5 stg:text-xs stg:text-muted-foreground">
            Loading evals…
          </p>
        ) : error !== null ? (
          <div className="stg:p-3">
            <ErrorMessage error={error} retry={refetch} />
          </div>
        ) : evals.length === 0 ? (
          <p className="stg:px-3 stg:py-2.5 stg:text-sm stg:text-muted-foreground">
            No evals have run yet.
          </p>
        ) : (
          <EvalList evals={evals} selected={shown} onSelect={setSelected} />
        )}
      </Section>
      {shown !== null && (
        <PluginEvalResults
          key={shown}
          evalId={shown}
          canEdit={canEdit}
          onNavigateToRun={onNavigateToRun}
          onChanged={refetch}
        />
      )}
      {evals.length >= 2 && <CompareEvals evals={evals} />}
    </div>
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
                {finding.path !== "" && (
                  <span className="stg:ml-2 stg:font-mono">{finding.path}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}

function RunEvalsForm({
  plugin,
  onStarted,
}: {
  readonly plugin: {
    readonly id: string;
    readonly org: string;
    readonly name: string;
  };
  readonly onStarted: (started: PluginEval) => void;
}) {
  const baseId = useId();
  const { start, isStarting, error } = useStartPluginEval();
  const [settings, setSettings] = useState<EvalFormSettings>(DEFAULT_EVAL_FORM);
  const [costText, setCostText] = useState(
    String(DEFAULT_EVAL_FORM.maxCostUsd),
  );
  const draft: EvalFormSettings = { ...settings, maxCostUsd: Number(costText) };
  const problem = evalFormProblem(draft);

  const setTarget = (
    index: number,
    patch: { harness?: HarnessOption; modelName?: string },
  ): void => {
    setSettings({
      ...settings,
      targets: settings.targets.map((target, i) =>
        i === index
          ? {
              harness: patch.harness ?? target.harness,
              modelName: patch.modelName ?? target.modelName,
            }
          : target,
      ),
    });
  };

  const onRun = async (): Promise<void> => {
    try {
      onStarted(await start(pluginEvalInputOf(plugin, draft, new Date())));
    } catch {
      // The hook keeps the error; the form shows it below.
    }
  };

  return (
    <Section title="Run evals">
      <div className="stg:flex stg:flex-col stg:gap-4 stg:px-3 stg:py-2.5">
        <p className="stg:text-xs stg:text-muted-foreground">
          Every case runs on each model, with the plugin and without it. Every
          try is a real conversation, charged to this organization; the cost
          limit stops new tries once it is reached.
        </p>
        <fieldset className="stg:flex stg:flex-col stg:gap-2">
          <legend className={LABEL_CLASS}>Models</legend>
          {settings.targets.map((target, index) => (
            <div key={index} className="stg:flex stg:items-center stg:gap-2">
              <ModelSelector
                value={target.modelName === "" ? undefined : target.modelName}
                onValueChange={(modelName) => setTarget(index, { modelName })}
                initialHarness={target.harness}
                availableHarnesses={HARNESS_OPTIONS}
                onHarnessChange={(harness) =>
                  setTarget(index, { harness, modelName: "" })
                }
                compact
                disabled={isStarting}
                placeholderLabel="Default model"
              />
              {settings.targets.length > 1 && (
                <button
                  type="button"
                  aria-label={`Remove model ${index + 1}`}
                  onClick={() =>
                    setSettings({
                      ...settings,
                      targets: settings.targets.filter((_, i) => i !== index),
                    })
                  }
                  className={QUIET_BUTTON_CLASS}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
          {settings.targets.length < MAX_EVAL_TARGETS && (
            <div>
              <button
                type="button"
                onClick={() =>
                  setSettings({
                    ...settings,
                    targets: [
                      ...settings.targets,
                      { harness: "native", modelName: "" },
                    ],
                  })
                }
                className={QUIET_BUTTON_CLASS}
              >
                Add a model
              </button>
            </div>
          )}
        </fieldset>
        <div className="stg:grid stg:grid-cols-1 stg:gap-4 stg:sm:grid-cols-3">
          <NumberField
            id={`${baseId}-runs`}
            label="Tries per case"
            hint={`1 to ${MAX_EVAL_RUNS}, with and without the plugin each.`}
            value={String(settings.runs)}
            min={1}
            max={MAX_EVAL_RUNS}
            disabled={isStarting}
            onChange={(text) =>
              setSettings({ ...settings, runs: Number(text) })
            }
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
            Also run each case without the plugin, to see the difference it
            makes
          </label>
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

function NumberField({
  id,
  label,
  hint,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly value: string;
  readonly min: number;
  readonly max: number;
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
        type="number"
        min={min}
        max={max}
        step="any"
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
  readonly evals: readonly PluginEval[];
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
      {evals.map((pluginEval) => {
        const id = pluginEval.metadata?.id ?? "";
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
              {evalSummary(pluginEval)}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** One line for an eval: when, where it is, its score, what passed, the difference, the cost. */
function evalSummary(pluginEval: PluginEval): string {
  const status = pluginEval.status;
  const aggregates = status?.aggregates;
  const createdAt = status?.audit?.specAudit?.createdAt;
  const parts = [
    createdAt
      ? timestampDate(createdAt).toLocaleString()
      : (pluginEval.metadata?.name ?? ""),
    phaseLabel(status?.phase ?? PluginEvalPhase.unspecified),
    `score ${formatScore(aggregates?.overallScore)}`,
    `${aggregates?.casesPassed ?? 0}/${aggregates?.casesTotal ?? 0} passed`,
    `Δ ${formatDelta(aggregates?.meanDelta)}`,
    formatUsd(status?.costUsd ?? 0),
  ];
  return parts.filter((part) => part !== "").join(" · ");
}

function CompareEvals({ evals }: { readonly evals: readonly PluginEval[] }) {
  const baseId = useId();
  const [beforeId, setBeforeId] = useState(evals[1]?.metadata?.id ?? "");
  const [afterId, setAfterId] = useState(evals[0]?.metadata?.id ?? "");
  const before = usePluginEval(beforeId);
  const after = usePluginEval(afterId);
  const loaded = before.pluginEval !== null && after.pluginEval !== null;
  const rows =
    before.pluginEval !== null &&
    after.pluginEval !== null &&
    beforeId !== afterId
      ? compareEvals(before.pluginEval, after.pluginEval)
      : [];

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
        {evals.map((pluginEval) => (
          <option
            key={pluginEval.metadata?.id}
            value={pluginEval.metadata?.id ?? ""}
          >
            {evalSummary(pluginEval)}
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
        ) : !loaded ? (
          <p className="stg:text-xs stg:text-muted-foreground">
            Loading the comparison…
          </p>
        ) : rows.length === 0 ? (
          <p className="stg:text-xs stg:text-muted-foreground">
            Neither eval has a case that ran.
          </p>
        ) : (
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
                    Before
                  </th>
                  <th scope="col" className={CELL_CLASS}>
                    After
                  </th>
                  <th scope="col" className={CELL_CLASS}>
                    Δ before
                  </th>
                  <th scope="col" className={CELL_CLASS}>
                    Δ after
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
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
                      className={cn(
                        CELL_CLASS,
                        "stg:text-left stg:font-medium",
                      )}
                    >
                      {row.name}
                      {row.changed && (
                        <span className="stg:ml-1 stg:text-warning">
                          changed
                        </span>
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
                    <td className={CELL_CLASS}>
                      {row.before === null
                        ? "—"
                        : formatDelta(row.before.delta)}
                    </td>
                    <td className={CELL_CLASS}>
                      {row.after === null ? "—" : formatDelta(row.after.delta)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Section>
  );
}

const LABEL_CLASS = "stg:block stg:text-xs stg:font-medium stg:text-foreground";
const HINT_CLASS = "stg:text-[0.65rem] stg:text-muted-foreground";
const CELL_CLASS = "stg:px-2 stg:py-1.5";
