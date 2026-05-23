"use client";

import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import type { PortPattern } from "../task-type-visual-registry";
import type { CanvasTaskNodeData } from "../workflow-graph-conversions";

export interface NodeHandlesProps {
  portPattern: PortPattern;
  data: CanvasTaskNodeData;
}

const HANDLE_CLASS =
  "!h-2 !w-2 !rounded-full !border-[var(--stgm-border-prominent,#d4d4d8)] !bg-[var(--stgm-card,var(--stgm-background,#fff))]";

const SENTINEL_HANDLE_CLASS =
  "!h-2 !w-2 !rounded-full !border-[var(--stgm-border-prominent,#d4d4d8)] !bg-[var(--stgm-muted,#f5f5f5)]";

/**
 * Renders React Flow connection handles for a workflow node based
 * on the visual registry's port pattern.
 *
 * Port patterns:
 * - `standard`: single input (top) + single output (bottom)
 * - `branch-per-case`: single input + one output per switch case
 * - `branch-per-outcome`: single input + one output per human_input outcome
 * - `branch-per-branch`: single input + single output (fork branches are edge-level)
 * - `container`: single input + single output (for_each, try_catch)
 * - `source-only`: output only (start sentinel)
 * - `sink-only`: input only (end sentinel)
 */
export const NodeHandles = memo(function NodeHandles({
  portPattern,
  data,
}: NodeHandlesProps) {
  const handleClass = data.isSentinel ? SENTINEL_HANDLE_CLASS : HANDLE_CLASS;

  switch (portPattern) {
    case "source-only":
      return <Handle type="source" position={Position.Bottom} className={handleClass} />;

    case "sink-only":
      return <Handle type="target" position={Position.Top} className={handleClass} />;

    case "branch-per-case":
      return (
        <BranchedHandles
          inputClass={handleClass}
          outputClass={handleClass}
          handles={extractSwitchCaseHandles(data)}
        />
      );

    case "branch-per-outcome":
      return (
        <BranchedHandles
          inputClass={handleClass}
          outputClass={handleClass}
          handles={extractHumanInputHandles(data)}
        />
      );

    case "branch-per-branch":
    case "container":
    case "standard":
    default:
      return (
        <>
          <Handle type="target" position={Position.Top} className={handleClass} />
          <Handle type="source" position={Position.Bottom} className={handleClass} />
        </>
      );
  }
});

// ---------------------------------------------------------------------------
// Branched handle rendering
// ---------------------------------------------------------------------------

interface OutputHandle {
  id: string;
  label: string;
}

interface BranchedHandlesProps {
  inputClass: string;
  outputClass: string;
  handles: OutputHandle[];
}

function BranchedHandles({ inputClass, outputClass, handles }: BranchedHandlesProps) {
  if (handles.length === 0) {
    return (
      <>
        <Handle type="target" position={Position.Top} className={inputClass} />
        <Handle type="source" position={Position.Bottom} className={outputClass} />
      </>
    );
  }

  return (
    <>
      <Handle type="target" position={Position.Top} className={inputClass} />
      {handles.map((handle, idx) => {
        const leftPct = ((idx + 1) / (handles.length + 1)) * 100;
        return (
          <div key={handle.id}>
            <Handle
              type="source"
              position={Position.Bottom}
              id={handle.id}
              className={outputClass}
              style={{ left: `${leftPct}%` }}
            />
            <span
              className="pointer-events-none absolute text-[8px] font-medium leading-none text-[var(--stgm-muted-foreground,#737373)]"
              style={{
                left: `${leftPct}%`,
                bottom: -14,
                transform: "translateX(-50%)",
                whiteSpace: "nowrap",
              }}
            >
              {handle.label}
            </span>
          </div>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Handle extraction from node config
// ---------------------------------------------------------------------------

function extractSwitchCaseHandles(data: CanvasTaskNodeData): OutputHandle[] {
  const config = data.config as Record<string, unknown> | undefined;
  if (!config) return [];

  const cases = config.cases;
  if (!Array.isArray(cases)) return [];

  return cases
    .filter(
      (c): c is Record<string, unknown> =>
        c != null && typeof c === "object" && typeof c.name === "string",
    )
    .map((c) => ({
      id: `case_${c.name as string}`,
      label: c.name as string,
    }));
}

function extractHumanInputHandles(data: CanvasTaskNodeData): OutputHandle[] {
  const config = data.config as Record<string, unknown> | undefined;
  if (!config) return [];

  const outcomes = config.outcomes;
  if (!Array.isArray(outcomes)) return [];

  return outcomes
    .filter(
      (o): o is Record<string, unknown> =>
        o != null && typeof o === "object" && typeof o.name === "string",
    )
    .map((o) => ({
      id: `outcome_${o.name as string}`,
      label: o.name as string,
    }));
}
