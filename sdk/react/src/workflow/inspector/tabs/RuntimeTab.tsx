"use client";

import { memo, useCallback } from "react";
import type { JsonObject } from "@bufbuild/protobuf";
import type { WorkflowGraphNode } from "../../workflow-graph-model";
import type { TaskKindDescriptor } from "../../types";

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
 * - AI kinds: model, timeout, temperature, max cost
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
    <div className="flex flex-col gap-4 px-3 py-3">
      {isAi && (
        <AgentRuntimeSection config={config} kindString={kindString} onChange={handleChange} />
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
        <p className="text-xs text-[var(--stgm-muted-foreground,#737373)]">
          No runtime settings available for this task kind.
        </p>
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Agent/LLM runtime
// ---------------------------------------------------------------------------

function AgentRuntimeSection({
  config,
  kindString,
  onChange,
}: {
  config: Record<string, unknown>;
  kindString: string;
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
    <section className="flex flex-col gap-3">
      <SectionLabel>Execution</SectionLabel>

      {kindString === "agent_call" && (
        <FieldRow label="Model" hint="Override agent default model">
          <input
            type="text"
            value={typeof nestedConfig.model === "string" ? nestedConfig.model : ""}
            onChange={(e) => handleNestedChange("model", e.target.value || undefined)}
            placeholder="Agent default"
            className={inputClass}
          />
        </FieldRow>
      )}

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

      {kindString === "agent_call" && (
        <FieldRow label="Temperature" hint="0.0 (deterministic) to 1.0 (creative)">
          <input
            type="number"
            value={typeof nestedConfig.temperature === "number" ? nestedConfig.temperature : ""}
            onChange={(e) => handleNestedChange("temperature", e.target.value ? parseFloat(e.target.value) : undefined)}
            placeholder="0.7"
            min={0}
            max={1}
            step={0.1}
            className={inputClass}
          />
        </FieldRow>
      )}

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
    <section className="flex flex-col gap-3">
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
    <section className="flex flex-col gap-3">
      <SectionLabel>Join policy</SectionLabel>
      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={compete}
          onChange={(e) => onChange("compete", e.target.checked || undefined)}
          className="h-4 w-4 rounded border-[var(--stgm-border,#d4d4d8)] text-[var(--stgm-primary,#6366f1)]"
        />
        <span className="text-xs text-[var(--stgm-foreground,#1a1a2e)]">
          Compete mode (first branch wins)
        </span>
      </label>
      <p className="text-[10px] text-[var(--stgm-muted-foreground,#737373)]">
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
    <section className="flex flex-col gap-3">
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
  "w-full rounded-md border border-[var(--stgm-border,#d4d4d8)] bg-[var(--stgm-background,#fff)] px-2 py-1.5 text-xs text-[var(--stgm-foreground,#1a1a2e)] placeholder:text-[var(--stgm-muted-foreground,#a3a3a3)] focus:outline-none focus:ring-1 focus:ring-[var(--stgm-ring,#3b82f6)]";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--stgm-muted-foreground,#737373)]">
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
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-medium text-[var(--stgm-foreground,#1a1a2e)]">
        {label}
      </label>
      {hint && (
        <p className="text-[10px] leading-tight text-[var(--stgm-muted-foreground,#737373)]">
          {hint}
        </p>
      )}
      {children}
    </div>
  );
}
