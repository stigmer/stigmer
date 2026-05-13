"use client";

import { memo, useState, useCallback, useRef } from "react";
import { cn } from "@stigmer/theme";
import type { JsonObject } from "@bufbuild/protobuf";
import type { WorkflowGraphEdge } from "./workflow-graph-model";

interface SwitchCaseEntry {
  name: string;
  when: string;
  then: string;
}

/** Props for {@link BranchConditionBuilder}. */
export interface BranchConditionBuilderProps {
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
 * Specialized inspector editor for `switch_case` task nodes.
 *
 * Renders an ordered list of conditional branches with name, condition
 * expression (`when`), and target task routing. Handles are name-based
 * (`case_{name}`) per AD-T15-B4, making reorder operations safe without
 * edge remapping.
 *
 * Edges are the source of truth for routing — the builder reads target
 * tasks from graph edges and writes routing changes via
 * `onUpdateBranchRouting`.
 *
 * @since T15 Batch 4 (Specialized Task Editors)
 */
export const BranchConditionBuilder = memo(function BranchConditionBuilder({
  nodeId,
  config,
  edges,
  allTaskNames,
  onUpdateConfig,
  onUpdateBranchRouting,
  onMigrateBranchHandle,
  onRemoveBranchEdges,
}: BranchConditionBuilderProps) {
  const cases = extractCases(config);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);

  const routingMap = buildRoutingMap(nodeId, edges, "case_");

  const commitCases = useCallback(
    (updated: SwitchCaseEntry[]) => {
      onUpdateConfig("cases", updated.map((c) => ({
        name: c.name,
        ...(c.when && { when: c.when }),
        ...(c.then && { then: c.then }),
      })));
    },
    [onUpdateConfig],
  );

  const handleAddCase = useCallback(() => {
    const existingNames = new Set(cases.map((c) => c.name));
    let n = cases.length + 1;
    while (existingNames.has(`case_${n}`)) n++;
    const newCase: SwitchCaseEntry = { name: `case_${n}`, when: "", then: "" };
    commitCases([...cases, newCase]);
  }, [cases, commitCases]);

  const handleRemoveCase = useCallback(
    (idx: number) => {
      if (cases.length <= 1) return;
      const removed = cases[idx];
      onRemoveBranchEdges(`case_${removed.name}`);
      commitCases(cases.filter((_, i) => i !== idx));
    },
    [cases, commitCases, onRemoveBranchEdges],
  );

  const handleMoveCase = useCallback(
    (idx: number, direction: -1 | 1) => {
      const targetIdx = idx + direction;
      if (targetIdx < 0 || targetIdx >= cases.length) return;
      const updated = [...cases];
      [updated[idx], updated[targetIdx]] = [updated[targetIdx], updated[idx]];
      commitCases(updated);
    },
    [cases, commitCases],
  );

  const handleNameChange = useCallback(
    (idx: number, newName: string) => {
      const oldName = cases[idx].name;
      if (oldName === newName) return;
      const updated = [...cases];
      updated[idx] = { ...updated[idx], name: newName };
      commitCases(updated);
      if (oldName) {
        onMigrateBranchHandle(`case_${oldName}`, `case_${newName}`);
      }
    },
    [cases, commitCases, onMigrateBranchHandle],
  );

  const handleWhenChange = useCallback(
    (idx: number, when: string) => {
      const updated = [...cases];
      updated[idx] = { ...updated[idx], when };
      commitCases(updated);
    },
    [cases, commitCases],
  );

  const handleThenChange = useCallback(
    (idx: number, targetTask: string) => {
      const caseName = cases[idx].name;
      onUpdateBranchRouting(`case_${caseName}`, targetTask || undefined);
    },
    [cases, onUpdateBranchRouting],
  );

  const handleDragStart = useCallback((idx: number) => {
    setDragIdx(idx);
  }, []);

  const handleDragOver = useCallback((idx: number) => {
    setDropIdx(idx);
  }, []);

  const handleDrop = useCallback(() => {
    if (dragIdx != null && dropIdx != null && dragIdx !== dropIdx) {
      const updated = [...cases];
      const [moved] = updated.splice(dragIdx, 1);
      updated.splice(dropIdx, 0, moved);
      commitCases(updated);
    }
    setDragIdx(null);
    setDropIdx(null);
  }, [dragIdx, dropIdx, cases, commitCases]);

  const handleDragEnd = useCallback(() => {
    setDragIdx(null);
    setDropIdx(null);
  }, []);

  return (
    <div className="flex flex-col gap-2 px-3 pb-3">
      {cases.length === 0 && (
        <p className="py-2 text-xs text-[var(--stgm-muted-foreground,#737373)]">
          No cases defined. Add a case to start branching.
        </p>
      )}

      {cases.map((c, idx) => {
        const isDefault = !c.when && idx === cases.length - 1;
        const routeTarget = routingMap.get(`case_${c.name}`) ?? "";

        return (
          <CaseEntry
            key={`${c.name}_${idx}`}
            caseDef={c}
            index={idx}
            total={cases.length}
            isDefault={isDefault}
            routeTarget={routeTarget}
            allTaskNames={allTaskNames}
            allCaseNames={cases.map((x) => x.name)}
            onNameChange={(name) => handleNameChange(idx, name)}
            onWhenChange={(when) => handleWhenChange(idx, when)}
            onThenChange={(then) => handleThenChange(idx, then)}
            onMoveUp={() => handleMoveCase(idx, -1)}
            onMoveDown={() => handleMoveCase(idx, 1)}
            onRemove={() => handleRemoveCase(idx)}
            canRemove={cases.length > 1}
            isDragOver={dropIdx === idx && dragIdx !== idx}
            onDragStart={() => handleDragStart(idx)}
            onDragOver={() => handleDragOver(idx)}
            onDrop={handleDrop}
            onDragEnd={handleDragEnd}
          />
        );
      })}

      <button
        type="button"
        onClick={handleAddCase}
        className="self-start text-[11px] font-medium text-[var(--stgm-primary,#6366f1)] hover:underline"
      >
        + Add case
      </button>
    </div>
  );
});

// ---------------------------------------------------------------------------
// CaseEntry
// ---------------------------------------------------------------------------

function CaseEntry({
  caseDef,
  index,
  total,
  isDefault,
  routeTarget,
  allTaskNames,
  allCaseNames,
  onNameChange,
  onWhenChange,
  onThenChange,
  onMoveUp,
  onMoveDown,
  onRemove,
  canRemove,
  isDragOver,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  caseDef: SwitchCaseEntry;
  index: number;
  total: number;
  isDefault: boolean;
  routeTarget: string;
  allTaskNames: readonly string[];
  allCaseNames: string[];
  onNameChange: (name: string) => void;
  onWhenChange: (when: string) => void;
  onThenChange: (then: string) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  canRemove: boolean;
  isDragOver: boolean;
  onDragStart: () => void;
  onDragOver: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
}) {
  const [nameError, setNameError] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(caseDef.name);

  const validateAndCommitName = useCallback(() => {
    const trimmed = editingName.trim();
    if (!trimmed) {
      setNameError("Name required");
      return;
    }
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed)) {
      setNameError("Alphanumeric and underscores only");
      return;
    }
    const isDuplicate = allCaseNames.some(
      (n, i) => i !== index && n === trimmed,
    );
    if (isDuplicate) {
      setNameError("Duplicate name");
      return;
    }
    setNameError(null);
    onNameChange(trimmed);
  }, [editingName, allCaseNames, index, onNameChange]);

  const handleDragOverEvent = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      onDragOver();
    },
    [onDragOver],
  );

  return (
    <div
      onDragOver={handleDragOverEvent}
      onDrop={onDrop}
      className={cn(
        "flex flex-col gap-1.5 rounded-md border p-2 transition-[border-color]",
        isDefault
          ? "border-[var(--stgm-chart-amber,#f59e0b)]/30 bg-[var(--stgm-chart-amber,#f59e0b)]/5"
          : "border-[var(--stgm-border,#e5e5e5)]",
        isDragOver && "border-[var(--stgm-primary,#6366f1)]",
      )}
    >
      {/* Header row: grip + name + controls */}
      <div className="flex items-center gap-1">
        <DragGrip onDragStart={onDragStart} onDragEnd={onDragEnd} />
        <input
          type="text"
          value={editingName}
          onChange={(e) => { setEditingName(e.target.value); setNameError(null); }}
          onBlur={validateAndCommitName}
          onKeyDown={(e) => { if (e.key === "Enter") validateAndCommitName(); }}
          placeholder="case_name"
          className="min-w-0 flex-1 rounded border border-[var(--stgm-border,#d4d4d8)] bg-[var(--stgm-background,#fff)] px-1.5 py-1 text-xs font-medium text-[var(--stgm-foreground,#1a1a2e)] focus:outline-none focus:ring-1 focus:ring-[var(--stgm-ring,#3b82f6)]"
          aria-label={`Case ${index + 1} name`}
        />
        {isDefault && (
          <span className="shrink-0 rounded bg-[var(--stgm-chart-amber,#f59e0b)]/15 px-1 py-px text-[9px] font-medium text-[var(--stgm-chart-amber,#f59e0b)]">
            default
          </span>
        )}

        <div className="flex shrink-0 items-center">
          <ArrowButton direction="up" disabled={index === 0} onClick={onMoveUp} />
          <ArrowButton direction="down" disabled={index === total - 1} onClick={onMoveDown} />
          <button
            type="button"
            onClick={onRemove}
            disabled={!canRemove}
            className="ml-0.5 text-[10px] text-[var(--stgm-destructive,#ef4444)] hover:underline disabled:opacity-30"
            aria-label={`Remove case ${caseDef.name}`}
          >
            ✕
          </button>
        </div>
      </div>

      {nameError && (
        <span className="text-[10px] text-[var(--stgm-destructive,#ef4444)]">{nameError}</span>
      )}

      {/* Condition */}
      <div className="flex flex-col gap-0.5">
        <label className="text-[10px] text-[var(--stgm-muted-foreground,#737373)]">
          Condition
        </label>
        <textarea
          value={caseDef.when}
          onChange={(e) => onWhenChange(e.target.value)}
          placeholder={isDefault ? "(no condition — default case)" : "${ $context.value > 5 }"}
          rows={2}
          className="w-full resize-y rounded border border-[var(--stgm-border,#d4d4d8)] bg-[var(--stgm-background,#fff)] px-1.5 py-1 font-mono text-[11px] text-[var(--stgm-foreground,#1a1a2e)] placeholder:text-[var(--stgm-muted-foreground,#a3a3a3)] focus:outline-none focus:ring-1 focus:ring-[var(--stgm-ring,#3b82f6)]"
          aria-label={`Condition for case ${caseDef.name}`}
        />
      </div>

      {/* Target task */}
      <div className="flex flex-col gap-0.5">
        <label className="text-[10px] text-[var(--stgm-muted-foreground,#737373)]">
          Then go to
        </label>
        <select
          value={routeTarget}
          onChange={(e) => onThenChange(e.target.value)}
          className="w-full rounded border border-[var(--stgm-border,#d4d4d8)] bg-[var(--stgm-background,#fff)] px-1.5 py-1 text-xs text-[var(--stgm-foreground,#1a1a2e)] focus:outline-none focus:ring-1 focus:ring-[var(--stgm-ring,#3b82f6)]"
          aria-label={`Target task for case ${caseDef.name}`}
        >
          <option value="">— Not connected —</option>
          {allTaskNames.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
      </div>
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
// ArrowButton
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
// Helpers
// ---------------------------------------------------------------------------

function extractCases(config: JsonObject): SwitchCaseEntry[] {
  const raw = (config as Record<string, unknown>).cases;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c): c is Record<string, unknown> => c != null && typeof c === "object")
    .map((c) => ({
      name: typeof c.name === "string" ? c.name : "",
      when: typeof c.when === "string" ? c.when : "",
      then: typeof c.then === "string" ? c.then : "",
    }));
}

function buildRoutingMap(
  nodeId: string,
  edges: readonly WorkflowGraphEdge[],
  prefix: string,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const edge of edges) {
    if (edge.source === nodeId && edge.sourceHandle?.startsWith(prefix)) {
      map.set(edge.sourceHandle, edge.target);
    }
  }
  return map;
}
