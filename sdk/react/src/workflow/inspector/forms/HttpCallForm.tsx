"use client";

import { memo, useState, useCallback, useMemo } from "react";
import type { JsonObject } from "@bufbuild/protobuf";
import type { WorkflowGraphNode } from "../../workflow-graph-model";

/** Props for {@link HttpCallForm}. */
export interface HttpCallFormProps {
  readonly node: WorkflowGraphNode;
  readonly onFieldChange: (fieldPath: string, value: unknown) => void;
}

const HTTP_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"] as const;
const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);

const inputClass =
  "w-full rounded-md border border-[var(--stgm-border,#d4d4d8)] bg-[var(--stgm-background,#fff)] px-2 py-1.5 text-xs text-[var(--stgm-foreground,#1a1a2e)] placeholder:text-[var(--stgm-muted-foreground,#a3a3a3)] focus:outline-none focus:ring-1 focus:ring-[var(--stgm-ring,#3b82f6)]";

/**
 * Specialized configuration form for `http_call` tasks.
 *
 * Organizes HTTP-specific fields into semantic sections: method + URL,
 * headers, request body, and timeout. Body section is only visible
 * for methods that support a request body (POST, PUT, PATCH).
 *
 * @since T10 (Inspector Panel Refactor)
 */
export const HttpCallForm = memo(function HttpCallForm({
  node,
  onFieldChange,
}: HttpCallFormProps) {
  const config = node.config as Record<string, unknown>;
  const endpoint = (config.endpoint ?? {}) as Record<string, unknown>;
  const method = typeof config.method === "string" ? config.method : "GET";
  const showBody = BODY_METHODS.has(method);

  const handleChange = useCallback(
    (field: string, value: unknown) => {
      onFieldChange(field, value === "" ? undefined : value);
    },
    [onFieldChange],
  );

  const handleEndpointChange = useCallback(
    (field: string, value: unknown) => {
      onFieldChange("endpoint", {
        ...endpoint,
        [field]: value === "" ? undefined : value,
      });
    },
    [endpoint, onFieldChange],
  );

  const headers = useMemo(() => {
    const h = config.headers;
    if (!h || typeof h !== "object" || Array.isArray(h)) return {};
    return h as Record<string, unknown>;
  }, [config.headers]);

  const headerEntries = useMemo(() => Object.entries(headers), [headers]);

  const handleHeaderChange = useCallback(
    (oldKey: string, newKey: string, value: unknown) => {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(headers)) {
        if (k === oldKey) {
          result[newKey] = value;
        } else {
          result[k] = v;
        }
      }
      handleChange("headers", Object.keys(result).length > 0 ? result : undefined);
    },
    [headers, handleChange],
  );

  const addHeader = useCallback(() => {
    handleChange("headers", { ...headers, "": "" });
  }, [headers, handleChange]);

  const removeHeader = useCallback(
    (key: string) => {
      const { [key]: _, ...rest } = headers;
      handleChange("headers", Object.keys(rest).length > 0 ? rest : undefined);
    },
    [headers, handleChange],
  );

  const [bodyValue, setBodyValue] = useState(
    config.body != null ? JSON.stringify(config.body, null, 2) : "",
  );
  const [bodyError, setBodyError] = useState<string | null>(null);

  const handleBodyChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const raw = e.target.value;
      setBodyValue(raw);
      if (!raw.trim()) {
        setBodyError(null);
        handleChange("body", undefined);
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        setBodyError(null);
        handleChange("body", parsed);
      } catch {
        setBodyError("Invalid JSON");
      }
    },
    [handleChange],
  );

  return (
    <div className="flex flex-col gap-4 px-3 py-3">
      {/* Method + URL */}
      <section className="flex flex-col gap-2">
        <SectionLabel>Request</SectionLabel>
        <div className="flex gap-2">
          <select
            value={method}
            onChange={(e) => handleChange("method", e.target.value)}
            className={`${inputClass} w-24 shrink-0`}
            data-testid="http-call-method-select"
          >
            {HTTP_METHODS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <input
            type="text"
            value={typeof endpoint.uri === "string" ? endpoint.uri : ""}
            onChange={(e) => handleEndpointChange("uri", e.target.value)}
            placeholder="https://api.example.com/data"
            className={`${inputClass} flex-1 font-mono border-[var(--stgm-chart-purple,#8b5cf6)]/40`}
            data-testid="http-call-url-input"
          />
        </div>
      </section>

      {/* Headers */}
      <section className="flex flex-col gap-2">
        <SectionLabel>Headers</SectionLabel>
        {headerEntries.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {headerEntries.map(([key, val], idx) => (
              <div key={idx} className="flex items-start gap-1">
                <input
                  type="text"
                  value={key}
                  onChange={(e) => handleHeaderChange(key, e.target.value, val)}
                  placeholder="Header name"
                  className={`${inputClass} w-2/5`}
                />
                <input
                  type="text"
                  value={typeof val === "string" ? val : ""}
                  onChange={(e) => handleHeaderChange(key, key, e.target.value)}
                  placeholder="Value"
                  className={`${inputClass} flex-1`}
                />
                <button
                  type="button"
                  onClick={() => removeHeader(key)}
                  className="mt-1 text-[10px] text-[var(--stgm-destructive,#ef4444)] hover:underline"
                  aria-label={`Remove header ${key}`}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={addHeader}
          className="self-start text-[11px] font-medium text-[var(--stgm-primary,#6366f1)] hover:underline"
        >
          + Add header
        </button>
      </section>

      {/* Body */}
      {showBody && (
        <section className="flex flex-col gap-2">
          <SectionLabel>Body</SectionLabel>
          <div className="flex flex-col gap-0.5">
            <textarea
              value={bodyValue}
              onChange={handleBodyChange}
              rows={5}
              className={`${inputClass} resize-y font-mono text-[11px]`}
              placeholder='{ "key": "value" }'
              data-testid="http-call-body-input"
            />
            {bodyError && (
              <span className="text-[10px] text-[var(--stgm-destructive,#ef4444)]">{bodyError}</span>
            )}
          </div>
        </section>
      )}

      {/* Timeout */}
      <section className="flex flex-col gap-2">
        <SectionLabel>Settings</SectionLabel>
        <FieldRow label="Timeout" hint="Seconds (1–300)">
          <input
            type="number"
            value={typeof config.timeout_seconds === "number" ? config.timeout_seconds : ""}
            onChange={(e) => handleChange("timeout_seconds", e.target.value ? parseInt(e.target.value, 10) : undefined)}
            placeholder="30"
            min={1}
            max={300}
            className={inputClass}
          />
        </FieldRow>
      </section>
    </div>
  );
});

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
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-medium text-[var(--stgm-foreground,#1a1a2e)]">{label}</label>
      {hint && (
        <p className="text-[10px] leading-tight text-[var(--stgm-muted-foreground,#737373)]">{hint}</p>
      )}
      {children}
    </div>
  );
}
