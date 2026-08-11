"use client";

import { memo, useCallback } from "react";
import type { JsonObject } from "@bufbuild/protobuf";
import type { WorkflowGraphNode } from "../../workflow-graph-model.js";
import type { TaskKindDescriptor } from "../../types.js";

/** Props for {@link RuntimeTab}. */
export interface RuntimeTabProps {
  readonly node: WorkflowGraphNode;
  readonly kindString: string;
  readonly descriptor: TaskKindDescriptor | undefined;
  readonly onFieldChange: (fieldPath: string, value: unknown) => void;
}

const AI_KINDS = new Set(["agent_call", "llm_call", "eval"]);
const INVOCATION_KINDS = new Set(["http_call", "grpc_call", "activity_call", "run_workflow"]);

/**
 * Runtime tab — timeout, retry, budget, and execution policies.
 *
 * Content varies by task kind category:
 * - agent_call: model + budget per run (the shared run_config block)
 * - llm_call / eval: timeout, max cost
 * - Invocation kinds: timeout
 * - Container kinds: concurrency, join policy
 *
 * @since T10 (Inspector Panel Refactor)
 */
export const RuntimeTab = memo(function RuntimeTab({
  node,
  kindString,
  descriptor,
  onFieldChange,
}: RuntimeTabProps) {
  const config = node.config as Record<string, unknown>;
  const isAi = AI_KINDS.has(kindString);
  const isInvocation = INVOCATION_KINDS.has(kindString);

  const handleChange = useCallback(
    (field: string, value: unknown) => onFieldChange(field, value),
    [onFieldChange],
  );

  return (
    <div className="stg:flex stg:flex-col stg:gap-4 stg:px-3 stg:py-3">
      {kindString === "agent_call" && (
        <AgentCallRuntimeSection config={config} onChange={handleChange} />
      )}

      {isAi && kindString !== "agent_call" && (
        <AgentRuntimeSection config={config} onChange={handleChange} />
      )}

      {isInvocation && (
        <TimeoutSection config={config} kindString={kindString} onChange={handleChange} />
      )}

      {kindString === "fork" && (
        <ForkRuntimeSection config={config} onChange={handleChange} />
      )}

      {kindString === "for_each" && (
        <ForEachRuntimeSection config={config} onChange={handleChange} />
      )}

      {!isAi && !isInvocation && kindString !== "fork" && kindString !== "for_each" && (
        <p className="stg:text-xs stg:text-[var(--stgm-muted-foreground,#737373)]">
          No runtime settings available for this task kind.
        </p>
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Agent call runtime (shared run_config vocabulary)
// ---------------------------------------------------------------------------

/**
 * Edits the agent_call `run_config` block (the shared agentexecution
 * RunConfig, stigmer/stigmer#358): model override + per-run USD budget,
 * both enforced by the runner. `max_tool_rounds` stays off the form
 * (DD-018 D-5). Empty means omit — a blank field never becomes a zero
 * override.
 */
function AgentCallRuntimeSection({
  config,
  onChange,
}: {
  config: Record<string, unknown>;
  onChange: (field: string, value: unknown) => void;
}) {
  const runConfig = (config.run_config ?? {}) as Record<string, unknown>;

  const handleRunConfigChange = useCallback(
    (field: string, value: unknown) => {
      const next: Record<string, unknown> = {
        ...runConfig,
        [field]: value === "" ? undefined : value,
      };
      for (const key of Object.keys(next)) {
        if (next[key] === undefined) delete next[key];
      }
      onChange("run_config", Object.keys(next).length > 0 ? next : undefined);
    },
    [runConfig, onChange],
  );

  return (
    <section className="stg:flex stg:flex-col stg:gap-3">
      <SectionLabel>Execution</SectionLabel>

      <FieldRow label="Model" hint="Override agent default model">
        <input
          type="text"
          value={typeof runConfig.model_name === "string" ? runConfig.model_name : ""}
          onChange={(e) => handleRunConfigChange("model_name", e.target.value || undefined)}
          placeholder="Agent default"
          className={inputClass}
        />
      </FieldRow>

      <FieldRow label="Budget per run (USD)" hint="The call stops when its estimated cost reaches this amount">
        <input
          type="number"
          value={typeof runConfig.max_cost_usd === "number" ? runConfig.max_cost_usd : ""}
          onChange={(e) => handleRunConfigChange("max_cost_usd", e.target.value ? parseFloat(e.target.value) : undefined)}
          placeholder="No limit"
          min={0}
          step={0.05}
          className={inputClass}
        />
      </FieldRow>
    </section>
  );
}

// ---------------------------------------------------------------------------
// LLM/eval runtime
// ---------------------------------------------------------------------------

function AgentRuntimeSection({
  config,
  onChange,
}: {
  config: Record<string, unknown>;
  onChange: (field: string, value: unknown) => void;
}) {
  const nestedConfig = (config.config ?? {}) as Record<string, unknown>;

  const handleNestedChange = useCallback(
    (field: string, value: unknown) => {
      onChange("config", { ...nestedConfig, [field]: value === "" ? undefined : value });
    },
    [nestedConfig, onChange],
  );

  return (
    <section className="stg:flex stg:flex-col stg:gap-3">
      <SectionLabel>Execution</SectionLabel>

      <FieldRow label="Timeout" hint="Seconds before the task is cancelled">
        <input
          type="number"
          value={typeof nestedConfig.timeout === "number" ? nestedConfig.timeout : ""}
          onChange={(e) => handleNestedChange("timeout", e.target.value ? parseInt(e.target.value, 10) : undefined)}
          placeholder="300"
          min={1}
          max={3600}
          className={inputClass}
        />
      </FieldRow>

      <FieldRow label="Max cost" hint="Per-task cost cap in micro-USD">
        <input
          type="number"
          value={typeof nestedConfig.max_cost_micros === "number" ? nestedConfig.max_cost_micros : ""}
          onChange={(e) => handleNestedChange("max_cost_micros", e.target.value ? parseInt(e.target.value, 10) : undefined)}
          placeholder="No limit"
          min={0}
          className={inputClass}
        />
      </FieldRow>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Timeout section (invocation kinds)
// ---------------------------------------------------------------------------

function TimeoutSection({
  config,
  kindString,
  onChange,
}: {
  config: Record<string, unknown>;
  kindString: string;
  onChange: (field: string, value: unknown) => void;
}) {
  const fieldName = kindString === "http_call" ? "timeout_seconds" : "timeout";
  const currentValue = config[fieldName];

  return (
    <section className="stg:flex stg:flex-col stg:gap-3">
      <SectionLabel>Execution</SectionLabel>
      <FieldRow label="Timeout" hint="Seconds before the request is cancelled">
        <input
          type="number"
          value={typeof currentValue === "number" ? currentValue : ""}
          onChange={(e) => onChange(fieldName, e.target.value ? parseInt(e.target.value, 10) : undefined)}
          placeholder="30"
          min={1}
          className={inputClass}
        />
      </FieldRow>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Fork runtime
// ---------------------------------------------------------------------------

function ForkRuntimeSection({
  config,
  onChange,
}: {
  config: Record<string, unknown>;
  onChange: (field: string, value: unknown) => void;
}) {
  const compete = config.compete === true;

  return (
    <section className="stg:flex stg:flex-col stg:gap-3">
      <SectionLabel>Join policy</SectionLabel>
      <label className="stg:flex stg:cursor-pointer stg:items-center stg:gap-2">
        <input
          type="checkbox"
          checked={compete}
          onChange={(e) => onChange("compete", e.target.checked || undefined)}
          className="stg:h-4 stg:w-4 stg:rounded stg:border-[var(--stgm-border,#d4d4d8)] stg:text-[var(--stgm-primary,#6366f1)]"
        />
        <span className="stg:text-xs stg:text-[var(--stgm-foreground,#1a1a2e)]">
          Compete mode (first branch wins)
        </span>
      </label>
      <p className="stg:text-[10px] stg:text-[var(--stgm-muted-foreground,#737373)]">
        {compete
          ? "The join resumes when any branch completes. Other branches are cancelled."
          : "The join waits for all branches to complete before continuing."}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// ForEach runtime
// ---------------------------------------------------------------------------

function ForEachRuntimeSection({
  config,
  onChange,
}: {
  config: Record<string, unknown>;
  onChange: (field: string, value: unknown) => void;
}) {
  return (
    <section className="stg:flex stg:flex-col stg:gap-3">
      <SectionLabel>Iteration</SectionLabel>
      <FieldRow label="Collection" hint="Expression that produces the items to iterate">
        <input
          type="text"
          value={typeof config.collection === "string" ? config.collection : ""}
          onChange={(e) => onChange("collection", e.target.value || undefined)}
          placeholder='${ $context.items }'
          className={inputClass}
        />
      </FieldRow>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

const inputClass =
  "stg:w-full stg:rounded-md stg:border stg:border-[var(--stgm-border,#d4d4d8)] stg:bg-[var(--stgm-background,#fff)] stg:px-2 stg:py-1.5 stg:text-xs stg:text-[var(--stgm-foreground,#1a1a2e)] stg:placeholder:text-[var(--stgm-muted-foreground,#a3a3a3)] stg:focus:outline-none stg:focus:ring-1 stg:focus:ring-[var(--stgm-ring,#3b82f6)]";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="stg:text-[11px] stg:font-semibold stg:uppercase stg:tracking-wide stg:text-[var(--stgm-muted-foreground,#737373)]">
      {children}
    </h4>
  );
}

function FieldRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="stg:flex stg:flex-col stg:gap-1">
      <label className="stg:text-[11px] stg:font-medium stg:text-[var(--stgm-foreground,#1a1a2e)]">
        {label}
      </label>
      {hint && (
        <p className="stg:text-[10px] stg:leading-tight stg:text-[var(--stgm-muted-foreground,#737373)]">
          {hint}
        </p>
      )}
      {children}
    </div>
  );
}
