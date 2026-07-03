"use client";

import { memo, useState, useCallback, useMemo } from "react";
import { cn } from "@stigmer/theme";
import type { JsonObject } from "@bufbuild/protobuf";
import type { WorkflowGraphEdge } from "./workflow-graph-model.js";
import { TASK_NAME_PATTERN, TASK_NAME_PATTERN_ERROR } from "./canvas-constants.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OutcomeEntry {
  name: string;
  label: string;
  then: string;
}

interface FormFieldEntry {
  name: string;
  type: "string" | "number" | "boolean" | "enum";
  required: boolean;
  description: string;
  enumValues: string;
}

const TIMEOUT_POLICY_OPTIONS = [
  { value: "HUMAN_INPUT_TIMEOUT_FAIL", label: "Fail — task errors on timeout" },
  { value: "HUMAN_INPUT_TIMEOUT_APPROVE", label: "Auto-approve — proceed as approved" },
  { value: "HUMAN_INPUT_TIMEOUT_DENY", label: "Auto-deny — proceed as denied" },
  { value: "HUMAN_INPUT_TIMEOUT_ESCALATE", label: "Escalate — branch to escalation task" },
] as const;

const TIMEOUT_UNITS = [
  { value: 1, label: "seconds" },
  { value: 60, label: "minutes" },
  { value: 3600, label: "hours" },
  { value: 86400, label: "days" },
] as const;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** Props for {@link ApprovalFormBuilder}. */
export interface ApprovalFormBuilderProps {
  readonly nodeId: string;
  readonly config: JsonObject;
  readonly edges: readonly WorkflowGraphEdge[];
  readonly allTaskNames: readonly string[];
  readonly onUpdateConfig: (fieldPath: string, value: unknown) => void;
  readonly onUpdateBranchRouting: (handleId: string, targetTask: string | undefined) => void;
  readonly onMigrateBranchHandle: (oldHandleId: string, newHandleId: string) => void;
  readonly onRemoveBranchEdges: (handleId: string) => void;
}

/**
 * Specialized inspector editor for `human_input` task nodes.
 *
 * Organized into collapsible sections: Prompt, Outcomes, Form Fields,
 * Timeout, Approvers, and Notification Channels. Outcome routing uses
 * name-based handle IDs (`outcome_{name}`) per AD-T15-B4.
 *
 * @since T15 Batch 4 (Specialized Task Editors)
 */
export const ApprovalFormBuilder = memo(function ApprovalFormBuilder({
  nodeId,
  config,
  edges,
  allTaskNames,
  onUpdateConfig,
  onUpdateBranchRouting,
  onMigrateBranchHandle,
  onRemoveBranchEdges,
}: ApprovalFormBuilderProps) {
  const cfg = config as Record<string, unknown>;

  const routingMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const edge of edges) {
      if (edge.source === nodeId && edge.sourceHandle?.startsWith("outcome_")) {
        map.set(edge.sourceHandle, edge.target);
      }
    }
    return map;
  }, [nodeId, edges]);

  return (
    <div className="flex flex-col">
      <PromptSection
        prompt={typeof cfg.prompt === "string" ? cfg.prompt : ""}
        onUpdate={onUpdateConfig}
      />
      <OutcomesSection
        config={cfg}
        routingMap={routingMap}
        allTaskNames={allTaskNames}
        onUpdateConfig={onUpdateConfig}
        onUpdateBranchRouting={onUpdateBranchRouting}
        onMigrateBranchHandle={onMigrateBranchHandle}
        onRemoveBranchEdges={onRemoveBranchEdges}
      />
      <FormSchemaSection
        formSchema={cfg.form_schema}
        onUpdateConfig={onUpdateConfig}
      />
      <TimeoutSection
        timeout={typeof cfg.timeout === "number" ? cfg.timeout : 0}
        onTimeout={typeof cfg.on_timeout === "string" ? cfg.on_timeout : ""}
        escalationTask={typeof cfg.escalation_task === "string" ? cfg.escalation_task : ""}
        allTaskNames={allTaskNames}
        onUpdateConfig={onUpdateConfig}
      />
      <StringListSection
        title="Approvers"
        fieldPath="approvers"
        values={extractStringList(cfg.approvers)}
        placeholder='e.g., user:jane@acme.com, team:engineering-leads'
        onUpdateConfig={onUpdateConfig}
      />
      <StringListSection
        title="Notification Channels"
        fieldPath="notification_channels"
        values={extractStringList(cfg.notification_channels)}
        placeholder='e.g., slack:#approvals, email:ops@acme.com'
        onUpdateConfig={onUpdateConfig}
      />
    </div>
  );
});

// ---------------------------------------------------------------------------
// PromptSection
// ---------------------------------------------------------------------------

function PromptSection({
  prompt,
  onUpdate,
}: {
  prompt: string;
  onUpdate: (fieldPath: string, value: unknown) => void;
}) {
  return (
    <CollapsibleSection title="Prompt" defaultOpen>
      <textarea
        value={prompt}
        onChange={(e) => onUpdate("prompt", e.target.value || undefined)}
        placeholder="${ $context.ticket.id } needs approval — review and decide."
        rows={3}
        className={cn(inputClass, "resize-y font-mono")}
        aria-label="Prompt message"
      />
    </CollapsibleSection>
  );
}

// ---------------------------------------------------------------------------
// OutcomesSection
// ---------------------------------------------------------------------------

function OutcomesSection({
  config,
  routingMap,
  allTaskNames,
  onUpdateConfig,
  onUpdateBranchRouting,
  onMigrateBranchHandle,
  onRemoveBranchEdges,
}: {
  config: Record<string, unknown>;
  routingMap: Map<string, string>;
  allTaskNames: readonly string[];
  onUpdateConfig: (fieldPath: string, value: unknown) => void;
  onUpdateBranchRouting: (handleId: string, targetTask: string | undefined) => void;
  onMigrateBranchHandle: (oldHandleId: string, newHandleId: string) => void;
  onRemoveBranchEdges: (handleId: string) => void;
}) {
  const outcomes = extractOutcomes(config);

  const commitOutcomes = useCallback(
    (updated: OutcomeEntry[]) => {
      onUpdateConfig(
        "outcomes",
        updated.length === 0
          ? undefined
          : updated.map((o) => ({
              name: o.name,
              ...(o.label && { label: o.label }),
              ...(o.then && { then: o.then }),
            })),
      );
    },
    [onUpdateConfig],
  );

  const handleAdd = useCallback(() => {
    const existing = new Set(outcomes.map((o) => o.name));
    let n = outcomes.length + 1;
    while (existing.has(`outcome_${n}`)) n++;
    commitOutcomes([...outcomes, { name: `outcome_${n}`, label: "", then: "" }]);
  }, [outcomes, commitOutcomes]);

  const handleRemove = useCallback(
    (idx: number) => {
      const removed = outcomes[idx];
      onRemoveBranchEdges(`outcome_${removed.name}`);
      commitOutcomes(outcomes.filter((_, i) => i !== idx));
    },
    [outcomes, commitOutcomes, onRemoveBranchEdges],
  );

  const handleMove = useCallback(
    (idx: number, direction: -1 | 1) => {
      const targetIdx = idx + direction;
      if (targetIdx < 0 || targetIdx >= outcomes.length) return;
      const updated = [...outcomes];
      [updated[idx], updated[targetIdx]] = [updated[targetIdx], updated[idx]];
      commitOutcomes(updated);
    },
    [outcomes, commitOutcomes],
  );

  const handleNameChange = useCallback(
    (idx: number, newName: string) => {
      const oldName = outcomes[idx].name;
      if (oldName === newName) return;
      const updated = [...outcomes];
      updated[idx] = { ...updated[idx], name: newName };
      commitOutcomes(updated);
      if (oldName) {
        onMigrateBranchHandle(`outcome_${oldName}`, `outcome_${newName}`);
      }
    },
    [outcomes, commitOutcomes, onMigrateBranchHandle],
  );

  const handleLabelChange = useCallback(
    (idx: number, label: string) => {
      const updated = [...outcomes];
      updated[idx] = { ...updated[idx], label };
      commitOutcomes(updated);
    },
    [outcomes, commitOutcomes],
  );

  const handleThenChange = useCallback(
    (idx: number, targetTask: string) => {
      const outcomeName = outcomes[idx].name;
      onUpdateBranchRouting(`outcome_${outcomeName}`, targetTask || undefined);
    },
    [outcomes, onUpdateBranchRouting],
  );

  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);

  const handleDragStart = useCallback((idx: number) => { setDragIdx(idx); }, []);
  const handleDragOver = useCallback((idx: number) => { setDropIdx(idx); }, []);
  const handleDrop = useCallback(() => {
    if (dragIdx != null && dropIdx != null && dragIdx !== dropIdx) {
      const updated = [...outcomes];
      const [moved] = updated.splice(dragIdx, 1);
      updated.splice(dropIdx, 0, moved);
      commitOutcomes(updated);
    }
    setDragIdx(null);
    setDropIdx(null);
  }, [dragIdx, dropIdx, outcomes, commitOutcomes]);
  const handleDragEnd = useCallback(() => { setDragIdx(null); setDropIdx(null); }, []);

  return (
    <CollapsibleSection title="Outcomes">
      {outcomes.length === 0 && (
        <p className="py-1 text-[11px] text-[var(--stgm-muted-foreground,#737373)]">
          No custom outcomes. Default: binary Approve / Deny.
        </p>
      )}

      <div className="flex flex-col gap-2">
        {outcomes.map((o, idx) => {
          const routeTarget = routingMap.get(`outcome_${o.name}`) ?? "";
          return (
            <OutcomeEntry
              key={`${o.name}_${idx}`}
              outcome={o}
              index={idx}
              total={outcomes.length}
              routeTarget={routeTarget}
              allTaskNames={allTaskNames}
              allOutcomeNames={outcomes.map((x) => x.name)}
              onNameChange={(name) => handleNameChange(idx, name)}
              onLabelChange={(label) => handleLabelChange(idx, label)}
              onThenChange={(then) => handleThenChange(idx, then)}
              onMoveUp={() => handleMove(idx, -1)}
              onMoveDown={() => handleMove(idx, 1)}
              onRemove={() => handleRemove(idx)}
              isDragOver={dropIdx === idx && dragIdx !== idx}
              onDragStart={() => handleDragStart(idx)}
              onDragOver={() => handleDragOver(idx)}
              onDrop={handleDrop}
              onDragEnd={handleDragEnd}
            />
          );
        })}
      </div>

      <button
        type="button"
        onClick={handleAdd}
        className="mt-1 self-start text-[11px] font-medium text-[var(--stgm-primary,#6366f1)] hover:underline"
      >
        + Add outcome
      </button>
    </CollapsibleSection>
  );
}

function OutcomeEntry({
  outcome,
  index,
  total,
  routeTarget,
  allTaskNames,
  allOutcomeNames,
  onNameChange,
  onLabelChange,
  onThenChange,
  onMoveUp,
  onMoveDown,
  onRemove,
  isDragOver,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  outcome: OutcomeEntry;
  index: number;
  total: number;
  routeTarget: string;
  allTaskNames: readonly string[];
  allOutcomeNames: string[];
  onNameChange: (name: string) => void;
  onLabelChange: (label: string) => void;
  onThenChange: (then: string) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  isDragOver: boolean;
  onDragStart: () => void;
  onDragOver: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
}) {
  const [editingName, setEditingName] = useState(outcome.name);
  const [nameError, setNameError] = useState<string | null>(null);

  const validateAndCommit = useCallback(() => {
    const trimmed = editingName.trim();
    if (!trimmed) { setNameError("Name required"); return; }
    if (!TASK_NAME_PATTERN.test(trimmed)) {
      setNameError(TASK_NAME_PATTERN_ERROR);
      return;
    }
    if (allOutcomeNames.some((n, i) => i !== index && n === trimmed)) {
      setNameError("Duplicate name");
      return;
    }
    setNameError(null);
    onNameChange(trimmed);
  }, [editingName, allOutcomeNames, index, onNameChange]);

  const handleDragOverEvent = useCallback(
    (e: React.DragEvent) => { e.preventDefault(); onDragOver(); },
    [onDragOver],
  );

  return (
    <div
      onDragOver={handleDragOverEvent}
      onDrop={onDrop}
      className={cn(
        "flex flex-col gap-1 rounded-md border border-[var(--stgm-border,#e5e5e5)] p-2 transition-[border-color]",
        isDragOver && "border-[var(--stgm-primary,#6366f1)]",
      )}
    >
      <div className="flex items-center gap-1">
        <DragGrip onDragStart={onDragStart} onDragEnd={onDragEnd} />
        <input
          type="text"
          value={editingName}
          onChange={(e) => { setEditingName(e.target.value); setNameError(null); }}
          onBlur={validateAndCommit}
          onKeyDown={(e) => { if (e.key === "Enter") validateAndCommit(); }}
          placeholder="outcome_name"
          className="min-w-0 flex-1 rounded border border-[var(--stgm-border,#d4d4d8)] bg-[var(--stgm-background,#fff)] px-1.5 py-1 text-xs font-medium text-[var(--stgm-foreground,#1a1a2e)] focus:outline-none focus:ring-1 focus:ring-[var(--stgm-ring,#3b82f6)]"
          aria-label={`Outcome ${index + 1} name`}
        />
        <div className="flex shrink-0 items-center">
          <ArrowButton direction="up" disabled={index === 0} onClick={onMoveUp} />
          <ArrowButton direction="down" disabled={index === total - 1} onClick={onMoveDown} />
          <button
            type="button"
            onClick={onRemove}
            className="ml-0.5 text-[10px] text-[var(--stgm-destructive,#ef4444)] hover:underline"
            aria-label={`Remove outcome ${outcome.name}`}
          >
            ✕
          </button>
        </div>
      </div>
      {nameError && <span className="text-[10px] text-[var(--stgm-destructive,#ef4444)]">{nameError}</span>}

      <input
        type="text"
        value={outcome.label}
        onChange={(e) => onLabelChange(e.target.value)}
        placeholder={capitalize(outcome.name)}
        className={cn(smallInputClass)}
        aria-label={`Label for outcome ${outcome.name}`}
      />

      <select
        value={routeTarget}
        onChange={(e) => onThenChange(e.target.value)}
        className={cn(smallInputClass)}
        aria-label={`Target task for outcome ${outcome.name}`}
      >
        <option value="">— Continue (next task) —</option>
        {allTaskNames.map((name) => (
          <option key={name} value={name}>{name}</option>
        ))}
      </select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FormSchemaSection
// ---------------------------------------------------------------------------

function FormSchemaSection({
  formSchema,
  onUpdateConfig,
}: {
  formSchema: unknown;
  onUpdateConfig: (fieldPath: string, value: unknown) => void;
}) {
  const [rawMode, setRawMode] = useState(false);
  const fields = useMemo(() => schemaToFields(formSchema), [formSchema]);

  const commitFields = useCallback(
    (updated: FormFieldEntry[]) => {
      onUpdateConfig("form_schema", fieldsToSchema(updated));
    },
    [onUpdateConfig],
  );

  const handleAdd = useCallback(() => {
    const existing = new Set(fields.map((f) => f.name));
    let n = fields.length + 1;
    while (existing.has(`field_${n}`)) n++;
    commitFields([...fields, { name: `field_${n}`, type: "string", required: false, description: "", enumValues: "" }]);
  }, [fields, commitFields]);

  const handleRemove = useCallback(
    (idx: number) => commitFields(fields.filter((_, i) => i !== idx)),
    [fields, commitFields],
  );

  const handleUpdate = useCallback(
    (idx: number, patch: Partial<FormFieldEntry>) => {
      const updated = [...fields];
      updated[idx] = { ...updated[idx], ...patch };
      commitFields(updated);
    },
    [fields, commitFields],
  );

  const handleRawChange = useCallback(
    (rawJson: string) => {
      try {
        const parsed = JSON.parse(rawJson);
        onUpdateConfig("form_schema", parsed);
      } catch { /* ignore invalid JSON while typing */ }
    },
    [onUpdateConfig],
  );

  return (
    <CollapsibleSection title="Form Fields">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] text-[var(--stgm-muted-foreground,#737373)]">
          {rawMode ? "Raw JSON Schema" : "Visual builder"}
        </span>
        <button
          type="button"
          onClick={() => setRawMode(!rawMode)}
          className="text-[10px] text-[var(--stgm-primary,#6366f1)] hover:underline"
        >
          {rawMode ? "Visual" : "Raw JSON"}
        </button>
      </div>

      {rawMode ? (
        <textarea
          value={formSchema != null ? JSON.stringify(formSchema, null, 2) : ""}
          onChange={(e) => handleRawChange(e.target.value)}
          rows={8}
          className={cn(inputClass, "resize-y font-mono text-[11px]")}
          placeholder='{ "type": "object", "properties": { ... } }'
        />
      ) : (
        <>
          {fields.length === 0 && (
            <p className="py-1 text-[11px] text-[var(--stgm-muted-foreground,#737373)]">
              No form fields. Reviewer sees only outcome buttons.
            </p>
          )}
          <div className="flex flex-col gap-1.5">
            {fields.map((field, idx) => (
              <FormFieldRow
                key={`${field.name}_${idx}`}
                field={field}
                index={idx}
                onUpdate={(patch) => handleUpdate(idx, patch)}
                onRemove={() => handleRemove(idx)}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={handleAdd}
            className="mt-1 self-start text-[11px] font-medium text-[var(--stgm-primary,#6366f1)] hover:underline"
          >
            + Add field
          </button>
        </>
      )}
    </CollapsibleSection>
  );
}

function FormFieldRow({
  field,
  index,
  onUpdate,
  onRemove,
}: {
  field: FormFieldEntry;
  index: number;
  onUpdate: (patch: Partial<FormFieldEntry>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-col gap-1 rounded border border-[var(--stgm-border,#e5e5e5)] p-1.5">
      <div className="flex items-center gap-1">
        <input
          type="text"
          value={field.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          placeholder="field_name"
          className="min-w-0 flex-1 rounded border border-[var(--stgm-border,#d4d4d8)] bg-[var(--stgm-background,#fff)] px-1 py-0.5 text-[11px] text-[var(--stgm-foreground,#1a1a2e)] focus:outline-none focus:ring-1 focus:ring-[var(--stgm-ring,#3b82f6)]"
          aria-label={`Field ${index + 1} name`}
        />
        <select
          value={field.type}
          onChange={(e) => onUpdate({ type: e.target.value as FormFieldEntry["type"] })}
          className="rounded border border-[var(--stgm-border,#d4d4d8)] bg-[var(--stgm-background,#fff)] px-1 py-0.5 text-[11px] text-[var(--stgm-foreground,#1a1a2e)] focus:outline-none focus:ring-1 focus:ring-[var(--stgm-ring,#3b82f6)]"
          aria-label={`Type for field ${field.name}`}
        >
          <option value="string">string</option>
          <option value="number">number</option>
          <option value="boolean">boolean</option>
          <option value="enum">enum</option>
        </select>
        <label className="flex shrink-0 cursor-pointer items-center gap-0.5 text-[10px] text-[var(--stgm-muted-foreground,#737373)]">
          <input
            type="checkbox"
            checked={field.required}
            onChange={(e) => onUpdate({ required: e.target.checked })}
            className="h-3 w-3"
          />
          Req
        </label>
        <button
          type="button"
          onClick={onRemove}
          className="text-[10px] text-[var(--stgm-destructive,#ef4444)] hover:underline"
          aria-label={`Remove field ${field.name}`}
        >
          ✕
        </button>
      </div>
      <input
        type="text"
        value={field.description}
        onChange={(e) => onUpdate({ description: e.target.value })}
        placeholder="Description (optional)"
        className="rounded border border-[var(--stgm-border,#d4d4d8)] bg-[var(--stgm-background,#fff)] px-1 py-0.5 text-[10px] text-[var(--stgm-foreground,#1a1a2e)] placeholder:text-[var(--stgm-muted-foreground,#a3a3a3)] focus:outline-none focus:ring-1 focus:ring-[var(--stgm-ring,#3b82f6)]"
      />
      {field.type === "enum" && (
        <input
          type="text"
          value={field.enumValues}
          onChange={(e) => onUpdate({ enumValues: e.target.value })}
          placeholder="P1, P2, P3 (comma-separated)"
          className="rounded border border-[var(--stgm-border,#d4d4d8)] bg-[var(--stgm-background,#fff)] px-1 py-0.5 text-[10px] font-mono text-[var(--stgm-foreground,#1a1a2e)] placeholder:text-[var(--stgm-muted-foreground,#a3a3a3)] focus:outline-none focus:ring-1 focus:ring-[var(--stgm-ring,#3b82f6)]"
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TimeoutSection
// ---------------------------------------------------------------------------

function TimeoutSection({
  timeout,
  onTimeout,
  escalationTask,
  allTaskNames,
  onUpdateConfig,
}: {
  timeout: number;
  onTimeout: string;
  escalationTask: string;
  allTaskNames: readonly string[];
  onUpdateConfig: (fieldPath: string, value: unknown) => void;
}) {
  const bestUnit = useMemo(() => {
    if (timeout <= 0) return 1;
    for (let i = TIMEOUT_UNITS.length - 1; i >= 0; i--) {
      if (timeout % TIMEOUT_UNITS[i].value === 0) return TIMEOUT_UNITS[i].value;
    }
    return 1;
  }, [timeout]);

  const [unit, setUnit] = useState<number>(bestUnit);
  const displayValue = timeout > 0 ? Math.round(timeout / unit) : "";

  const handleValueChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      if (raw === "") {
        onUpdateConfig("timeout", 0);
        return;
      }
      const n = parseInt(raw, 10);
      if (!isNaN(n) && n >= 0) onUpdateConfig("timeout", n * unit);
    },
    [unit, onUpdateConfig],
  );

  const handleUnitChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const newUnit = Number(e.target.value);
      setUnit(newUnit);
      if (timeout > 0) {
        const currentValue = Math.round(timeout / unit);
        onUpdateConfig("timeout", currentValue * newUnit);
      }
    },
    [timeout, unit, onUpdateConfig],
  );

  const isEscalate = onTimeout === "HUMAN_INPUT_TIMEOUT_ESCALATE";

  return (
    <CollapsibleSection title="Timeout">
      <div className="flex items-center gap-1">
        <input
          type="number"
          value={displayValue}
          onChange={handleValueChange}
          placeholder="0"
          min={0}
          className={cn(smallInputClass, "w-16")}
          aria-label="Timeout duration"
        />
        <select
          value={unit}
          onChange={handleUnitChange}
          className={cn(smallInputClass, "w-20")}
          aria-label="Timeout unit"
        >
          {TIMEOUT_UNITS.map((u) => (
            <option key={u.value} value={u.value}>{u.label}</option>
          ))}
        </select>
      </div>

      {timeout > 0 && (
        <div className="mt-1.5 flex flex-col gap-1">
          <label className="text-[10px] text-[var(--stgm-muted-foreground,#737373)]">
            On timeout
          </label>
          <select
            value={onTimeout}
            onChange={(e) => onUpdateConfig("on_timeout", e.target.value || undefined)}
            className={cn(smallInputClass)}
            aria-label="Timeout policy"
          >
            <option value="">— Default (fail) —</option>
            {TIMEOUT_POLICY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      )}

      {isEscalate && (
        <div className="mt-1.5 flex flex-col gap-1">
          <label className="text-[10px] text-[var(--stgm-muted-foreground,#737373)]">
            Escalation task
          </label>
          <select
            value={escalationTask}
            onChange={(e) => onUpdateConfig("escalation_task", e.target.value || undefined)}
            className={cn(smallInputClass)}
            aria-label="Escalation target task"
          >
            <option value="">— Select escalation task —</option>
            {allTaskNames.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </div>
      )}
    </CollapsibleSection>
  );
}

// ---------------------------------------------------------------------------
// StringListSection
// ---------------------------------------------------------------------------

function StringListSection({
  title,
  fieldPath,
  values,
  placeholder,
  onUpdateConfig,
}: {
  title: string;
  fieldPath: string;
  values: string[];
  placeholder: string;
  onUpdateConfig: (fieldPath: string, value: unknown) => void;
}) {
  const commit = useCallback(
    (updated: string[]) => {
      onUpdateConfig(fieldPath, updated.length > 0 ? updated : undefined);
    },
    [fieldPath, onUpdateConfig],
  );

  const handleAdd = useCallback(() => {
    commit([...values, ""]);
  }, [values, commit]);

  const handleRemove = useCallback(
    (idx: number) => commit(values.filter((_, i) => i !== idx)),
    [values, commit],
  );

  const handleChange = useCallback(
    (idx: number, val: string) => {
      const updated = [...values];
      updated[idx] = val;
      commit(updated);
    },
    [values, commit],
  );

  return (
    <CollapsibleSection title={title}>
      <div className="flex flex-col gap-1">
        {values.map((val, idx) => (
          <div key={idx} className="flex items-center gap-1">
            <input
              type="text"
              value={val}
              onChange={(e) => handleChange(idx, e.target.value)}
              placeholder={placeholder}
              className={cn(smallInputClass, "flex-1")}
              aria-label={`${title} entry ${idx + 1}`}
            />
            <button
              type="button"
              onClick={() => handleRemove(idx)}
              className="text-[10px] text-[var(--stgm-destructive,#ef4444)] hover:underline"
              aria-label={`Remove ${title.toLowerCase()} entry ${idx + 1}`}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={handleAdd}
        className="mt-1 self-start text-[11px] font-medium text-[var(--stgm-primary,#6366f1)] hover:underline"
      >
        + Add entry
      </button>
    </CollapsibleSection>
  );
}

// ---------------------------------------------------------------------------
// CollapsibleSection
// ---------------------------------------------------------------------------

function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-[var(--stgm-border,#e5e5e5)] last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs font-semibold text-[var(--stgm-foreground,#1a1a2e)] hover:bg-[var(--stgm-muted,#f5f5f5)]"
        aria-expanded={open}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn("transition-transform", open && "rotate-90")}
        >
          <path d="M6 4l4 4-4 4" />
        </svg>
        {title}
      </button>
      {open && <div className="flex flex-col gap-1.5 px-3 pb-3">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DragGrip
// ---------------------------------------------------------------------------

function DragGrip({
  onDragStart,
  onDragEnd,
}: {
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className="flex shrink-0 cursor-grab items-center text-[var(--stgm-muted-foreground,#a3a3a3)] hover:text-[var(--stgm-foreground,#1a1a2e)] active:cursor-grabbing"
      aria-label="Drag to reorder"
    >
      <svg width="8" height="14" viewBox="0 0 8 14" fill="currentColor">
        <circle cx="2" cy="2" r="1" />
        <circle cx="6" cy="2" r="1" />
        <circle cx="2" cy="7" r="1" />
        <circle cx="6" cy="7" r="1" />
        <circle cx="2" cy="12" r="1" />
        <circle cx="6" cy="12" r="1" />
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ArrowButton (shared with BranchConditionBuilder pattern)
// ---------------------------------------------------------------------------

function ArrowButton({
  direction,
  disabled,
  onClick,
}: {
  direction: "up" | "down";
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="px-0.5 py-0.5 text-[var(--stgm-muted-foreground,#737373)] hover:text-[var(--stgm-foreground,#1a1a2e)] disabled:opacity-30"
      aria-label={`Move ${direction}`}
    >
      <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {direction === "up" ? <path d="M4 10l4-4 4 4" /> : <path d="M4 6l4 4 4-4" />}
      </svg>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const inputClass =
  "w-full rounded-md border border-[var(--stgm-border,#d4d4d8)] bg-[var(--stgm-background,#fff)] px-2 py-1.5 text-xs text-[var(--stgm-foreground,#1a1a2e)] placeholder:text-[var(--stgm-muted-foreground,#a3a3a3)] focus:outline-none focus:ring-1 focus:ring-[var(--stgm-ring,#3b82f6)]";

const smallInputClass =
  "w-full rounded border border-[var(--stgm-border,#d4d4d8)] bg-[var(--stgm-background,#fff)] px-1.5 py-1 text-xs text-[var(--stgm-foreground,#1a1a2e)] placeholder:text-[var(--stgm-muted-foreground,#a3a3a3)] focus:outline-none focus:ring-1 focus:ring-[var(--stgm-ring,#3b82f6)]";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractOutcomes(config: Record<string, unknown>): OutcomeEntry[] {
  const raw = config.outcomes;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((o): o is Record<string, unknown> => o != null && typeof o === "object")
    .map((o) => ({
      name: typeof o.name === "string" ? o.name : "",
      label: typeof o.label === "string" ? o.label : "",
      then: typeof o.then === "string" ? o.then : "",
    }));
}

function extractStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function capitalize(str: string): string {
  return str.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function schemaToFields(schema: unknown): FormFieldEntry[] {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return [];
  const obj = schema as Record<string, unknown>;
  const properties = obj.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return [];

  const requiredSet = new Set(
    Array.isArray(obj.required) ? obj.required.filter((r): r is string => typeof r === "string") : [],
  );

  return Object.entries(properties as Record<string, unknown>)
    .filter(([, v]) => v && typeof v === "object" && !Array.isArray(v))
    .map(([name, v]) => {
      const prop = v as Record<string, unknown>;
      const hasEnum = Array.isArray(prop.enum);
      let type: FormFieldEntry["type"] = "string";
      if (hasEnum) {
        type = "enum";
      } else if (prop.type === "number" || prop.type === "integer") {
        type = "number";
      } else if (prop.type === "boolean") {
        type = "boolean";
      }

      return {
        name,
        type,
        required: requiredSet.has(name),
        description: typeof prop.description === "string" ? prop.description : "",
        enumValues: hasEnum ? (prop.enum as unknown[]).map(String).join(", ") : "",
      };
    });
}

function fieldsToSchema(fields: FormFieldEntry[]): Record<string, unknown> | undefined {
  if (fields.length === 0) return undefined;

  const properties: Record<string, Record<string, unknown>> = {};
  const required: string[] = [];

  for (const field of fields) {
    if (!field.name.trim()) continue;

    const prop: Record<string, unknown> = {};

    if (field.type === "enum") {
      prop.type = "string";
      const vals = field.enumValues.split(",").map((v) => v.trim()).filter(Boolean);
      if (vals.length > 0) prop.enum = vals;
    } else if (field.type === "number") {
      prop.type = "number";
    } else if (field.type === "boolean") {
      prop.type = "boolean";
    } else {
      prop.type = "string";
    }

    if (field.description) prop.description = field.description;
    if (field.required) required.push(field.name);

    properties[field.name] = prop;
  }

  return {
    type: "object",
    properties,
    ...(required.length > 0 && { required }),
  };
}
