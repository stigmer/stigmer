"use client";

import { useCallback, useId } from "react";
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
  const baseId = useId();
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
    <div className="stg:flex stg:flex-col stg:gap-6">
      <div>
        <h2 className="stg:text-lg stg:font-semibold stg:text-foreground">
          Identity & Transport
        </h2>
        <p className="stg:mt-1 stg:text-sm stg:text-muted-foreground">
          Define the MCP server and how to connect to it.
        </p>
      </div>

      {validationError && (
        <p className="stg:text-sm stg:text-destructive" role="alert">
          {validationError}
        </p>
      )}

      {/* Name + Slug */}
      <div className="stg:grid stg:gap-4 stg:sm:grid-cols-2">
        <div className="stg:space-y-1.5">
          <label
            htmlFor={`${baseId}-name`}
            className="stg:text-sm stg:font-medium stg:text-foreground"
          >
            Name <span className="stg:text-destructive">*</span>
          </label>
          <input
            id={`${baseId}-name`}
            type="text"
            value={data.name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="e.g. GitHub"
            autoFocus
            className={cn(
              "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-input-bg stg:px-3 stg:py-2 stg:text-sm stg:text-foreground",
              "stg:placeholder:text-muted-foreground",
              "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
            )}
          />
        </div>

        <div className="stg:space-y-1.5">
          <label
            htmlFor={`${baseId}-slug`}
            className="stg:text-sm stg:font-medium stg:text-foreground"
          >
            Slug
          </label>
          <input
            id={`${baseId}-slug`}
            type="text"
            value={data.slug}
            onChange={(e) => handleSlugChange(e.target.value)}
            placeholder="auto-generated"
            className={cn(
              "stg:w-full stg:rounded-md stg:border stg:px-3 stg:py-2 stg:font-mono stg:text-sm stg:text-foreground",
              slugError
                ? "stg:border-destructive stg:bg-input-bg"
                : "stg:border-input stg:bg-input-bg",
              "stg:placeholder:text-muted-foreground",
              "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
            )}
          />
          {slugError && (
            <p className="stg:text-xs stg:text-destructive">{slugError}</p>
          )}
          {!slugError && data.slug && (
            <p className="stg:text-xs stg:text-muted-foreground">
              Referenced as <code className="stg:font-mono">{data.slug}</code>
            </p>
          )}
        </div>
      </div>

      {/* Description */}
      <div className="stg:space-y-1.5">
        <label
          htmlFor={`${baseId}-description`}
          className="stg:text-sm stg:font-medium stg:text-foreground"
        >
          Description
        </label>
        <input
          id={`${baseId}-description`}
          type="text"
          value={data.description}
          onChange={(e) => updateData({ description: e.target.value })}
          placeholder="A brief description of this MCP server"
          maxLength={200}
          className={cn(
            "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-input-bg stg:px-3 stg:py-2 stg:text-sm stg:text-foreground",
            "stg:placeholder:text-muted-foreground",
            "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
          )}
        />
      </div>

      {/* Icon URL + Visibility */}
      <div className="stg:grid stg:gap-4 stg:sm:grid-cols-2">
        <div className="stg:space-y-1.5">
          <label
            htmlFor={`${baseId}-icon`}
            className="stg:text-sm stg:font-medium stg:text-foreground"
          >
            Icon URL
          </label>
          <input
            id={`${baseId}-icon`}
            type="url"
            value={data.iconUrl}
            onChange={(e) => updateData({ iconUrl: e.target.value })}
            placeholder="https://example.com/icon.png"
            className={cn(
              "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-input-bg stg:px-3 stg:py-2 stg:text-sm stg:text-foreground",
              "stg:placeholder:text-muted-foreground",
              "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
            )}
          />
        </div>

        <fieldset className="stg:space-y-1.5">
          <legend className="stg:text-sm stg:font-medium stg:text-foreground">
            Visibility
          </legend>
          <div className="stg:flex stg:gap-2">
            <RadioOption
              name={`${baseId}-visibility`}
              value="private"
              label="Private"
              checked={data.visibility === "private"}
              onChange={() => updateData({ visibility: "private" })}
            />
            <RadioOption
              name={`${baseId}-visibility`}
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
      <fieldset className="stg:space-y-3" data-scroll-target="mcp-transport">
        <legend className="stg:text-sm stg:font-medium stg:text-foreground">
          Transport <span className="stg:text-destructive">*</span>
        </legend>
        <div className="stg:flex stg:gap-2">
          <RadioOption
            name={`${baseId}-transport`}
            value="http"
            label="HTTP (Streamable HTTP / SSE)"
            checked={data.transportType === "http"}
            onChange={() => updateData({ transportType: "http" })}
          />
          <RadioOption
            name={`${baseId}-transport`}
            value="stdio"
            label="Stdio (local process)"
            checked={data.transportType === "stdio"}
            onChange={() => updateData({ transportType: "stdio" })}
          />
        </div>
        {data.transportType === "stdio" && (
          <p className="stg:text-xs stg:text-muted-foreground">
            Stdio servers run only on local runners (desktop app or CLI).
            Sessions on Stigmer-managed cloud compute require a remote (HTTP)
            server.
          </p>
        )}

        {/* HTTP fields */}
        {data.transportType === "http" && (
          <div className="stg:flex stg:flex-col stg:gap-4 stg:rounded-lg stg:border stg:border-border stg:p-4">
            <div className="stg:space-y-1.5">
              <label
                htmlFor={`${baseId}-http-url`}
                className="stg:text-sm stg:font-medium stg:text-foreground"
              >
                URL <span className="stg:text-destructive">*</span>
              </label>
              <input
                id={`${baseId}-http-url`}
                type="url"
                value={data.httpUrl}
                onChange={(e) => updateData({ httpUrl: e.target.value })}
                placeholder="https://mcp.example.com/sse"
                className={cn(
                  "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-input-bg stg:px-3 stg:py-2 stg:font-mono stg:text-sm stg:text-foreground",
                  "stg:placeholder:text-muted-foreground",
                  "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
                )}
              />
            </div>

            <div className="stg:space-y-1.5">
              <label className="stg:text-sm stg:font-medium stg:text-foreground">
                Headers
              </label>
              <p className="stg:text-xs stg:text-muted-foreground">
                Custom HTTP headers sent with every request. Values may use{" "}
                <code className="stg:font-mono stg:text-[11px]">{"${VAR}"}</code>{" "}
                placeholders.
              </p>
              <KeyValueEditor
                entries={data.httpHeaders}
                onChange={(httpHeaders) => updateData({ httpHeaders })}
                keyPlaceholder="Header-Name"
                valuePlaceholder="value"
              />
            </div>

            <div className="stg:space-y-1.5">
              <label
                htmlFor={`${baseId}-http-timeout`}
                className="stg:text-sm stg:font-medium stg:text-foreground"
              >
                Timeout (seconds)
              </label>
              <input
                id={`${baseId}-http-timeout`}
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
                  "stg:w-32 stg:rounded-md stg:border stg:border-input stg:bg-input-bg stg:px-3 stg:py-2 stg:text-sm stg:text-foreground",
                  "stg:placeholder:text-muted-foreground",
                  "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
                )}
              />
            </div>
          </div>
        )}

        {/* Stdio fields */}
        {data.transportType === "stdio" && (
          <div className="stg:flex stg:flex-col stg:gap-4 stg:rounded-lg stg:border stg:border-border stg:p-4">
            <div className="stg:space-y-1.5">
              <label
                htmlFor={`${baseId}-stdio-command`}
                className="stg:text-sm stg:font-medium stg:text-foreground"
              >
                Command <span className="stg:text-destructive">*</span>
              </label>
              <input
                id={`${baseId}-stdio-command`}
                type="text"
                value={data.stdioCommand}
                onChange={(e) => updateData({ stdioCommand: e.target.value })}
                placeholder="e.g. npx, python, node"
                className={cn(
                  "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-input-bg stg:px-3 stg:py-2 stg:font-mono stg:text-sm stg:text-foreground",
                  "stg:placeholder:text-muted-foreground",
                  "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
                )}
              />
            </div>

            <div className="stg:space-y-1.5">
              <label
                htmlFor={`${baseId}-stdio-args`}
                className="stg:text-sm stg:font-medium stg:text-foreground"
              >
                Arguments
              </label>
              <input
                id={`${baseId}-stdio-args`}
                type="text"
                value={data.stdioArgs}
                onChange={(e) => updateData({ stdioArgs: e.target.value })}
                placeholder="e.g. -y @modelcontextprotocol/server-github"
                className={cn(
                  "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-input-bg stg:px-3 stg:py-2 stg:font-mono stg:text-sm stg:text-foreground",
                  "stg:placeholder:text-muted-foreground",
                  "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
                )}
              />
              <p className="stg:text-xs stg:text-muted-foreground">
                Space-separated arguments passed to the command.
              </p>
            </div>

            <div className="stg:space-y-1.5">
              <label
                htmlFor={`${baseId}-stdio-workdir`}
                className="stg:text-sm stg:font-medium stg:text-foreground"
              >
                Working Directory
              </label>
              <input
                id={`${baseId}-stdio-workdir`}
                type="text"
                value={data.stdioWorkingDir}
                onChange={(e) =>
                  updateData({ stdioWorkingDir: e.target.value })
                }
                placeholder="/path/to/working/directory"
                className={cn(
                  "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-input-bg stg:px-3 stg:py-2 stg:font-mono stg:text-sm stg:text-foreground",
                  "stg:placeholder:text-muted-foreground",
                  "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
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
        "stg:inline-flex stg:cursor-pointer stg:items-center stg:rounded-md stg:border stg:px-3 stg:py-1.5 stg:text-sm stg:transition-colors",
        checked
          ? "stg:border-primary stg:bg-primary-subtle stg:text-primary stg:font-medium"
          : "stg:border-input stg:bg-input-bg stg:text-muted-foreground stg:hover:border-border stg:hover:text-foreground",
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className="stg:sr-only"
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
    <div className="stg:flex stg:flex-col stg:gap-2">
      {entries.map((entry, index) => (
        <div key={index} className="stg:flex stg:items-center stg:gap-2">
          <input
            type="text"
            value={entry.key}
            onChange={(e) => updateEntry(index, { key: e.target.value })}
            placeholder={keyPlaceholder}
            aria-label={`Header key ${index + 1}`}
            className={cn(
              "stg:flex-1 stg:rounded-md stg:border stg:border-input stg:bg-input-bg stg:px-2.5 stg:py-1.5 stg:font-mono stg:text-xs stg:text-foreground",
              "stg:placeholder:text-muted-foreground",
              "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
            )}
          />
          <input
            type="text"
            value={entry.value}
            onChange={(e) => updateEntry(index, { value: e.target.value })}
            placeholder={valuePlaceholder}
            aria-label={`Header value ${index + 1}`}
            className={cn(
              "stg:flex-1 stg:rounded-md stg:border stg:border-input stg:bg-input-bg stg:px-2.5 stg:py-1.5 stg:font-mono stg:text-xs stg:text-foreground",
              "stg:placeholder:text-muted-foreground",
              "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
            )}
          />
          <button
            type="button"
            onClick={() => removeEntry(index)}
            aria-label={`Remove header ${entry.key || index + 1}`}
            className={cn(
              "stg:rounded stg:p-1 stg:text-muted-foreground stg:transition-colors",
              "stg:hover:bg-accent-hover stg:hover:text-destructive",
              "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
            )}
          >
            <RemoveIcon className="stg:size-3.5" />
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={addEntry}
        className={cn(
          "stg:inline-flex stg:w-fit stg:items-center stg:gap-1.5 stg:rounded-md stg:border stg:border-dashed stg:border-input stg:px-3 stg:py-1.5 stg:text-xs stg:font-medium stg:text-muted-foreground stg:transition-colors",
          "stg:hover:border-border stg:hover:text-foreground stg:hover:bg-accent-hover",
          "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
        )}
      >
        <PlusIcon className="stg:size-3" />
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
