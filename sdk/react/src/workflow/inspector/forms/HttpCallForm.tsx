"use client";

import { memo, useState, useCallback, useMemo } from "react";
import type { JsonObject } from "@bufbuild/protobuf";
import type { WorkflowGraphNode } from "../../workflow-graph-model.js";

/** Props for {@link HttpCallForm}. */
export interface HttpCallFormProps {
  readonly node: WorkflowGraphNode;
  readonly onFieldChange: (fieldPath: string, value: unknown) => void;
}

const HTTP_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"] as const;
const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);

const inputClass =
  "stg:w-full stg:rounded-md stg:border stg:border-[var(--stgm-border,#d4d4d8)] stg:bg-[var(--stgm-background,#fff)] stg:px-2 stg:py-1.5 stg:text-xs stg:text-[var(--stgm-foreground,#1a1a2e)] stg:placeholder:text-[var(--stgm-muted-foreground,#a3a3a3)] stg:focus:outline-none stg:focus:ring-1 stg:focus:ring-[var(--stgm-ring,#3b82f6)]";

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
    <div className="stg:flex stg:flex-col stg:gap-4 stg:px-3 stg:py-3">
      {/* Method + URL */}
      <section className="stg:flex stg:flex-col stg:gap-2">
        <SectionLabel>Request</SectionLabel>
        <div className="stg:flex stg:gap-2">
          <select
            value={method}
            onChange={(e) => handleChange("method", e.target.value)}
            className={`${inputClass} stg:w-24 stg:shrink-0`}
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
            className={`${inputClass} stg:flex-1 stg:font-mono stg:border-[var(--stgm-chart-purple,#8b5cf6)]/40`}
            data-testid="http-call-url-input"
          />
        </div>
      </section>

      {/* Headers */}
      <section className="stg:flex stg:flex-col stg:gap-2">
        <SectionLabel>Headers</SectionLabel>
        {headerEntries.length > 0 && (
          <div className="stg:flex stg:flex-col stg:gap-1.5">
            {headerEntries.map(([key, val], idx) => (
              <div key={idx} className="stg:flex stg:items-start stg:gap-1">
                <input
                  type="text"
                  value={key}
                  onChange={(e) => handleHeaderChange(key, e.target.value, val)}
                  placeholder="Header name"
                  className={`${inputClass} stg:w-2/5`}
                />
                <input
                  type="text"
                  value={typeof val === "string" ? val : ""}
                  onChange={(e) => handleHeaderChange(key, key, e.target.value)}
                  placeholder="Value"
                  className={`${inputClass} stg:flex-1`}
                />
                <button
                  type="button"
                  onClick={() => removeHeader(key)}
                  className="stg:mt-1 stg:text-[10px] stg:text-[var(--stgm-destructive,#ef4444)] stg:hover:underline"
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
          className="stg:self-start stg:text-[11px] stg:font-medium stg:text-[var(--stgm-primary,#6366f1)] stg:hover:underline"
        >
          + Add header
        </button>
      </section>

      {/* Body */}
      {showBody && (
        <section className="stg:flex stg:flex-col stg:gap-2">
          <SectionLabel>Body</SectionLabel>
          <div className="stg:flex stg:flex-col stg:gap-0.5">
            <textarea
              value={bodyValue}
              onChange={handleBodyChange}
              rows={5}
              className={`${inputClass} stg:resize-y stg:font-mono stg:text-[11px]`}
              placeholder='{ "key": "value" }'
              data-testid="http-call-body-input"
            />
            {bodyError && (
              <span className="stg:text-[10px] stg:text-[var(--stgm-destructive,#ef4444)]">{bodyError}</span>
            )}
          </div>
        </section>
      )}

      {/* Timeout */}
      <section className="stg:flex stg:flex-col stg:gap-2">
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
    <h4 className="stg:text-[11px] stg:font-semibold stg:uppercase stg:tracking-wide stg:text-[var(--stgm-muted-foreground,#737373)]">
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
    <div className="stg:flex stg:flex-col stg:gap-1">
      <label className="stg:text-[11px] stg:font-medium stg:text-[var(--stgm-foreground,#1a1a2e)]">{label}</label>
      {hint && (
        <p className="stg:text-[10px] stg:leading-tight stg:text-[var(--stgm-muted-foreground,#737373)]">{hint}</p>
      )}
      {children}
    </div>
  );
}
