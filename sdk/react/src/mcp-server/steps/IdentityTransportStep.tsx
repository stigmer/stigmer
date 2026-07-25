"use client";

import { useCallback } from "react";
import { cn } from "@stigmer/theme";
import { generateSlug } from "../../internal/slug.js";
import type { McpServerWizardData, KeyValueEntry } from "./types.js";

/** Props for {@link IdentityTransportStep}. */
export interface IdentityTransportStepProps {
  readonly data: McpServerWizardData;
  readonly updateData: (partial: Partial<McpServerWizardData>) => void;
  readonly validationError: string | null;
}

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Wizard step 1: MCP server identity and transport configuration.
 *
 * Collects: name (required), slug (auto-derived), description,
 * icon URL, visibility, transport type (HTTP vs Stdio), and the
 * transport-specific fields.
 *
 * Transport type uses a radio group (mutually exclusive modes).
 * Conditional fields render based on the selected transport.
 *
 * Fully presentational: state lives in the `data` prop and every edit
 * flows out through `updateData`. Inside `McpServerCreationWizard` that
 * state comes from `useWizardState`; standalone consumers (embedded
 * builders, guided tours) can render any form state — including a
 * `validationError` — deterministically from props.
 */
export function IdentityTransportStep({
  data,
  updateData,
  validationError,
}: IdentityTransportStepProps) {
  const handleNameChange = useCallback(
    (value: string) => {
      if (!data.slugTouched) {
        updateData({ name: value, slug: generateSlug(value) });
      } else {
        updateData({ name: value });
      }
    },
    [data.slugTouched, updateData],
  );

  const handleSlugChange = useCallback(
    (value: string) => {
      updateData({ slug: value, slugTouched: true });
    },
    [updateData],
  );

  const slugError =
    data.slug.length > 0 && !SLUG_PATTERN.test(data.slug)
      ? "Slug must be lowercase letters, numbers, and hyphens only"
      : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">
          Identity & Transport
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Define the MCP server and how to connect to it.
        </p>
      </div>

      {validationError && (
        <p className="text-sm text-destructive" role="alert">
          {validationError}
        </p>
      )}

      {/* Name + Slug */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label
            htmlFor="stgm-wizard-mcp-name"
            className="text-sm font-medium text-foreground"
          >
            Name <span className="text-destructive">*</span>
          </label>
          <input
            id="stgm-wizard-mcp-name"
            type="text"
            value={data.name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="e.g. GitHub"
            autoFocus
            className={cn(
              "w-full rounded-md border border-input bg-input-bg px-3 py-2 text-sm text-foreground",
              "placeholder:text-muted-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          />
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="stgm-wizard-mcp-slug"
            className="text-sm font-medium text-foreground"
          >
            Slug
          </label>
          <input
            id="stgm-wizard-mcp-slug"
            type="text"
            value={data.slug}
            onChange={(e) => handleSlugChange(e.target.value)}
            placeholder="auto-generated"
            className={cn(
              "w-full rounded-md border px-3 py-2 font-mono text-sm text-foreground",
              slugError
                ? "border-destructive bg-input-bg"
                : "border-input bg-input-bg",
              "placeholder:text-muted-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          />
          {slugError && (
            <p className="text-xs text-destructive">{slugError}</p>
          )}
          {!slugError && data.slug && (
            <p className="text-xs text-muted-foreground">
              Referenced as <code className="font-mono">{data.slug}</code>
            </p>
          )}
        </div>
      </div>

      {/* Description */}
      <div className="space-y-1.5">
        <label
          htmlFor="stgm-wizard-mcp-description"
          className="text-sm font-medium text-foreground"
        >
          Description
        </label>
        <input
          id="stgm-wizard-mcp-description"
          type="text"
          value={data.description}
          onChange={(e) => updateData({ description: e.target.value })}
          placeholder="A brief description of this MCP server"
          maxLength={200}
          className={cn(
            "w-full rounded-md border border-input bg-input-bg px-3 py-2 text-sm text-foreground",
            "placeholder:text-muted-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        />
      </div>

      {/* Icon URL + Visibility */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label
            htmlFor="stgm-wizard-mcp-icon"
            className="text-sm font-medium text-foreground"
          >
            Icon URL
          </label>
          <input
            id="stgm-wizard-mcp-icon"
            type="url"
            value={data.iconUrl}
            onChange={(e) => updateData({ iconUrl: e.target.value })}
            placeholder="https://example.com/icon.png"
            className={cn(
              "w-full rounded-md border border-input bg-input-bg px-3 py-2 text-sm text-foreground",
              "placeholder:text-muted-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          />
        </div>

        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium text-foreground">
            Visibility
          </legend>
          <div className="flex gap-2">
            <RadioOption
              name="stgm-wizard-mcp-visibility"
              value="private"
              label="Private"
              checked={data.visibility === "private"}
              onChange={() => updateData({ visibility: "private" })}
            />
            <RadioOption
              name="stgm-wizard-mcp-visibility"
              value="public"
              label="Public"
              checked={data.visibility === "public"}
              onChange={() => updateData({ visibility: "public" })}
            />
          </div>
        </fieldset>
      </div>

      {/* data-scroll-target: guided tours/demos scroll the transport config
          (the step's decision point) into view within the wizard's scroll area. */}
      <fieldset className="space-y-3" data-scroll-target="mcp-transport">
        <legend className="text-sm font-medium text-foreground">
          Transport <span className="text-destructive">*</span>
        </legend>
        <div className="flex gap-2">
          <RadioOption
            name="stgm-wizard-mcp-transport"
            value="http"
            label="HTTP (Streamable HTTP / SSE)"
            checked={data.transportType === "http"}
            onChange={() => updateData({ transportType: "http" })}
          />
          <RadioOption
            name="stgm-wizard-mcp-transport"
            value="stdio"
            label="Stdio (local process)"
            checked={data.transportType === "stdio"}
            onChange={() => updateData({ transportType: "stdio" })}
          />
        </div>

        {/* HTTP fields */}
        {data.transportType === "http" && (
          <div className="flex flex-col gap-4 rounded-lg border border-border p-4">
            <div className="space-y-1.5">
              <label
                htmlFor="stgm-wizard-mcp-http-url"
                className="text-sm font-medium text-foreground"
              >
                URL <span className="text-destructive">*</span>
              </label>
              <input
                id="stgm-wizard-mcp-http-url"
                type="url"
                value={data.httpUrl}
                onChange={(e) => updateData({ httpUrl: e.target.value })}
                placeholder="https://mcp.example.com/sse"
                className={cn(
                  "w-full rounded-md border border-input bg-input-bg px-3 py-2 font-mono text-sm text-foreground",
                  "placeholder:text-muted-foreground",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
                Headers
              </label>
              <p className="text-xs text-muted-foreground">
                Custom HTTP headers sent with every request. Values may use{" "}
                <code className="font-mono text-[11px]">{"${VAR}"}</code>{" "}
                placeholders.
              </p>
              <KeyValueEditor
                entries={data.httpHeaders}
                onChange={(httpHeaders) => updateData({ httpHeaders })}
                keyPlaceholder="Header-Name"
                valuePlaceholder="value"
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="stgm-wizard-mcp-http-timeout"
                className="text-sm font-medium text-foreground"
              >
                Timeout (seconds)
              </label>
              <input
                id="stgm-wizard-mcp-http-timeout"
                type="number"
                min={0}
                step={1}
                value={data.httpTimeoutSeconds || ""}
                onChange={(e) =>
                  updateData({
                    httpTimeoutSeconds: e.target.value
                      ? parseInt(e.target.value, 10)
                      : 0,
                  })
                }
                placeholder="Default"
                className={cn(
                  "w-32 rounded-md border border-input bg-input-bg px-3 py-2 text-sm text-foreground",
                  "placeholder:text-muted-foreground",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              />
            </div>
          </div>
        )}

        {/* Stdio fields */}
        {data.transportType === "stdio" && (
          <div className="flex flex-col gap-4 rounded-lg border border-border p-4">
            <div className="space-y-1.5">
              <label
                htmlFor="stgm-wizard-mcp-stdio-command"
                className="text-sm font-medium text-foreground"
              >
                Command <span className="text-destructive">*</span>
              </label>
              <input
                id="stgm-wizard-mcp-stdio-command"
                type="text"
                value={data.stdioCommand}
                onChange={(e) => updateData({ stdioCommand: e.target.value })}
                placeholder="e.g. npx, python, node"
                className={cn(
                  "w-full rounded-md border border-input bg-input-bg px-3 py-2 font-mono text-sm text-foreground",
                  "placeholder:text-muted-foreground",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="stgm-wizard-mcp-stdio-args"
                className="text-sm font-medium text-foreground"
              >
                Arguments
              </label>
              <input
                id="stgm-wizard-mcp-stdio-args"
                type="text"
                value={data.stdioArgs}
                onChange={(e) => updateData({ stdioArgs: e.target.value })}
                placeholder="e.g. -y @modelcontextprotocol/server-github"
                className={cn(
                  "w-full rounded-md border border-input bg-input-bg px-3 py-2 font-mono text-sm text-foreground",
                  "placeholder:text-muted-foreground",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              />
              <p className="text-xs text-muted-foreground">
                Space-separated arguments passed to the command.
              </p>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="stgm-wizard-mcp-stdio-workdir"
                className="text-sm font-medium text-foreground"
              >
                Working Directory
              </label>
              <input
                id="stgm-wizard-mcp-stdio-workdir"
                type="text"
                value={data.stdioWorkingDir}
                onChange={(e) =>
                  updateData({ stdioWorkingDir: e.target.value })
                }
                placeholder="/path/to/working/directory"
                className={cn(
                  "w-full rounded-md border border-input bg-input-bg px-3 py-2 font-mono text-sm text-foreground",
                  "placeholder:text-muted-foreground",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              />
            </div>
          </div>
        )}
      </fieldset>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Radio option (reusable within this step)
// ---------------------------------------------------------------------------

function RadioOption({
  name,
  value,
  label,
  checked,
  onChange,
}: {
  readonly name: string;
  readonly value: string;
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: () => void;
}) {
  return (
    <label
      className={cn(
        "inline-flex cursor-pointer items-center rounded-md border px-3 py-1.5 text-sm transition-colors",
        checked
          ? "border-primary bg-primary-subtle text-primary font-medium"
          : "border-input bg-input-bg text-muted-foreground hover:border-border hover:text-foreground",
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className="sr-only"
      />
      {label}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Key-value editor (for HTTP headers)
// ---------------------------------------------------------------------------

function KeyValueEditor({
  entries,
  onChange,
  keyPlaceholder,
  valuePlaceholder,
}: {
  readonly entries: readonly KeyValueEntry[];
  readonly onChange: (entries: KeyValueEntry[]) => void;
  readonly keyPlaceholder: string;
  readonly valuePlaceholder: string;
}) {
  const addEntry = () => {
    onChange([...entries, { key: "", value: "" }]);
  };

  const updateEntry = (index: number, partial: Partial<KeyValueEntry>) => {
    const updated = entries.map((entry, i) =>
      i === index ? { ...entry, ...partial } : entry,
    );
    onChange(updated);
  };

  const removeEntry = (index: number) => {
    onChange(entries.filter((_, i) => i !== index));
  };

  return (
    <div className="flex flex-col gap-2">
      {entries.map((entry, index) => (
        <div key={index} className="flex items-center gap-2">
          <input
            type="text"
            value={entry.key}
            onChange={(e) => updateEntry(index, { key: e.target.value })}
            placeholder={keyPlaceholder}
            aria-label={`Header key ${index + 1}`}
            className={cn(
              "flex-1 rounded-md border border-input bg-input-bg px-2.5 py-1.5 font-mono text-xs text-foreground",
              "placeholder:text-muted-foreground",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            )}
          />
          <input
            type="text"
            value={entry.value}
            onChange={(e) => updateEntry(index, { value: e.target.value })}
            placeholder={valuePlaceholder}
            aria-label={`Header value ${index + 1}`}
            className={cn(
              "flex-1 rounded-md border border-input bg-input-bg px-2.5 py-1.5 font-mono text-xs text-foreground",
              "placeholder:text-muted-foreground",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            )}
          />
          <button
            type="button"
            onClick={() => removeEntry(index)}
            aria-label={`Remove header ${entry.key || index + 1}`}
            className={cn(
              "rounded p-1 text-muted-foreground transition-colors",
              "hover:bg-accent-hover hover:text-destructive",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            <RemoveIcon className="size-3.5" />
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={addEntry}
        className={cn(
          "inline-flex w-fit items-center gap-1.5 rounded-md border border-dashed border-input px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors",
          "hover:border-border hover:text-foreground hover:bg-accent-hover",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <PlusIcon className="size-3" />
        Add header
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function PlusIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

function RemoveIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}
