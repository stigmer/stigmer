"use client";

import { memo, useState, useCallback, useMemo } from "react";
import type { JsonObject } from "@bufbuild/protobuf";
import type { WorkflowGraphNode } from "../../workflow-graph-model.js";

/** Props for {@link AgentCallForm}. */
export interface AgentCallFormProps {
  readonly node: WorkflowGraphNode;
  readonly onFieldChange: (fieldPath: string, value: unknown) => void;
}

const inputClass =
  "w-full rounded-md border border-[var(--stgm-border,#d4d4d8)] bg-[var(--stgm-background,#fff)] px-2 py-1.5 text-xs text-[var(--stgm-foreground,#1a1a2e)] placeholder:text-[var(--stgm-muted-foreground,#a3a3a3)] focus:outline-none focus:ring-1 focus:ring-[var(--stgm-ring,#3b82f6)]";

/**
 * Specialized configuration form for `agent_call` tasks.
 *
 * Organizes agent-specific fields into semantic sections: Agent identity,
 * harness selection, message prompt, environment variables, execution
 * config (model, timeout, temperature, cost cap), and structured output.
 *
 * Composes primitive field controls rather than rendering a generic
 * schema form — following the research report guidance that "the forms
 * should educate the user about the semantics of each step."
 *
 * @since T10 (Inspector Panel Refactor)
 */
export const AgentCallForm = memo(function AgentCallForm({
  node,
  onFieldChange,
}: AgentCallFormProps) {
  const config = node.config as Record<string, unknown>;
  const execConfig = (config.config ?? {}) as Record<string, unknown>;
  const outputContract = (config.output ?? {}) as Record<string, unknown>;
  const hasOutput = Object.keys(outputContract).length > 0;
  const [showOutput, setShowOutput] = useState(hasOutput);

  const handleChange = useCallback(
    (field: string, value: unknown) => {
      onFieldChange(field, value === "" ? undefined : value);
    },
    [onFieldChange],
  );

  const handleExecConfigChange = useCallback(
    (field: string, value: unknown) => {
      onFieldChange("config", {
        ...execConfig,
        [field]: value === "" ? undefined : value,
      });
    },
    [execConfig, onFieldChange],
  );

  const handleOutputChange = useCallback(
    (field: string, value: unknown) => {
      onFieldChange("output", {
        ...outputContract,
        [field]: value === "" ? undefined : value,
      });
    },
    [outputContract, onFieldChange],
  );

  const toggleOutput = useCallback(() => {
    if (showOutput) {
      onFieldChange("output", undefined);
      setShowOutput(false);
    } else {
      setShowOutput(true);
    }
  }, [showOutput, onFieldChange]);

  const envEntries = useMemo(() => {
    const env = config.env;
    if (!env || typeof env !== "object" || Array.isArray(env)) return [];
    return Object.entries(env as Record<string, unknown>);
  }, [config.env]);

  return (
    <div className="flex flex-col gap-4 px-3 py-3">
      {/* Agent identity */}
      <section className="flex flex-col gap-2">
        <SectionLabel>Agent</SectionLabel>
        <FieldRow label="Agent" hint='Slug or "org/slug" format' required>
          <input
            type="text"
            value={typeof config.agent === "string" ? config.agent : ""}
            onChange={(e) => handleChange("agent", e.target.value)}
            placeholder="e.g., code-reviewer or acme/analyst"
            className={inputClass}
            data-testid="agent-call-agent-input"
          />
        </FieldRow>

        <FieldRow label="Harness" hint="Execution engine for this agent call">
          <div className="flex gap-3">
            <label className="flex items-center gap-1.5 text-xs">
              <input
                type="radio"
                name={`${node.id}-harness`}
                checked={!config.harness || config.harness === "HARNESS_NATIVE" || config.harness === "native"}
                onChange={() => handleChange("harness", undefined)}
                className="h-3.5 w-3.5 border-[var(--stgm-border,#d4d4d8)] text-[var(--stgm-primary,#6366f1)]"
              />
              Native
            </label>
            <label className="flex items-center gap-1.5 text-xs">
              <input
                type="radio"
                name={`${node.id}-harness`}
                checked={config.harness === "cursor" || config.harness === "HARNESS_CURSOR"}
                onChange={() => handleChange("harness", "cursor")}
                className="h-3.5 w-3.5 border-[var(--stgm-border,#d4d4d8)] text-[var(--stgm-primary,#6366f1)]"
              />
              Cursor
            </label>
          </div>
        </FieldRow>
      </section>

      {/* Message */}
      <section className="flex flex-col gap-2">
        <SectionLabel>Message</SectionLabel>
        <FieldRow label="Prompt" hint="Instructions sent to the agent. Supports ${ } expressions." required>
          <textarea
            value={typeof config.message === "string" ? config.message : ""}
            onChange={(e) => handleChange("message", e.target.value)}
            placeholder="Analyze this data: ${ $context.fetchData.body }"
            rows={4}
            className={`${inputClass} resize-y font-mono border-[var(--stgm-chart-purple,#8b5cf6)]/40`}
            data-testid="agent-call-message-input"
          />
        </FieldRow>
      </section>

      {/* Environment */}
      {envEntries.length > 0 && (
        <section className="flex flex-col gap-2">
          <SectionLabel>Environment</SectionLabel>
          <div className="flex flex-col gap-1.5">
            {envEntries.map(([key, val]) => (
              <div key={key} className="flex items-start gap-1">
                <input
                  type="text"
                  value={key}
                  readOnly
                  className={`${inputClass} w-1/3 bg-[var(--stgm-muted,#f5f5f5)]`}
                />
                <input
                  type="text"
                  value={typeof val === "string" ? val : ""}
                  onChange={(e) => {
                    const env = { ...(config.env as Record<string, unknown> ?? {}) };
                    env[key] = e.target.value || undefined;
                    handleChange("env", env);
                  }}
                  placeholder="value"
                  className={`${inputClass} flex-1`}
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Execution config */}
      <section className="flex flex-col gap-2">
        <SectionLabel>Execution</SectionLabel>
        <FieldRow label="Model" hint="Override the agent's default model">
          <input
            type="text"
            value={typeof execConfig.model === "string" ? execConfig.model : ""}
            onChange={(e) => handleExecConfigChange("model", e.target.value)}
            placeholder="Agent default"
            className={inputClass}
            data-testid="agent-call-model-input"
          />
        </FieldRow>
        <FieldRow label="Timeout" hint="Seconds (1–3600)">
          <input
            type="number"
            value={typeof execConfig.timeout === "number" ? execConfig.timeout : ""}
            onChange={(e) => handleExecConfigChange("timeout", e.target.value ? parseInt(e.target.value, 10) : undefined)}
            placeholder="300"
            min={1}
            max={3600}
            className={inputClass}
          />
        </FieldRow>
        <FieldRow label="Temperature" hint="0.0 (deterministic) to 1.0 (creative)">
          <input
            type="number"
            value={typeof execConfig.temperature === "number" ? execConfig.temperature : ""}
            onChange={(e) => handleExecConfigChange("temperature", e.target.value ? parseFloat(e.target.value) : undefined)}
            placeholder="0.7"
            min={0}
            max={1}
            step={0.1}
            className={inputClass}
          />
        </FieldRow>
        <FieldRow label="Max cost" hint="Per-task cap in micro-USD (1 USD = 1,000,000)">
          <input
            type="number"
            value={typeof execConfig.max_cost_micros === "number" ? execConfig.max_cost_micros : ""}
            onChange={(e) => handleExecConfigChange("max_cost_micros", e.target.value ? parseInt(e.target.value, 10) : undefined)}
            placeholder="No limit"
            min={0}
            className={inputClass}
          />
        </FieldRow>
      </section>

      {/* Structured output */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <SectionLabel>Structured output</SectionLabel>
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={showOutput}
              onChange={toggleOutput}
              className="h-3.5 w-3.5 rounded border-[var(--stgm-border,#d4d4d8)] text-[var(--stgm-primary,#6366f1)]"
            />
            <span className="text-[10px] text-[var(--stgm-muted-foreground,#737373)]">
              {showOutput ? "Enabled" : "Disabled"}
            </span>
          </label>
        </div>

        {showOutput && (
          <div className="flex flex-col gap-2">
            <FieldRow label="Schema" hint="JSON Schema for the agent's structured response">
              <OutputSchemaEditor
                value={outputContract.schema}
                onChange={(v) => handleOutputChange("schema", v)}
              />
            </FieldRow>
            <FieldRow label="On invalid" hint="Policy when output fails schema validation">
              <select
                value={typeof outputContract.on_invalid === "string" ? outputContract.on_invalid : ""}
                onChange={(e) => handleOutputChange("on_invalid", e.target.value || undefined)}
                className={inputClass}
              >
                <option value="">Fail (default)</option>
                <option value="ON_INVALID_RETRY">Retry</option>
                <option value="ON_INVALID_FALLBACK">Fallback</option>
              </select>
            </FieldRow>
            {(outputContract.on_invalid === "ON_INVALID_RETRY") && (
              <FieldRow label="Max retries" hint="1–5 attempts">
                <input
                  type="number"
                  value={typeof outputContract.max_retries === "number" ? outputContract.max_retries : ""}
                  onChange={(e) => handleOutputChange("max_retries", e.target.value ? parseInt(e.target.value, 10) : undefined)}
                  placeholder="1"
                  min={1}
                  max={5}
                  className={inputClass}
                />
              </FieldRow>
            )}
            <FieldRow label="Fallback task" hint="Task to branch to if validation fails">
              <input
                type="text"
                value={typeof outputContract.fallback_task === "string" ? outputContract.fallback_task : ""}
                onChange={(e) => handleOutputChange("fallback_task", e.target.value || undefined)}
                placeholder="Optional"
                className={inputClass}
              />
            </FieldRow>
          </div>
        )}
      </section>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Output schema editor (JSON textarea with parse validation)
// ---------------------------------------------------------------------------

function OutputSchemaEditor({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const strValue = value != null ? JSON.stringify(value, null, 2) : "";
  const [localValue, setLocalValue] = useState(strValue);
  const [parseError, setParseError] = useState<string | null>(null);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const raw = e.target.value;
      setLocalValue(raw);
      if (!raw.trim()) {
        setParseError(null);
        onChange(undefined);
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        setParseError(null);
        onChange(parsed);
      } catch {
        setParseError("Invalid JSON Schema");
      }
    },
    [onChange],
  );

  return (
    <div className="flex flex-col gap-0.5">
      <textarea
        value={localValue}
        onChange={handleChange}
        rows={5}
        className={`${inputClass} resize-y font-mono text-[11px]`}
        placeholder='{ "type": "object", "properties": { ... } }'
      />
      {parseError && (
        <span className="text-[10px] text-[var(--stgm-destructive,#ef4444)]">{parseError}</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

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
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center gap-1 text-[11px] font-medium text-[var(--stgm-foreground,#1a1a2e)]">
        {label}
        {required && <span className="text-[var(--stgm-destructive,#ef4444)]" aria-label="required">*</span>}
      </label>
      {hint && (
        <p className="text-[10px] leading-tight text-[var(--stgm-muted-foreground,#737373)]">{hint}</p>
      )}
      {children}
    </div>
  );
}
