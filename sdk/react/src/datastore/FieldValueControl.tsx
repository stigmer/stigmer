"use client";

import { useCallback, useState } from "react";
import { cn } from "@stigmer/theme";
import type { JsonValue } from "@bufbuild/protobuf";
import {
  FieldType,
  type FieldDeclaration,
} from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/spec_pb";

/**
 * Standard input styling for datastore value controls — the
 * token-compliant idiom (semantic Tailwind classes over `--stgm-*`
 * tokens; no pixel font sizes, no hex fallbacks).
 */
export const FIELD_INPUT_CLASSES = cn(
  "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-2.5 stg:py-1.5 stg:text-xs stg:text-foreground",
  "stg:placeholder:text-muted-foreground",
  "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
  "stg:disabled:pointer-events-none stg:disabled:opacity-50",
);

/** Props for {@link FieldValueControl}. */
export interface FieldValueControlProps {
  /** The field declaration driving the control type. */
  readonly field: FieldDeclaration;
  /**
   * Current value in its canonical encoding (DD-004), or `undefined`
   * when empty/unset. The control never receives explicit `null` — the
   * clear affordance is the owner's (a form row renders it; the control
   * only edits values).
   */
  readonly value: JsonValue | undefined;
  /**
   * Called with the canonical value on every valid edit, or `undefined`
   * when the input empties. Invalid intermediate states (half-typed
   * JSON, unparseable numbers) stay local to the control and are never
   * emitted — the precedent set by the workflow config form.
   */
  readonly onChange: (value: JsonValue | undefined) => void;
  /** Disables the input. */
  readonly disabled?: boolean;
  /** DOM id for external `<label htmlFor>` wiring. */
  readonly id?: string;
  /** Accessible name when no external label is wired. */
  readonly "aria-label"?: string;
}

/**
 * The typed value control for a declared datastore field — one
 * controlled input per `FieldType`, emitting canonical encodings
 * (DD-004). Shared by `RecordFormPanel` (field editing) and
 * `RecordFilterBuilder` (condition values), so a field always offers
 * the same input affordance everywhere.
 *
 * Type dispatch:
 * - `string`             — text input; enum-select when `enum_values` declared
 * - `integer` / `number` — numeric input (step 1 / any)
 * - `bool`               — select with true/false (a checkbox conflates
 *                          "false" with "unset", which the tri-state
 *                          write model must not do)
 * - `date`               — native date picker (emits `YYYY-MM-DD`)
 * - `time`               — native time picker (emits zero-padded `HH:MM[:SS]`)
 * - `timestamp`          — native datetime-local picker in the operator's
 *                          zone, converted to RFC 3339 UTC
 * - `json`               — mono textarea with local parse state; only
 *                          valid JSON is emitted
 */
export function FieldValueControl(props: FieldValueControlProps) {
  const { field } = props;
  switch (field.type) {
    case FieldType.string:
      return field.enumValues.length > 0 ? <EnumControl {...props} /> : <StringControl {...props} />;
    case FieldType.integer:
    case FieldType.number:
      return <NumberControl {...props} />;
    case FieldType.bool:
      return <BoolControl {...props} />;
    case FieldType.date:
      return <DateControl {...props} />;
    case FieldType.time:
      return <TimeControl {...props} />;
    case FieldType.timestamp:
      return <TimestampControl {...props} />;
    case FieldType.json:
    default:
      return <JsonControl {...props} />;
  }
}

// ---------------------------------------------------------------------------
// Per-type controls
// ---------------------------------------------------------------------------

function StringControl({ value, onChange, disabled, id, "aria-label": ariaLabel }: FieldValueControlProps) {
  return (
    <input
      id={id}
      type="text"
      className={FIELD_INPUT_CLASSES}
      value={typeof value === "string" ? value : ""}
      onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
      disabled={disabled}
      aria-label={ariaLabel}
    />
  );
}

function EnumControl({ field, value, onChange, disabled, id, "aria-label": ariaLabel }: FieldValueControlProps) {
  return (
    <select
      id={id}
      className={FIELD_INPUT_CLASSES}
      value={typeof value === "string" ? value : ""}
      onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
      disabled={disabled}
      aria-label={ariaLabel}
    >
      <option value="">— Select —</option>
      {field.enumValues.map((v) => (
        <option key={v} value={v}>
          {v}
        </option>
      ))}
    </select>
  );
}

function NumberControl({ field, value, onChange, disabled, id, "aria-label": ariaLabel }: FieldValueControlProps) {
  const isInteger = field.type === FieldType.integer;
  return (
    <input
      id={id}
      type="number"
      step={isInteger ? 1 : "any"}
      className={FIELD_INPUT_CLASSES}
      value={typeof value === "number" ? value : ""}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === "") {
          onChange(undefined);
          return;
        }
        const parsed = isInteger ? Number.parseInt(raw, 10) : Number.parseFloat(raw);
        if (!Number.isNaN(parsed)) onChange(parsed);
      }}
      disabled={disabled}
      aria-label={ariaLabel}
    />
  );
}

function BoolControl({ value, onChange, disabled, id, "aria-label": ariaLabel }: FieldValueControlProps) {
  return (
    <select
      id={id}
      className={FIELD_INPUT_CLASSES}
      value={value === true ? "true" : value === false ? "false" : ""}
      onChange={(e) => {
        const v = e.target.value;
        onChange(v === "" ? undefined : v === "true");
      }}
      disabled={disabled}
      aria-label={ariaLabel}
    >
      <option value="">— Select —</option>
      <option value="true">true</option>
      <option value="false">false</option>
    </select>
  );
}

function DateControl({ value, onChange, disabled, id, "aria-label": ariaLabel }: FieldValueControlProps) {
  return (
    <input
      id={id}
      type="date"
      className={FIELD_INPUT_CLASSES}
      value={typeof value === "string" ? value : ""}
      onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
      disabled={disabled}
      aria-label={ariaLabel}
    />
  );
}

function TimeControl({ value, onChange, disabled, id, "aria-label": ariaLabel }: FieldValueControlProps) {
  return (
    <input
      id={id}
      type="time"
      step={1}
      className={FIELD_INPUT_CLASSES}
      value={typeof value === "string" ? value : ""}
      onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
      disabled={disabled}
      aria-label={ariaLabel}
    />
  );
}

function TimestampControl({ value, onChange, disabled, id, "aria-label": ariaLabel }: FieldValueControlProps) {
  return (
    <input
      id={id}
      type="datetime-local"
      step={1}
      className={FIELD_INPUT_CLASSES}
      value={typeof value === "string" ? utcToLocalInput(value) : ""}
      onChange={(e) => {
        const raw = e.target.value;
        onChange(raw === "" ? undefined : localInputToUtc(raw));
      }}
      disabled={disabled}
      aria-label={ariaLabel}
    />
  );
}

/**
 * Canonical RFC 3339 UTC → the datetime-local widget's value (the
 * operator's local zone, no zone suffix). Unparseable input renders
 * empty rather than throwing — the value may be mid-edit.
 */
function utcToLocalInput(canonical: string): string {
  const ms = Date.parse(canonical);
  if (Number.isNaN(ms)) return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/** The widget's local value → canonical RFC 3339 UTC. */
function localInputToUtc(local: string): string {
  const ms = Date.parse(local); // no zone suffix — parsed as local time
  if (Number.isNaN(ms)) return local; // let coercion report it on submit
  return new Date(ms).toISOString().replace(/\.000Z$/, "Z");
}

function JsonControl({ value, onChange, disabled, id, "aria-label": ariaLabel }: FieldValueControlProps) {
  const initial = value !== undefined ? JSON.stringify(value, null, 2) : "";
  const [raw, setRaw] = useState(initial);
  const [parseError, setParseError] = useState<string | null>(null);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const text = e.target.value;
      setRaw(text);
      if (text.trim() === "") {
        setParseError(null);
        onChange(undefined);
        return;
      }
      try {
        const parsed = JSON.parse(text) as JsonValue;
        setParseError(null);
        onChange(parsed);
      } catch {
        // Invalid JSON stays local — never emitted.
        setParseError("Invalid JSON");
      }
    },
    [onChange],
  );

  return (
    <div className="stg:flex stg:flex-col stg:gap-1">
      <textarea
        id={id}
        rows={4}
        className={cn(FIELD_INPUT_CLASSES, "stg:resize-y stg:font-mono")}
        value={raw}
        onChange={handleChange}
        placeholder="{}"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-invalid={parseError !== null}
      />
      {parseError && (
        <span role="alert" className="stg:text-xs stg:text-destructive">
          {parseError}
        </span>
      )}
    </div>
  );
}
