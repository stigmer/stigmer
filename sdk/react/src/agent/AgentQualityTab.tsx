"use client";

import { useId, useState } from "react";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { Evaluator } from "@stigmer/protos/ai/stigmer/agentic/evaluator/v1/api_pb";
import { cn } from "@stigmer/theme";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { useAgentEvaluator } from "../evaluator/useAgentEvaluator.js";
import { useSaveEvaluator } from "../evaluator/useSaveEvaluator.js";
import {
  DEFAULT_GRADING_SETTINGS,
  MAX_ONE_IN,
  gradesNoRun,
  isValidLimit,
  settingsOf,
  type GradingSettings,
} from "../evaluator/grading-settings.js";
import { ModelSelector } from "../models/ModelSelector.js";
import { Section } from "../resource-detail/Section.js";
import { Switch } from "../switch/Switch.js";
import { INPUT_CLASS, PRIMARY_BUTTON_CLASS } from "../vault/styles.js";

/** Props for {@link AgentQualityTab}. */
export interface AgentQualityTabProps {
  /** The agent whose AI grading the tab shows and configures. */
  readonly agent: Agent;
  /**
   * When `true`, the settings can be changed. The server still asks for
   * edit access on the agent; a refusal is shown as an error.
   * @default false
   */
  readonly editable?: boolean;
  /** Additional CSS class names for the root element. */
  readonly className?: string;
}

/**
 * The agent's Quality tab: AI grading switched on or off, how many runs it
 * grades ("one in N runs"), the monthly limit in estimated model spend, the
 * judge's model, and this month's spend and counts, with the reason the
 * last run picked for grading was not graded.
 *
 * Grading is the agent's setting, not part of its definition, so a
 * plugin-managed agent offers it too. Anyone who can view the agent sees
 * the tab; changes need edit access on the agent.
 *
 * All visual properties flow through `--stgm-*` tokens.
 */
export function AgentQualityTab({
  agent,
  editable = false,
  className,
}: AgentQualityTabProps) {
  const agentId = agent.metadata?.id ?? "";
  const { evaluator, isLoading, error, refetch } = useAgentEvaluator(agentId);

  if (isLoading) {
    return (
      <p className={cn("stg:text-xs stg:text-muted-foreground", className)}>
        Loading AI grading…
      </p>
    );
  }
  if (error !== null) {
    return <ErrorMessage error={error} retry={refetch} className={className} />;
  }

  // A fresh read remounts the form, so the stored settings are its start.
  const readKey = `${evaluator?.metadata?.id ?? "none"}:${
    evaluator?.status?.audit?.specAudit?.updatedAt?.seconds?.toString() ?? ""
  }`;
  return (
    <QualityForm
      key={readKey}
      agentId={agentId}
      agentOrg={agent.metadata?.org ?? ""}
      evaluator={evaluator}
      editable={editable}
      onSaved={refetch}
      className={className}
    />
  );
}

function QualityForm({
  agentId,
  agentOrg,
  evaluator,
  editable,
  onSaved,
  className,
}: {
  readonly agentId: string;
  readonly agentOrg: string;
  readonly evaluator: Evaluator | null;
  readonly editable: boolean;
  readonly onSaved: () => void;
  readonly className?: string;
}) {
  const baseId = useId();
  const { save, isSaving, error: saveError } = useSaveEvaluator();
  const stored =
    evaluator === null
      ? { ...DEFAULT_GRADING_SETTINGS, enabled: false }
      : settingsOf(evaluator);
  const [draft, setDraft] = useState<GradingSettings>(stored);
  const [limitText, setLimitText] = useState(String(stored.monthlyLimitUsd));

  const limit = Number(limitText);
  const limitValid = isValidLimit(limit);
  const dirty =
    draft.enabled !== stored.enabled ||
    draft.oneIn !== stored.oneIn ||
    draft.modelName !== stored.modelName ||
    limit !== stored.monthlyLimitUsd;

  const onSave = async (): Promise<void> => {
    try {
      await save(
        { id: agentId, org: agentOrg },
        { ...draft, monthlyLimitUsd: limit },
        evaluator,
      );
      onSaved();
    } catch {
      // The hook keeps the error; the form shows it below.
    }
  };

  const status = evaluator?.status;

  return (
    <div className={cn("stg:flex stg:flex-col stg:gap-6", className)}>
      <Section title="AI grading">
        <div className="stg:flex stg:flex-col stg:gap-4">
          <p className="stg:text-xs stg:text-muted-foreground">
            An AI judge grades a sample of this agent&apos;s finished runs with two
            standard questions: did it do the task, and did it make anything up.
            Everyone who can see a run sees its grade. The judge&apos;s cost is
            charged to the run&apos;s organization, never to the run.
          </p>
          <div className="stg:flex stg:items-center stg:gap-2">
            <Switch
              id={`${baseId}-enabled`}
              checked={draft.enabled}
              onCheckedChange={(enabled) => setDraft({ ...draft, enabled })}
              disabled={!editable || isSaving}
            />
            <label
              htmlFor={`${baseId}-enabled`}
              className="stg:text-xs stg:font-medium stg:text-foreground"
            >
              Grade this agent&apos;s runs with an AI judge
            </label>
          </div>
          <div className="stg:flex stg:flex-col stg:gap-1">
            <label htmlFor={`${baseId}-one-in`} className={LABEL_CLASS}>
              Grade one in N runs
            </label>
            <input
              id={`${baseId}-one-in`}
              type="number"
              min={1}
              max={MAX_ONE_IN}
              step={1}
              value={draft.oneIn}
              onChange={(event) =>
                setDraft({ ...draft, oneIn: Number(event.target.value) })
              }
              disabled={!editable || isSaving}
              className={cn(INPUT_CLASS, "stg:sm:max-w-32")}
            />
            <p className={HINT_CLASS}>
              1 grades every run; 10 grades about one run in ten.
            </p>
          </div>
          <div className="stg:flex stg:flex-col stg:gap-1">
            <label htmlFor={`${baseId}-limit`} className={LABEL_CLASS}>
              Monthly limit (USD, estimated model spend)
            </label>
            <input
              id={`${baseId}-limit`}
              type="number"
              min={0}
              step="any"
              value={limitText}
              onChange={(event) => setLimitText(event.target.value)}
              disabled={!editable || isSaving}
              aria-invalid={!limitValid}
              className={cn(INPUT_CLASS, "stg:sm:max-w-32")}
            />
            <p className={HINT_CLASS}>
              When a grade would pass it, runs are marked &ldquo;not graded:
              spending limit reached&rdquo; until next month. The estimate is the
              model&apos;s cost before any platform pricing.
            </p>
            {gradesNoRun(limit) && (
              <p className="stg:text-xs stg:text-destructive">
                Each grade sets aside up to $0.25 before it starts, so a limit
                below $0.25 grades no run.
              </p>
            )}
          </div>
          <div className="stg:flex stg:flex-col stg:gap-1">
            <span className={LABEL_CLASS}>Judge model</span>
            <ModelSelector
              value={draft.modelName === "" ? undefined : draft.modelName}
              onValueChange={(modelName) => setDraft({ ...draft, modelName })}
              harness="native"
              compact
              disabled={!editable || isSaving}
              placeholderLabel="Platform default"
            />
          </div>
          {editable && (
            <div>
              <button
                type="button"
                disabled={!dirty || !limitValid || isSaving}
                onClick={() => void onSave()}
                className={PRIMARY_BUTTON_CLASS}
              >
                {isSaving ? "Saving…" : "Save"}
              </button>
            </div>
          )}
          {saveError !== null && (
            <p role="alert" className="stg:text-xs stg:text-destructive">
              {saveError.message}
            </p>
          )}
        </div>
      </Section>
      {status !== undefined && status.period !== "" && (
        <Section title={`This month (${status.period})`}>
          <dl className="stg:grid stg:grid-cols-2 stg:gap-x-6 stg:gap-y-1 stg:text-xs stg:sm:max-w-md">
            <dt className="stg:text-muted-foreground">Spent</dt>
            <dd className="stg:text-foreground">{usd(status.spentUsd)}</dd>
            <dt className="stg:text-muted-foreground">Set aside for grades running</dt>
            <dd className="stg:text-foreground">{usd(status.reservedUsd)}</dd>
            <dt className="stg:text-muted-foreground">Graded</dt>
            <dd className="stg:text-foreground">{status.graded}</dd>
            <dt className="stg:text-muted-foreground">Not graded</dt>
            <dd className="stg:text-foreground">{status.notGraded}</dd>
          </dl>
          {status.lastNotGradedReason !== "" && (
            <p className="stg:mt-2 stg:text-xs stg:text-muted-foreground">
              Last not graded: {status.lastNotGradedReason}
            </p>
          )}
        </Section>
      )}
    </div>
  );
}

const LABEL_CLASS = "stg:block stg:text-xs stg:font-medium stg:text-foreground";
const HINT_CLASS = "stg:text-[0.65rem] stg:text-muted-foreground";

function usd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}
