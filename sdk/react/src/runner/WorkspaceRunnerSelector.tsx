"use client";

import { useMemo } from "react";
import { cn } from "@stigmer/theme";
import type { Runner } from "@stigmer/protos/ai/stigmer/agentic/runner/v1/api_pb";
import { RunnerPhase } from "@stigmer/protos/ai/stigmer/agentic/runner/v1/enum_pb";
import { useRunnerList } from "./useRunnerList";
import { isActivePhase, phaseDotColor, PHASE_SORT_ORDER } from "./phase";

/** Props for {@link WorkspaceRunnerSelector}. */
export interface WorkspaceRunnerSelectorProps {
  /** Organization slug to scope the runner list. */
  readonly org: string;
  /** Currently selected runner ID, or `null` for "Auto". */
  readonly value: string | null;
  /** Called when the user selects a runner. `null` means "Auto". */
  readonly onChange: (runnerId: string | null) => void;
  /** Disables all interactions. */
  readonly disabled?: boolean;
  /**
   * Set of runner IDs that are known to be running on the local machine.
   *
   * When provided, matching runners are labeled "This machine" instead
   * of their name/hostname. This is a host-provided signal — the desktop
   * app determines local runners from `~/.stigmer/runners/` state files;
   * the web console does not pass this prop.
   */
  readonly localRunnerIds?: ReadonlySet<string>;
}

/**
 * Cursor-inspired "Run On" section for the workspace popover.
 *
 * Renders a compact, sectioned list of available runners so users can
 * pick where their session runs without leaving the workspace context.
 * Designed to be composed alongside {@link WorkspaceEditor} inside the
 * workspace popover — NOT as a standalone picker.
 *
 * Label strategy (SDK-agnostic, no platform branding):
 * - "Auto" for null selection (platform assigns a runner)
 * - "Cloud" for system-managed runners
 * - "This machine" when the host provides `localRunnerIds`
 * - Runner name / hostname for everything else
 */
export function WorkspaceRunnerSelector({
  org,
  value,
  onChange,
  disabled,
  localRunnerIds,
}: WorkspaceRunnerSelectorProps) {
  const { runners, isLoading } = useRunnerList(org);

  const active = useMemo(() => {
    return runners
      .filter((r) => isActivePhase(r.status?.phase ?? RunnerPhase.UNSPECIFIED))
      .sort((a, b) => {
        const pa = a.status?.phase ?? RunnerPhase.UNSPECIFIED;
        const pb = b.status?.phase ?? RunnerPhase.UNSPECIFIED;
        const po = PHASE_SORT_ORDER[pa] - PHASE_SORT_ORDER[pb];
        if (po !== 0) return po;
        return (a.metadata?.name ?? "").localeCompare(b.metadata?.name ?? "");
      });
  }, [runners]);

  return (
    <div className="space-y-1" role="listbox" aria-label="Run on">
      <div className="px-1 text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">
        Run On
      </div>

      {/* Auto option */}
      <RunOnOption
        selected={value === null}
        onClick={() => onChange(null)}
        disabled={disabled}
        label="Auto"
        hint="platform assigns"
        dotClass="bg-primary"
      />

      {/* Available runners */}
      {active.map((r) => {
        const id = r.metadata!.id;
        return (
          <RunOnOption
            key={id}
            selected={value === id}
            onClick={() => onChange(id)}
            disabled={disabled}
            label={runnerLabel(r, localRunnerIds)}
            hint={runnerHint(r, localRunnerIds)}
            dotClass={phaseDotColor(r.status?.phase ?? RunnerPhase.UNSPECIFIED)}
          />
        );
      })}

      {/* Loading */}
      {isLoading && active.length === 0 && (
        <div className="px-1 py-2 text-[0.65rem] text-muted-foreground">
          Loading runners...
        </div>
      )}

      {/* Empty */}
      {!isLoading && active.length === 0 && (
        <div className="px-1 py-2 text-[0.65rem] text-muted-foreground">
          No runners available
        </div>
      )}
    </div>
  );
}

function RunOnOption({
  selected,
  onClick,
  disabled,
  label,
  hint,
  dotClass,
}: {
  selected: boolean;
  onClick: () => void;
  disabled?: boolean;
  label: string;
  hint?: string;
  dotClass: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
        "disabled:pointer-events-none disabled:opacity-50",
        selected
          ? "bg-accent font-medium text-foreground"
          : "text-foreground hover:bg-accent-hover",
      )}
      role="option"
      aria-selected={selected}
    >
      <span
        className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full", dotClass)}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint && (
        <span className="shrink-0 text-[0.6rem] text-muted-foreground">
          {hint}
        </span>
      )}
    </button>
  );
}

function runnerLabel(
  runner: Runner,
  localRunnerIds?: ReadonlySet<string>,
): string {
  const id = runner.metadata?.id ?? "";
  if (localRunnerIds?.has(id)) return "This machine";
  return runner.metadata?.name ?? runner.status?.connectionInfo?.hostname ?? "Unnamed";
}

function runnerHint(
  runner: Runner,
  localRunnerIds?: ReadonlySet<string>,
): string | undefined {
  const id = runner.metadata?.id ?? "";
  if (localRunnerIds?.has(id)) {
    return runner.status?.connectionInfo?.hostname;
  }
  const name = runner.metadata?.name;
  const hostname = runner.status?.connectionInfo?.hostname;
  if (name && hostname && name !== hostname) return hostname;
  return undefined;
}
