"use client";

import { memo, useState, useCallback } from "react";
import { cn } from "@stigmer/theme";
import type { JsonObject } from "@bufbuild/protobuf";
import type { TaskFieldDescriptor, TaskFieldGroup, TaskFieldType } from "./types";

/** Props for {@link TaskConfigForm}. */
export interface TaskConfigFormProps {
  /** Ordered field descriptors from `TaskKindDescriptor.fields`. */
  readonly fields: readonly TaskFieldDescriptor[];
  /** Logical field groups for collapsible sections. */
  readonly fieldGroups: readonly TaskFieldGroup[];
  /** Current config object (source of truth from the graph node). */
  readonly config: JsonObject;
  /** Called when a field value changes. */
  readonly onChange: (fieldPath: string, value: unknown) => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

const MULTILINE_FIELD_PATTERNS = /prompt|expression|body|template|query|script/i;
const MAX_RECURSION_DEPTH = 2;

/**
 * Schema-driven form generated from `TaskKindDescriptor.fields` and `fieldGroups`.
 *
 * Renders each field with the appropriate control based on its `TaskFieldType`:
 * text inputs, number inputs, toggles, selects, embedded YAML editors, and
 * list/map editors. Fields are organized into collapsible groups.
 *
 * Pure presentational — does not own state. Receives the current config
 * and reports changes via `onChange(fieldPath, value)`.
 *
 * @since T15 Batch 3 (Inspector + Edit Loop)
 */
export const TaskConfigForm = memo(function TaskConfigForm({
  fields,
  fieldGroups,
  config,
  onChange,
  className,
}: TaskConfigFormProps) {
  const groupedFields = groupFieldsByGroup(fields, fieldGroups);

  if (fields.length === 0) {
    return (
      <div className={cn("px-3 py-4 text-xs text-[var(--stgm-muted-foreground,#737373)]", className)}>
        No configurable fields for this task kind.
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {groupedFields.map((group) => (
        <FieldGroupSection
          key={group.id}
          group={group}
          config={config}
          onChange={onChange}
        />
      ))}
    </div>
  );
});

// ---------------------------------------------------------------------------
// FieldGroupSection
// ---------------------------------------------------------------------------

interface FieldGroupSectionData {
  id: string;
  displayName: string;
  description?: string;
  fields: readonly TaskFieldDescriptor[];
}

function FieldGroupSection({
  group,
  config,
  onChange,
}: {
  group: FieldGroupSectionData;
  config: JsonObject;
  onChange: (fieldPath: string, value: unknown) => void;
}) {
  const [collapsed, setCollapsed] = useState(group.id === "__advanced");

  const toggle = useCallback(() => setCollapsed((c) => !c), []);

  return (
    <div className="border-b border-[var(--stgm-border,#e5e5e5)] last:border-b-0">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs font-semibold text-[var(--stgm-foreground,#1a1a2e)] hover:bg-[var(--stgm-muted,#f5f5f5)]"
        aria-expanded={!collapsed}
      >
        <ChevronIcon collapsed={collapsed} />
        {group.displayName}
      </button>
      {!collapsed && (
        <div className="flex flex-col gap-3 px-3 pb-3">
          {group.description && (
            <p className="text-[10px] text-[var(--stgm-muted-foreground,#737373)]">
              {group.description}
            </p>
          )}
          {group.fields.map((field) => (
            <FieldRenderer
              key={field.name}
              field={field}
              value={getFieldValue(config, field.name)}
              onChange={(value) => onChange(field.name, value)}
              depth={0}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FieldRenderer
// ---------------------------------------------------------------------------

function FieldRenderer({
  field,
  value,
  onChange,
  depth,
}: {
  field: TaskFieldDescriptor;
  value: unknown;
  onChange: (value: unknown) => void;
  depth: number;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center gap-1 text-[11px] font-medium text-[var(--stgm-foreground,#1a1a2e)]">
        {field.displayName}
        {field.required && (
          <span className="text-[var(--stgm-destructive,#ef4444)]" aria-label="required">*</span>
        )}
        {field.isExpression && (
          <span className="rounded bg-[var(--stgm-accent,#e5e5e5)] px-1 text-[9px] font-normal text-[var(--stgm-muted-foreground,#737373)]">
            expr
          </span>
        )}
      </label>
      {field.description && (
        <p className="text-[10px] leading-tight text-[var(--stgm-muted-foreground,#737373)]">
          {field.description}
        </p>
      )}
      <FieldControl field={field} value={value} onChange={onChange} depth={depth} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// FieldControl — type dispatch
// ---------------------------------------------------------------------------

function FieldControl({
  field,
  value,
  onChange,
  depth,
}: {
  field: TaskFieldDescriptor;
  value: unknown;
  onChange: (value: unknown) => void;
  depth: number;
}) {
  switch (field.type) {
    case "string":
      return <StringField field={field} value={value} onChange={onChange} />;
    case "int32":
    case "float":
      return <NumberField field={field} value={value} onChange={onChange} />;
    case "bool":
      return <BoolField value={value} onChange={onChange} />;
    case "enum":
      return <EnumField field={field} value={value} onChange={onChange} />;
    case "struct":
    case "message":
      if (depth >= MAX_RECURSION_DEPTH) {
        return <JsonField value={value} onChange={onChange} />;
      }
      return <JsonField value={value} onChange={onChange} />;
    case "repeated":
      return <RepeatedField field={field} value={value} onChange={onChange} />;
    case "map":
      return <MapField value={value} onChange={onChange} />;
    default:
      return <JsonField value={value} onChange={onChange} />;
  }
}

// ---------------------------------------------------------------------------
// Concrete field controls
// ---------------------------------------------------------------------------

const inputClass =
  "w-full rounded-md border border-[var(--stgm-border,#d4d4d8)] bg-[var(--stgm-background,#fff)] px-2 py-1.5 text-xs text-[var(--stgm-foreground,#1a1a2e)] placeholder:text-[var(--stgm-muted-foreground,#a3a3a3)] focus:outline-none focus:ring-1 focus:ring-[var(--stgm-ring,#3b82f6)]";

function StringField({
  field,
  value,
  onChange,
}: {
  field: TaskFieldDescriptor;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const strValue = typeof value === "string" ? value : "";
  const isMultiline = MULTILINE_FIELD_PATTERNS.test(field.name);
  const placeholder = field.isExpression ? "${...}" : field.defaultValue ?? "";

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      onChange(e.target.value || undefined);
    },
    [onChange],
  );

  if (isMultiline) {
    return (
      <textarea
        value={strValue}
        onChange={handleChange}
        placeholder={placeholder}
        rows={4}
        className={cn(inputClass, "resize-y font-mono", field.isExpression && "border-[var(--stgm-chart-purple,#8b5cf6)]/40")}
      />
    );
  }

  return (
    <input
      type="text"
      value={strValue}
      onChange={handleChange}
      placeholder={placeholder}
      className={cn(inputClass, field.isExpression && "border-[var(--stgm-chart-purple,#8b5cf6)]/40")}
    />
  );
}

function NumberField({
  field,
  value,
  onChange,
}: {
  field: TaskFieldDescriptor;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const numValue = typeof value === "number" ? value : "";

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value;
      if (v === "") {
        onChange(undefined);
        return;
      }
      const parsed = field.type === "float" ? parseFloat(v) : parseInt(v, 10);
      if (!isNaN(parsed)) onChange(parsed);
    },
    [onChange, field.type],
  );

  return (
    <input
      type="number"
      value={numValue}
      onChange={handleChange}
      placeholder={field.defaultValue ?? ""}
      step={field.type === "float" ? "any" : "1"}
      className={inputClass}
    />
  );
}

function BoolField({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const checked = value === true;

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(e.target.checked);
    },
    [onChange],
  );

  return (
    <label className="flex cursor-pointer items-center gap-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={handleChange}
        className="h-4 w-4 rounded border-[var(--stgm-border,#d4d4d8)] text-[var(--stgm-primary,#6366f1)] focus:ring-[var(--stgm-ring,#3b82f6)]"
      />
      <span className="text-xs text-[var(--stgm-muted-foreground,#737373)]">
        {checked ? "Enabled" : "Disabled"}
      </span>
    </label>
  );
}

function EnumField({
  field,
  value,
  onChange,
}: {
  field: TaskFieldDescriptor;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const strValue = typeof value === "string" ? value : "";

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      onChange(e.target.value || undefined);
    },
    [onChange],
  );

  return (
    <select value={strValue} onChange={handleChange} className={inputClass}>
      <option value="">— Select —</option>
      {field.enumValues?.map((ev) => (
        <option key={ev} value={ev}>
          {formatEnumLabel(ev)}
        </option>
      ))}
    </select>
  );
}

function JsonField({
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
        setParseError("Invalid JSON");
      }
    },
    [onChange],
  );

  return (
    <div className="flex flex-col gap-0.5">
      <textarea
        value={localValue}
        onChange={handleChange}
        rows={4}
        className={cn(inputClass, "resize-y font-mono text-[11px]")}
        placeholder="{}"
      />
      {parseError && (
        <span className="text-[10px] text-[var(--stgm-destructive,#ef4444)]">{parseError}</span>
      )}
    </div>
  );
}

function RepeatedField({
  field,
  value,
  onChange,
}: {
  field: TaskFieldDescriptor;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const items = Array.isArray(value) ? value : [];

  const addItem = useCallback(() => {
    onChange([...items, getDefaultForType(field.elementType)]);
  }, [items, onChange, field.elementType]);

  const removeItem = useCallback(
    (idx: number) => {
      onChange(items.filter((_, i) => i !== idx));
    },
    [items, onChange],
  );

  const updateItem = useCallback(
    (idx: number, val: unknown) => {
      const next = [...items];
      next[idx] = val;
      onChange(next);
    },
    [items, onChange],
  );

  return (
    <div className="flex flex-col gap-1.5">
      {items.map((item, idx) => (
        <div key={idx} className="flex items-start gap-1">
          <input
            type="text"
            value={typeof item === "string" ? item : JSON.stringify(item ?? "")}
            onChange={(e) => updateItem(idx, e.target.value || undefined)}
            className={cn(inputClass, "flex-1")}
          />
          <button
            type="button"
            onClick={() => removeItem(idx)}
            className="mt-1 text-[10px] text-[var(--stgm-destructive,#ef4444)] hover:underline"
            aria-label={`Remove item ${idx + 1}`}
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addItem}
        className="self-start text-[11px] font-medium text-[var(--stgm-primary,#6366f1)] hover:underline"
      >
        + Add item
      </button>
    </div>
  );
}

function MapField({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const obj = (value != null && typeof value === "object" && !Array.isArray(value))
    ? value as Record<string, unknown>
    : {};
  const entries = Object.entries(obj);

  const addEntry = useCallback(() => {
    onChange({ ...obj, "": "" });
  }, [obj, onChange]);

  const removeEntry = useCallback(
    (key: string) => {
      const { [key]: _, ...rest } = obj;
      onChange(Object.keys(rest).length > 0 ? rest : undefined);
    },
    [obj, onChange],
  );

  const updateEntry = useCallback(
    (oldKey: string, newKey: string, val: unknown) => {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        if (k === oldKey) {
          result[newKey] = val;
        } else {
          result[k] = v;
        }
      }
      onChange(result);
    },
    [obj, onChange],
  );

  return (
    <div className="flex flex-col gap-1.5">
      {entries.map(([key, val], idx) => (
        <div key={idx} className="flex items-start gap-1">
          <input
            type="text"
            value={key}
            onChange={(e) => updateEntry(key, e.target.value, val)}
            placeholder="key"
            className={cn(inputClass, "w-1/3")}
          />
          <input
            type="text"
            value={typeof val === "string" ? val : JSON.stringify(val ?? "")}
            onChange={(e) => updateEntry(key, key, e.target.value || undefined)}
            placeholder="value"
            className={cn(inputClass, "flex-1")}
          />
          <button
            type="button"
            onClick={() => removeEntry(key)}
            className="mt-1 text-[10px] text-[var(--stgm-destructive,#ef4444)] hover:underline"
            aria-label={`Remove entry ${key}`}
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addEntry}
        className="self-start text-[11px] font-medium text-[var(--stgm-primary,#6366f1)] hover:underline"
      >
        + Add entry
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ChevronIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("transition-transform", !collapsed && "rotate-90")}
    >
      <path d="M6 4l4 4-4 4" />
    </svg>
  );
}

function groupFieldsByGroup(
  fields: readonly TaskFieldDescriptor[],
  fieldGroups: readonly TaskFieldGroup[],
): FieldGroupSectionData[] {
  const groupMap = new Map<string, TaskFieldDescriptor[]>();
  const ungrouped: TaskFieldDescriptor[] = [];

  for (const field of fields) {
    if (field.groupId) {
      const existing = groupMap.get(field.groupId);
      if (existing) {
        existing.push(field);
      } else {
        groupMap.set(field.groupId, [field]);
      }
    } else {
      ungrouped.push(field);
    }
  }

  const result: FieldGroupSectionData[] = [];

  if (ungrouped.length > 0) {
    result.push({ id: "__general", displayName: "General", fields: ungrouped });
  }

  for (const group of fieldGroups) {
    const groupFields = groupMap.get(group.id);
    if (groupFields && groupFields.length > 0) {
      result.push({
        id: group.id,
        displayName: group.displayName,
        description: group.description,
        fields: groupFields,
      });
    }
  }

  return result;
}

function getFieldValue(config: JsonObject, fieldName: string): unknown {
  return (config as Record<string, unknown>)[fieldName];
}

function formatEnumLabel(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function getDefaultForType(elementType?: string): unknown {
  switch (elementType) {
    case "int32":
    case "float":
      return 0;
    case "bool":
      return false;
    default:
      return "";
  }
}
