"use client";

/**
 * The "Run defaults" section of the agent detail view: the engine and
 * model a conversation on the agent runs when nobody picks one, with that
 * model's speed tier and thinking, and a per-message cost cap.
 *
 * The engine and model are picked together, the composer's pairing: the
 * engine with the engine selector, the model with the model selector
 * locked to that engine, because a model name belongs to one engine (the
 * server refuses a model with no engine, or one its engine does not
 * list). An engine alone is valid: a new conversation starts on it, and
 * the engine's own default model runs. Tier and thinking ride the model
 * (the server refuses them without one), so clearing the model clears
 * them. The tool-round and tool-result bounds are API-only: shown when
 * set, never edited here, and carried through a save untouched.
 *
 * A save writes `spec.run_config` and `spec.harness` together through the
 * host's `onSave`; the server's refusal message shows under the section,
 * the way the other agent edits show theirs.
 *
 * Pinned by `__tests__/AgentRunDefaultsSection.test.tsx`.
 */

import { useState } from "react";
import { cn } from "@stigmer/theme";
import type { AgentSpec } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import type { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import {
  ServiceTier,
  ThinkingMode,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { RunConfigInput } from "@stigmer/sdk";
import { Section } from "../resource-detail/Section.js";
import { HarnessSelector } from "../models/HarnessSelector.js";
import { ModelSelector } from "../models/ModelSelector.js";
import { useModelRegistry } from "../models/useModelRegistry.js";
import { HARNESS_LABELS, toProtoHarness, type HarnessOption } from "../models/harness.js";
import type { ServiceTierOption } from "../models/service-tier.js";
import { thinkingLocked, type ThinkingModeOption } from "../models/thinking-mode.js";
import { agentHarnessOf } from "./run-defaults.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";

/** What a save writes: the two spec fields, together. */
export interface AgentRunDefaultsSave {
  /** `AgentSpec.harness`; `undefined` names no engine. */
  readonly harness: Harness | undefined;
  /** `AgentSpec.run_config`; `undefined` when nothing is set. */
  readonly runConfig: RunConfigInput | undefined;
}

/** Props for {@link AgentRunDefaultsSection}. */
export interface AgentRunDefaultsSectionProps {
  readonly spec: AgentSpec | undefined;
  readonly editable: boolean;
  readonly isSaving: boolean;
  /** The server's message for the last failed save of this section. */
  readonly error?: string;
  /** Persist both fields; resolves `true` on success. */
  readonly onSave: (save: AgentRunDefaultsSave) => Promise<boolean>;
  /** Called when editing starts, so a stale error from an earlier attempt clears. */
  readonly onEditStart?: () => void;
}

/**
 * Shows an agent's run defaults, and edits them when `editable`.
 *
 * @example
 * ```tsx
 * <AgentRunDefaultsSection
 *   spec={agent.spec}
 *   editable
 *   isSaving={isUpdating}
 *   onSave={({ harness, runConfig }) => saveFields("runConfig", { harness, runConfig })}
 * />
 * ```
 */
export function AgentRunDefaultsSection({
  spec,
  editable,
  isSaving,
  error,
  onSave,
  onEditStart,
}: AgentRunDefaultsSectionProps) {
  const [isEditing, setIsEditing] = useState(false);
  const hasDefaults = agentHarnessOf(spec) !== undefined || spec?.runConfig !== undefined;
  if (!editable && !hasDefaults) return null;

  const startEdit = () => {
    onEditStart?.();
    setIsEditing(true);
  };

  return (
    <Section
      title="Run defaults"
      onEdit={editable && !isEditing ? startEdit : undefined}
    >
      {isEditing ? (
        <RunDefaultsEditor
          spec={spec}
          isSaving={isSaving}
          error={error}
          onCancel={() => setIsEditing(false)}
          onSave={async (save) => {
            const ok = await onSave(save);
            if (ok) setIsEditing(false);
          }}
        />
      ) : (
        <RunDefaultsSummary spec={spec} />
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Read view
// ---------------------------------------------------------------------------

function RunDefaultsSummary({ spec }: { readonly spec: AgentSpec | undefined }) {
  const engine = agentHarnessOf(spec);
  const config = spec?.runConfig;
  const { getModel } = useModelRegistry({ harness: engine });
  const modelName = config?.modelName ?? "";
  const model = modelName !== "" ? getModel(modelName) : undefined;

  return (
    <dl className="stg:grid stg:grid-cols-[auto_1fr] stg:gap-x-4 stg:gap-y-1.5 stg:p-3 stg:text-sm">
      <SummaryRow label="Engine">
        {engine ? HARNESS_LABELS[engine] : "None (the conversation's engine)"}
      </SummaryRow>
      <SummaryRow label="Model">
        {modelName !== "" ? (model?.displayName ?? modelName) : "None (the engine's default)"}
      </SummaryRow>
      {modelName !== "" && (
        <>
          <SummaryRow label="Speed">
            {config?.serviceTier === ServiceTier.FAST ? "Fast" : "Standard"}
          </SummaryRow>
          <SummaryRow label="Thinking">
            {config?.thinkingMode === ThinkingMode.ENABLED ? "On" : "Off"}
          </SummaryRow>
        </>
      )}
      <SummaryRow label="Cost cap">
        {config && config.maxCostUsd > 0 ? `$${config.maxCostUsd} per message` : "None"}
      </SummaryRow>
      {config && config.maxToolRounds > 0 && (
        <SummaryRow label="Tool rounds">{`At most ${config.maxToolRounds} per message`}</SummaryRow>
      )}
      {config && config.maxToolResultChars > 0 && (
        <SummaryRow label="Tool result size">
          {`At most ${config.maxToolResultChars.toLocaleString()} characters`}
        </SummaryRow>
      )}
    </dl>
  );
}

function SummaryRow({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <>
      <dt className="stg:text-xs stg:text-muted-foreground">{label}</dt>
      <dd className="stg:text-foreground">{children}</dd>
    </>
  );
}

// ---------------------------------------------------------------------------
// Edit view
// ---------------------------------------------------------------------------

const inputClasses = cn(
  "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-2.5 stg:py-1.5 stg:text-xs stg:text-foreground",
  "stg:placeholder:text-muted-foreground",
  "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
  "stg:disabled:pointer-events-none stg:disabled:opacity-50",
);

const quietButtonClasses = cn(
  "stg:rounded-md stg:px-2 stg:py-1 stg:text-xs stg:text-muted-foreground stg:hover:text-foreground",
  "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
  "stg:disabled:pointer-events-none stg:disabled:opacity-50",
);

function RunDefaultsEditor({
  spec,
  isSaving,
  error,
  onCancel,
  onSave,
}: {
  readonly spec: AgentSpec | undefined;
  readonly isSaving: boolean;
  readonly error?: string;
  readonly onCancel: () => void;
  readonly onSave: (save: AgentRunDefaultsSave) => Promise<void>;
}) {
  const stored = spec?.runConfig;
  const [engine, setEngine] = useState<HarnessOption | undefined>(agentHarnessOf(spec));
  const [modelName, setModelName] = useState(stored?.modelName ?? "");
  const [serviceTier, setServiceTier] = useState<ServiceTierOption>(
    stored?.serviceTier === ServiceTier.FAST ? "fast" : "standard",
  );
  const [thinkingMode, setThinkingMode] = useState<ThinkingModeOption>(
    stored?.thinkingMode === ThinkingMode.ENABLED ? "enabled" : "disabled",
  );
  const [costCap, setCostCap] = useState(
    stored && stored.maxCostUsd > 0 ? String(stored.maxCostUsd) : "",
  );
  const { getModel } = useModelRegistry({ harness: engine });

  const clearModel = () => {
    setModelName("");
    setServiceTier("standard");
    setThinkingMode("disabled");
  };
  // A model belongs to one engine: another engine starts with none.
  const changeEngine = (next: HarnessOption | undefined) => {
    if (next !== engine) clearModel();
    setEngine(next);
  };

  const cost = Number.parseFloat(costCap);
  const costValid = costCap.trim() === "" || (Number.isFinite(cost) && cost > 0);

  const handleSave = () => {
    const model = engine !== undefined ? modelName.trim() : "";
    const picked = model !== "" ? getModel(model) : undefined;
    // What the model selector shows is what is saved: a model that always
    // thinks shows thinking on, so it is saved on.
    const thinkingOn =
      model !== "" && (thinkingMode === "enabled" || (picked !== undefined && thinkingLocked(picked)));
    const config: RunConfigInput = {
      ...(model !== "" ? { modelName: model } : {}),
      ...(model !== "" && serviceTier === "fast" ? { serviceTier: ServiceTier.FAST } : {}),
      ...(thinkingOn ? { thinkingMode: ThinkingMode.ENABLED } : {}),
      ...(costCap.trim() !== "" ? { maxCostUsd: cost } : {}),
      // API-only bounds ride through untouched.
      ...(stored && stored.maxToolRounds > 0 ? { maxToolRounds: stored.maxToolRounds } : {}),
      ...(stored && stored.maxToolResultChars > 0
        ? { maxToolResultChars: stored.maxToolResultChars }
        : {}),
    };
    void onSave({
      harness: engine !== undefined ? toProtoHarness(engine) : undefined,
      runConfig: Object.keys(config).length > 0 ? config : undefined,
    });
  };

  return (
    <div className="stg:flex stg:flex-col stg:gap-3 stg:p-3">
      <div className="stg:flex stg:flex-col stg:gap-1.5">
        <span className="stg:text-xs stg:font-medium stg:text-foreground">Engine and model</span>
        {engine === undefined ? (
          <div>
            <button
              type="button"
              onClick={() => changeEngine("native")}
              disabled={isSaving}
              className={cn(
                "stg:rounded-md stg:border stg:border-dashed stg:border-border stg:px-2.5 stg:py-1.5 stg:text-xs stg:text-muted-foreground",
                "stg:hover:text-foreground stg:hover:border-muted-foreground",
                "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
              )}
            >
              Choose an engine
            </button>
          </div>
        ) : (
          <div className="stg:flex stg:flex-wrap stg:items-center stg:gap-2">
            <HarnessSelector value={engine} onValueChange={changeEngine} disabled={isSaving} />
            <ModelSelector
              value={modelName}
              onValueChange={setModelName}
              harness={engine}
              // Speed and thinking are saved only with a model (saved
              // settings name the model they were chosen for), so the
              // switches show only once one is picked.
              serviceTier={serviceTier}
              onServiceTierChange={modelName !== "" ? setServiceTier : undefined}
              thinkingMode={thinkingMode}
              onThinkingModeChange={modelName !== "" ? setThinkingMode : undefined}
              placeholderLabel="Engine default model"
              disabled={isSaving}
            />
            {modelName !== "" && (
              <button type="button" onClick={clearModel} disabled={isSaving} className={quietButtonClasses}>
                Clear model
              </button>
            )}
            <button
              type="button"
              onClick={() => changeEngine(undefined)}
              disabled={isSaving}
              className={quietButtonClasses}
            >
              No engine
            </button>
          </div>
        )}
        <p className="stg:text-[0.65rem] stg:text-muted-foreground">
          A new conversation on this agent starts on this engine unless the
          person picks another. The model, its speed and thinking apply on
          this engine to every message that does not choose its own.
        </p>
      </div>

      <label className="stg:flex stg:flex-col stg:gap-1.5">
        <span className="stg:text-xs stg:font-medium stg:text-foreground">Cost cap per message (USD)</span>
        <input
          type="number"
          min="0"
          step="any"
          value={costCap}
          onChange={(e) => setCostCap(e.target.value)}
          placeholder="No cap"
          disabled={isSaving}
          aria-invalid={!costValid}
          className={cn(inputClasses, "stg:sm:max-w-48")}
        />
        <span className="stg:text-[0.65rem] stg:text-muted-foreground">
          A message stops when it reaches this spend. A message can lower it, never raise it.
        </span>
      </label>

      <div className="stg:flex stg:flex-col stg:gap-1.5">
        <div className="stg:flex stg:items-center stg:justify-end stg:gap-1.5">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSaving}
            className={cn(
              "stg:rounded-md stg:px-2.5 stg:py-1 stg:text-xs stg:font-medium",
              "stg:border stg:border-border stg:bg-background stg:text-foreground stg:hover:bg-accent stg:hover:text-accent-foreground",
              "stg:disabled:opacity-50",
              "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
            )}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!costValid || isSaving}
            className={cn(
              "stg:inline-flex stg:items-center stg:gap-1 stg:rounded-md stg:px-2.5 stg:py-1 stg:text-xs stg:font-medium",
              "stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary-hover",
              "stg:disabled:pointer-events-none stg:disabled:opacity-50",
              "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
            )}
          >
            {isSaving && <SpinnerIcon size={14} />}
            Save
          </button>
        </div>
        {!costValid && (
          <p className="stg:text-xs stg:text-destructive" role="alert">
            The cost cap must be a positive number, or empty for no cap.
          </p>
        )}
        {error && (
          <p className="stg:text-xs stg:text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
