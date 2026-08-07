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
 * harness selection, message prompt, environment variables, run config
 * (model, budget per run), and structured output.
 *
 * The run config edits the shared `run_config` block (the
 * agentexecution RunConfig vocabulary, stigmer/stigmer#358): model
 * override plus a per-run USD budget that the runner actually
 * enforces. `max_tool_rounds` is API-reachable but deliberately absent
 * from the form (DD-018 D-5: an implementation knob, not a user
 * concept). Assembly follows the schedule form's empty-means-omit rule:
 * a blank field must not become a zero override.
 *
 * Workspace and environments edit the shared vocabulary's
 * `workspace_entries` (git-only at this surface) and `environment_refs`
 * as controlled structured rows. The schedule form's richer components
 * (WorkspaceEditor with the GitHub repo picker, EnvironmentPicker) are
 * data-connected and need org context this inspector tree does not
 * carry yet — adopting them here is a named follow-up, not a silent
 * divergence.
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
  const runConfig = (config.run_config ?? {}) as Record<string, unknown>;
  const outputContract = (config.output ?? {}) as Record<string, unknown>;
  const hasOutput = Object.keys(outputContract).length > 0;
  const [showOutput, setShowOutput] = useState(hasOutput);

  const handleChange = useCallback(
    (field: string, value: unknown) => {
      onFieldChange(field, value === "" ? undefined : value);
    },
    [onFieldChange],
  );

  const handleRunConfigChange = useCallback(
    (field: string, value: unknown) => {
      const next: Record<string, unknown> = {
        ...runConfig,
        [field]: value === "" ? undefined : value,
      };
      for (const key of Object.keys(next)) {
        if (next[key] === undefined) delete next[key];
      }
      onFieldChange("run_config", Object.keys(next).length > 0 ? next : undefined);
    },
    [runConfig, onFieldChange],
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

      {/* Run config */}
      <section className="flex flex-col gap-2">
        <SectionLabel>Execution</SectionLabel>
        <FieldRow label="Model" hint="Override the agent's default model">
          <input
            type="text"
            value={typeof runConfig.model_name === "string" ? runConfig.model_name : ""}
            onChange={(e) => handleRunConfigChange("model_name", e.target.value)}
            placeholder="Agent default"
            className={inputClass}
            data-testid="agent-call-model-input"
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
            data-testid="agent-call-budget-input"
          />
        </FieldRow>
      </section>

      {/* Workspace (git-only at this surface) */}
      <WorkspaceEntriesSection
        entries={config.workspace_entries}
        onChange={(entries) => onFieldChange("workspace_entries", entries)}
      />

      {/* Environments */}
      <EnvironmentRefsSection
        refs={config.environment_refs}
        onChange={(refs) => onFieldChange("environment_refs", refs)}
      />

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
// Workspace entries (git-only structured rows)
// ---------------------------------------------------------------------------

interface WorkspaceEntryRow {
  readonly name?: string;
  readonly source?: { readonly git_repo?: { readonly url?: string; readonly branch?: string } };
}

/**
 * Edits `workspace_entries` as structured URL + branch rows. Only git
 * sources exist at this surface (write-time validation rejects
 * local_path — no client is connected when a workflow task fires), so
 * the row model is deliberately git-shaped. Private repos need an
 * org-visibility Environment holding GITHUB_TOKEN bound under
 * Environments below (DD-018 D-4).
 */
function WorkspaceEntriesSection({
  entries,
  onChange,
}: {
  entries: unknown;
  onChange: (entries: WorkspaceEntryRow[] | undefined) => void;
}) {
  const rows = useMemo<readonly WorkspaceEntryRow[]>(
    () => (Array.isArray(entries) ? (entries as WorkspaceEntryRow[]) : []),
    [entries],
  );

  const commit = useCallback(
    (next: WorkspaceEntryRow[]) => {
      onChange(next.length > 0 ? next : undefined);
    },
    [onChange],
  );

  const updateRow = useCallback(
    (index: number, url: string, branch: string) => {
      const next = rows.map((row, i) => {
        if (i !== index) return row;
        const gitRepo: { url: string; branch?: string } = { url };
        if (branch) gitRepo.branch = branch;
        return { ...(row.name ? { name: row.name } : {}), source: { git_repo: gitRepo } };
      });
      commit([...next]);
    },
    [rows, commit],
  );

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <SectionLabel>Workspace</SectionLabel>
        <button
          type="button"
          onClick={() => commit([...rows, { source: { git_repo: { url: "" } } }])}
          className="text-[10px] font-medium text-[var(--stgm-primary,#6366f1)]"
          data-testid="agent-call-workspace-add"
        >
          + Add repository
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="text-[10px] leading-tight text-[var(--stgm-muted-foreground,#737373)]">
          Git repositories the agent works on. Private repos need an org-shared
          environment holding GITHUB_TOKEN bound under Environments.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {rows.map((row, i) => {
            const gitRepo = row.source?.git_repo ?? {};
            return (
              <div key={i} className="flex items-start gap-1">
                <input
                  type="text"
                  value={gitRepo.url ?? ""}
                  onChange={(e) => updateRow(i, e.target.value, gitRepo.branch ?? "")}
                  placeholder="https://github.com/org/repo"
                  className={`${inputClass} flex-1`}
                  data-testid={`agent-call-workspace-url-${i}`}
                />
                <input
                  type="text"
                  value={gitRepo.branch ?? ""}
                  onChange={(e) => updateRow(i, gitRepo.url ?? "", e.target.value)}
                  placeholder="branch"
                  className={`${inputClass} w-1/4`}
                  data-testid={`agent-call-workspace-branch-${i}`}
                />
                <button
                  type="button"
                  onClick={() => commit(rows.filter((_, j) => j !== i))}
                  aria-label={`Remove workspace entry ${i + 1}`}
                  className="mt-1 text-[var(--stgm-muted-foreground,#737373)] hover:text-[var(--stgm-destructive,#ef4444)]"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Environment references (structured rows)
// ---------------------------------------------------------------------------

interface EnvironmentRefRow {
  readonly org?: string;
  readonly slug?: string;
  readonly kind?: string;
}

/**
 * Edits `environment_refs` as slug rows (org optional — empty means the
 * workflow's own org). These are how a tool-using agent becomes callable
 * from a workflow: the task binds the credentials its child runs need
 * without touching the agent. Resolved server-side at execution create;
 * an unresolvable ref fails the run closed.
 */
function EnvironmentRefsSection({
  refs,
  onChange,
}: {
  refs: unknown;
  onChange: (refs: EnvironmentRefRow[] | undefined) => void;
}) {
  const rows = useMemo<readonly EnvironmentRefRow[]>(
    () => (Array.isArray(refs) ? (refs as EnvironmentRefRow[]) : []),
    [refs],
  );

  const commit = useCallback(
    (next: EnvironmentRefRow[]) => {
      onChange(next.length > 0 ? next : undefined);
    },
    [onChange],
  );

  const updateRow = useCallback(
    (index: number, field: "org" | "slug", value: string) => {
      const next = rows.map((row, i) => {
        if (i !== index) return row;
        const updated: Record<string, string> = {};
        const org = field === "org" ? value : row.org ?? "";
        const slug = field === "slug" ? value : row.slug ?? "";
        if (org) updated.org = org;
        updated.slug = slug;
        return updated as EnvironmentRefRow;
      });
      commit([...next]);
    },
    [rows, commit],
  );

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <SectionLabel>Environments</SectionLabel>
        <button
          type="button"
          onClick={() => commit([...rows, { slug: "" }])}
          className="text-[10px] font-medium text-[var(--stgm-primary,#6366f1)]"
          data-testid="agent-call-envref-add"
        >
          + Bind environment
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="text-[10px] leading-tight text-[var(--stgm-muted-foreground,#737373)]">
          Environment resources whose values are provided to this call&apos;s runs
          — credentials bind here, not on the agent.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {rows.map((row, i) => (
            <div key={i} className="flex items-start gap-1">
              <input
                type="text"
                value={row.org ?? ""}
                onChange={(e) => updateRow(i, "org", e.target.value)}
                placeholder="org (optional)"
                className={`${inputClass} w-1/3`}
                data-testid={`agent-call-envref-org-${i}`}
              />
              <input
                type="text"
                value={row.slug ?? ""}
                onChange={(e) => updateRow(i, "slug", e.target.value)}
                placeholder="environment slug"
                className={`${inputClass} flex-1`}
                data-testid={`agent-call-envref-slug-${i}`}
              />
              <button
                type="button"
                onClick={() => commit(rows.filter((_, j) => j !== i))}
                aria-label={`Remove environment reference ${i + 1}`}
                className="mt-1 text-[var(--stgm-muted-foreground,#737373)] hover:text-[var(--stgm-destructive,#ef4444)]"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

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
