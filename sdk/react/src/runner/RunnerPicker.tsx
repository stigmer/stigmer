"use client";

import { useMemo } from "react";
import { Select } from "@base-ui/react/select";
import { RunnerPhase } from "@stigmer/protos/ai/stigmer/agentic/runner/v1/enum_pb";
import type { Runner } from "@stigmer/protos/ai/stigmer/agentic/runner/v1/api_pb";
import { useRunnerList } from "./useRunnerList";
import {
  isActivePhase,
  phaseLabel,
  phaseDotColor,
  PHASE_SORT_ORDER,
} from "./phase";

/**
 * Sentinel value representing "Auto" (let the backend decide).
 *
 * Base UI Select requires a non-null string value for every item,
 * so we use this internal sentinel and map to/from `null` at the
 * component boundary.
 */
const AUTO_VALUE = "__auto__";

/** Props for {@link RunnerPicker}. */
export interface RunnerPickerProps {
  /** Organization slug to scope the runner list. */
  readonly org: string;
  /**
   * Currently selected runner ID, or `null` for "Auto".
   *
   * `null` means the backend decides which runner to use — session
   * auto-bind in OSS, cloud auto-provisioning in Cloud.
   */
  readonly value: string | null;
  /** Called when the user picks a different runner. `null` = "Auto". */
  readonly onChange: (runnerId: string | null) => void;
  /**
   * Show the "Auto" option as the first item in the dropdown.
   * @default true
   */
  readonly showAutoOption?: boolean;
  /** Additional CSS class names for the trigger button. */
  readonly className?: string;
  /** When true, disables the selector. */
  readonly disabled?: boolean;
}

/**
 * Theme-able runner picker built on `@base-ui/react` Select.
 *
 * Fetches available runners via {@link useRunnerList} and renders
 * them in a dropdown grouped by operational phase. READY runners
 * appear first, then BUSY (selectable), then inactive runners
 * (STOPPED/PENDING/FAILED — visible but disabled).
 *
 * Includes an "Auto" option (default) that lets the backend decide
 * which runner to use. Platform builders who manage runner assignment
 * programmatically can disable this via `showAutoOption={false}`.
 *
 * All visual properties flow through `--stgm-*` tokens — no
 * hardcoded colors or sizes.
 *
 * Platform builders who need different rendering use
 * {@link useRunnerList} directly.
 *
 * @example
 * ```tsx
 * const [runnerId, setRunnerId] = useState<string | null>(null);
 *
 * <RunnerPicker
 *   org="acme"
 *   value={runnerId}
 *   onChange={setRunnerId}
 * />
 * ```
 */
export function RunnerPicker({
  org,
  value,
  onChange,
  showAutoOption = true,
  className,
  disabled,
}: RunnerPickerProps) {
  const { runners, isLoading } = useRunnerList(org);

  const { active, inactive } = useMemo(() => {
    const act: Runner[] = [];
    const inact: Runner[] = [];

    for (const r of runners) {
      if (isActivePhase(r.status?.phase ?? RunnerPhase.UNSPECIFIED)) {
        act.push(r);
      } else {
        inact.push(r);
      }
    }

    act.sort(phaseThenName);
    inact.sort(phaseThenName);

    return { active: act, inactive: inact };
  }, [runners]);

  const selectValue = value ?? AUTO_VALUE;

  const handleChange = (v: string | null) => {
    if (v === null) return;
    onChange(v === AUTO_VALUE ? null : v);
  };

  const triggerLabel = useMemo(() => {
    if (!value) return "Auto";
    const runner = runners.find((r) => r.metadata?.id === value);
    return runner?.metadata?.name ?? "Runner";
  }, [value, runners]);

  return (
    <Select.Root
      value={selectValue}
      onValueChange={handleChange}
      disabled={disabled || isLoading}
    >
      <Select.Trigger
        className={[
          "inline-flex items-center gap-1.5 rounded-md border border-border",
          "bg-background px-2.5 py-1.5 text-xs text-foreground",
          "hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "disabled:pointer-events-none disabled:opacity-50",
          "transition-colors",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <RunnerIcon />
        <span className="max-w-[10rem] truncate">{triggerLabel}</span>
        <ChevronIcon />
      </Select.Trigger>

      <Select.Portal>
        <Select.Positioner sideOffset={4}>
          <Select.Popup
            className={[
              "z-popover max-h-72 min-w-[var(--anchor-width)] overflow-auto",
              "rounded-lg border border-border bg-popover p-1 shadow-md",
              "text-popover-foreground",
            ].join(" ")}
          >
            {showAutoOption && (
              <Select.Item
                value={AUTO_VALUE}
                className={[
                  "flex cursor-pointer items-center gap-2",
                  "rounded-md px-2 py-1.5 text-xs outline-none",
                  "data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
                  "data-[selected]:font-medium",
                ].join(" ")}
              >
                <Select.ItemText>Auto</Select.ItemText>
                <span className="text-[0.6rem] text-muted-foreground">
                  default
                </span>
              </Select.Item>
            )}

            {(showAutoOption && (active.length > 0 || inactive.length > 0)) && (
              <div className="my-1 h-px bg-border/50" role="separator" />
            )}

            {active.length > 0 && (
              <Select.Group>
                <Select.GroupLabel className="px-2 py-1.5 text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
                  Available
                </Select.GroupLabel>
                {active.map((r) => (
                  <RunnerItem key={r.metadata!.id} runner={r} />
                ))}
              </Select.Group>
            )}

            {inactive.length > 0 && (
              <Select.Group>
                <Select.GroupLabel className="px-2 py-1.5 text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
                  Offline
                </Select.GroupLabel>
                {inactive.map((r) => (
                  <RunnerItem key={r.metadata!.id} runner={r} disabled />
                ))}
              </Select.Group>
            )}

            {runners.length === 0 && !isLoading && (
              <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                No runners found
              </div>
            )}
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}

// ---------------------------------------------------------------------------
// Internal components
// ---------------------------------------------------------------------------

function RunnerItem({
  runner,
  disabled,
}: {
  runner: Runner;
  disabled?: boolean;
}) {
  const id = runner.metadata!.id;
  const name = runner.metadata?.name ?? "Unnamed";
  const phase = runner.status?.phase ?? RunnerPhase.UNSPECIFIED;
  const hostname = runner.status?.connectionInfo?.hostname;

  return (
    <Select.Item
      value={id}
      disabled={disabled}
      className={[
        "flex cursor-pointer items-center gap-2",
        "rounded-md px-2 py-1.5 text-xs outline-none",
        "data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
        "data-[selected]:font-medium",
        "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
      ].join(" ")}
    >
      <PhaseDot phase={phase} />
      <div className="flex min-w-0 flex-col">
        <Select.ItemText>
          <span className="truncate">{name}</span>
        </Select.ItemText>
        {hostname && (
          <span className="truncate text-[0.6rem] leading-tight text-muted-foreground">
            {hostname}
          </span>
        )}
      </div>
      <span className="ml-auto shrink-0 text-[0.6rem] lowercase text-muted-foreground">
        {phaseLabel(phase)}
      </span>
    </Select.Item>
  );
}

function PhaseDot({ phase }: { phase: RunnerPhase }) {
  return (
    <span
      className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${phaseDotColor(phase)}`}
      aria-hidden="true"
    />
  );
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function phaseThenName(a: Runner, b: Runner): number {
  const pa = a.status?.phase ?? RunnerPhase.UNSPECIFIED;
  const pb = b.status?.phase ?? RunnerPhase.UNSPECIFIED;
  const phaseOrder = PHASE_SORT_ORDER[pa] - PHASE_SORT_ORDER[pb];
  if (phaseOrder !== 0) return phaseOrder;
  return (a.metadata?.name ?? "").localeCompare(b.metadata?.name ?? "");
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function RunnerIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-muted-foreground"
    >
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <path d="M15 2v2" />
      <path d="M15 20v2" />
      <path d="M2 15h2" />
      <path d="M2 9h2" />
      <path d="M20 15h2" />
      <path d="M20 9h2" />
      <path d="M9 2v2" />
      <path d="M9 20v2" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-muted-foreground"
    >
      <path d="M2.5 3.75L5 6.25L7.5 3.75" />
    </svg>
  );
}
