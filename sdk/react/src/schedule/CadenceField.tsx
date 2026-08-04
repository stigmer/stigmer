"use client";

import { useCallback, useId } from "react";
import { cn } from "@stigmer/theme";
import {
  cadenceToCron,
  describeCadence,
  formatTime,
  validateCron,
  WEEKDAY_LABELS,
  type CadenceKind,
  type CadencePreset,
} from "./cadence.js";

/** Props for {@link CadenceField}. */
export interface CadenceFieldProps {
  /** The current cadence. */
  readonly value: CadencePreset;
  /** Called with the new cadence on every edit. */
  readonly onChange: (preset: CadencePreset) => void;
  /** Time zone name, echoed into the summary line. */
  readonly timeZone?: string;
  /** Prevents interaction when `true`. */
  readonly disabled?: boolean;
}

const KIND_OPTIONS: readonly { kind: CadenceKind; label: string }[] = [
  { kind: "hourly", label: "Hourly" },
  { kind: "daily", label: "Daily" },
  { kind: "weekly", label: "Weekly" },
  { kind: "monthly", label: "Monthly" },
  { kind: "custom", label: "Custom cron" },
];

/**
 * Human-friendly cadence builder for schedules.
 *
 * Presents preset cadences (hourly / daily / weekly / monthly) with
 * plain time-and-day inputs, generating the 5-field cron expression by
 * construction — the user never writes cron unless they choose the
 * Custom escape hatch, where the raw expression is validated instantly
 * with the platform's own lexical rules ({@link validateCron}).
 *
 * A live plain-English summary ({@link describeCadence}) always states
 * what was chosen. It describes the preset, not a computed fire-time
 * forecast — the authoritative next fire time is published by the
 * server as `status.next_fire_at` after apply.
 *
 * Controlled component over {@link CadencePreset}; convert to the spec
 * string with {@link cadenceToCron} at submit time.
 */
export function CadenceField({
  value,
  onChange,
  timeZone,
  disabled,
}: CadenceFieldProps) {
  const groupId = useId();

  const switchKind = useCallback(
    (kind: CadenceKind) => {
      if (kind === value.kind) return;
      onChange(presetForKind(kind, value));
    },
    [value, onChange],
  );

  const cronError =
    value.kind === "custom" && value.cron.trim() !== ""
      ? validateCron(value.cron.trim())
      : null;

  return (
    <div className="space-y-2">
      {/* Preset selector — segmented radio group, matching ScopeToggle's pattern */}
      <div
        role="radiogroup"
        aria-label="Cadence"
        aria-disabled={disabled || undefined}
        className={cn(
          "inline-flex flex-wrap rounded-md bg-muted p-0.5",
          disabled && "pointer-events-none opacity-50",
        )}
      >
        {KIND_OPTIONS.map((option) => {
          const isSelected = value.kind === option.kind;
          return (
            <button
              key={option.kind}
              type="button"
              role="radio"
              aria-checked={isSelected}
              tabIndex={isSelected ? 0 : -1}
              disabled={disabled}
              onClick={() => switchKind(option.kind)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                  e.preventDefault();
                  const idx = KIND_OPTIONS.findIndex((o) => o.kind === value.kind);
                  const delta = e.key === "ArrowRight" ? 1 : -1;
                  const next =
                    KIND_OPTIONS[
                      (idx + delta + KIND_OPTIONS.length) % KIND_OPTIONS.length
                    ];
                  switchKind(next.kind);
                }
              }}
              className={cn(
                "inline-flex cursor-pointer items-center rounded-sm px-2.5 py-1 text-xs font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isSelected
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      {/* Per-preset inputs */}
      {value.kind === "hourly" && (
        <div className="flex items-center gap-2 text-xs text-foreground">
          <label htmlFor={`${groupId}-minute`}>At minute</label>
          <input
            id={`${groupId}-minute`}
            type="number"
            min={0}
            max={59}
            value={value.minute}
            onChange={(e) =>
              onChange({
                kind: "hourly",
                minute: clampInt(e.target.value, 0, 59, value.minute),
              })
            }
            disabled={disabled}
            className={numberInputClasses}
          />
        </div>
      )}

      {value.kind === "daily" && (
        <TimeInput
          id={`${groupId}-time`}
          hour={value.hour}
          minute={value.minute}
          disabled={disabled}
          onChange={(hour, minute) => onChange({ kind: "daily", hour, minute })}
        />
      )}

      {value.kind === "weekly" && (
        <div className="space-y-2">
          <div
            role="group"
            aria-label="Days of week"
            className="flex flex-wrap gap-1"
          >
            {WEEKDAY_LABELS.map((label, day) => {
              const isOn = value.days.includes(day);
              // The last selected day cannot be removed — a weekly
              // schedule with zero days is not expressible in cron.
              const isLastSelected = isOn && value.days.length === 1;
              return (
                <button
                  key={label}
                  type="button"
                  aria-pressed={isOn}
                  aria-label={label}
                  title={label}
                  disabled={disabled || isLastSelected}
                  onClick={() =>
                    onChange({
                      ...value,
                      days: isOn
                        ? value.days.filter((d) => d !== day)
                        : [...value.days, day].sort((a, b) => a - b),
                    })
                  }
                  className={cn(
                    "inline-flex h-7 w-9 items-center justify-center rounded-md border text-xs font-medium transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    "disabled:pointer-events-none",
                    isOn
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-input bg-background text-muted-foreground hover:text-foreground",
                    isLastSelected && "opacity-70",
                  )}
                >
                  {label.slice(0, 3)}
                </button>
              );
            })}
          </div>
          <TimeInput
            id={`${groupId}-time`}
            hour={value.hour}
            minute={value.minute}
            disabled={disabled}
            onChange={(hour, minute) => onChange({ ...value, hour, minute })}
          />
        </div>
      )}

      {value.kind === "monthly" && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-foreground">
            <label htmlFor={`${groupId}-day`}>On day</label>
            <input
              id={`${groupId}-day`}
              type="number"
              min={1}
              max={31}
              value={value.day}
              onChange={(e) =>
                onChange({
                  ...value,
                  day: clampInt(e.target.value, 1, 31, value.day),
                })
              }
              disabled={disabled}
              className={numberInputClasses}
            />
            <span className="text-muted-foreground">of every month</span>
          </div>
          {value.day >= 29 && (
            <p className="text-[0.65rem] text-muted-foreground">
              Months without day {value.day} are skipped — February never
              fires a day-{value.day} schedule
              {value.day === 29 ? " except in leap years" : ""}.
            </p>
          )}
          <TimeInput
            id={`${groupId}-time`}
            hour={value.hour}
            minute={value.minute}
            disabled={disabled}
            onChange={(hour, minute) => onChange({ ...value, hour, minute })}
          />
        </div>
      )}

      {value.kind === "custom" && (
        <div className="space-y-1">
          <input
            type="text"
            aria-label="Cron expression"
            placeholder="e.g. 0 9 * * MON-FRI"
            value={value.cron}
            onChange={(e) => onChange({ kind: "custom", cron: e.target.value })}
            disabled={disabled}
            className={cn(
              "w-full rounded-md border border-input bg-background px-2.5 py-1.5 font-mono text-xs text-foreground",
              "placeholder:font-sans placeholder:text-muted-foreground",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              "disabled:pointer-events-none disabled:opacity-50",
              cronError && "border-destructive",
            )}
          />
          {cronError ? (
            <p className="text-[0.65rem] text-destructive" role="alert">
              {cronError}
            </p>
          ) : (
            <p className="text-[0.65rem] text-muted-foreground">
              5 fields (minute hour day-of-month month day-of-week) or
              @hourly, @daily, @weekly, @monthly, @yearly.
            </p>
          )}
        </div>
      )}

      {/* Plain-English summary of the chosen cadence */}
      {!(value.kind === "custom" && (cronError || value.cron.trim() === "")) && (
        <p className="text-xs text-muted-foreground" data-testid="cadence-summary">
          {describeCadence(value, timeZone)}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

const numberInputClasses = cn(
  "w-16 rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground",
  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
  "disabled:pointer-events-none disabled:opacity-50",
);

function TimeInput({
  id,
  hour,
  minute,
  disabled,
  onChange,
}: {
  readonly id: string;
  readonly hour: number;
  readonly minute: number;
  readonly disabled?: boolean;
  readonly onChange: (hour: number, minute: number) => void;
}) {
  return (
    <div className="flex items-center gap-2 text-xs text-foreground">
      <label htmlFor={id}>At</label>
      <input
        id={id}
        type="time"
        value={formatTime(hour, minute)}
        onChange={(e) => {
          const [h, m] = e.target.value.split(":").map(Number);
          if (Number.isInteger(h) && Number.isInteger(m)) onChange(h, m);
        }}
        disabled={disabled}
        className={cn(
          "rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          "disabled:pointer-events-none disabled:opacity-50",
        )}
      />
    </div>
  );
}

/**
 * Next preset when the user switches kind, carrying the time of day
 * across so "Daily at 09:30" → Weekly keeps 09:30. Switching to Custom
 * prefills the generated cron from the outgoing preset — the escape
 * hatch starts from what the user already built, not a blank box.
 */
function presetForKind(kind: CadenceKind, previous: CadencePreset): CadencePreset {
  const hour = "hour" in previous ? previous.hour : 9;
  const minute = "minute" in previous ? previous.minute : 0;
  switch (kind) {
    case "hourly":
      return { kind, minute };
    case "daily":
      return { kind, hour, minute };
    case "weekly":
      return { kind, days: [1], hour, minute };
    case "monthly":
      return { kind, day: 1, hour, minute };
    case "custom":
      return {
        kind,
        cron: previous.kind === "custom" ? previous.cron : cadenceToCron(previous),
      };
  }
}

function clampInt(
  raw: string,
  min: number,
  max: number,
  fallback: number,
): number {
  const n = Number(raw);
  if (!Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
