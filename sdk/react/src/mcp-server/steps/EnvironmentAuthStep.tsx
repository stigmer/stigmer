"use client";

import { useCallback, useId, useState } from "react";
import { cn } from "@stigmer/theme";
import type { McpServerWizardData, EnvVarEntry } from "./types.js";

/** Props for {@link EnvironmentAuthStep}. */
export interface EnvironmentAuthStepProps {
  readonly data: McpServerWizardData;
  readonly updateData: (partial: Partial<McpServerWizardData>) => void;
}

/**
 * Wizard step 2: Environment variables and auth configuration.
 *
 * Both sections are optional. Env vars start expanded if any exist;
 * auth starts collapsed unless already enabled. No validation gate —
 * the user can proceed with zero configuration.
 *
 * Fully presentational: form state lives in the `data` prop and edits
 * flow out through `updateData`, so standalone consumers (embedded
 * builders, guided tours) can render any configuration state from props.
 */
export function EnvironmentAuthStep({
  data,
  updateData,
}: EnvironmentAuthStepProps) {
  const baseId = useId();
  const [envExpanded, setEnvExpanded] = useState(data.env.length > 0);

  return (
    <div className="stg:flex stg:flex-col stg:gap-6">
      <div>
        <h2 className="stg:text-lg stg:font-semibold stg:text-foreground">
          Environment & Auth
        </h2>
        <p className="stg:mt-1 stg:text-sm stg:text-muted-foreground">
          Declare environment variables and configure authentication.
          Both sections are optional.
        </p>
      </div>

      {/* Environment Variables */}
      <CollapsibleSection
        title="Environment Variables"
        subtitle="Secrets and configuration the server requires at runtime"
        count={data.env.length}
        expanded={envExpanded}
        onToggle={() => setEnvExpanded((v) => !v)}
      >
        <EnvVarEditor
          entries={data.env}
          onChange={(env) => updateData({ env })}
        />
      </CollapsibleSection>

      {/* Auth Configuration */}
      <CollapsibleSection
        title="OAuth Authentication"
        subtitle="Configure OAuth for servers that require user authorization"
        expanded={data.authEnabled}
        onToggle={() => updateData({ authEnabled: !data.authEnabled })}
      >
        <div className="stg:flex stg:flex-col stg:gap-4">
          <div className="stg:grid stg:gap-4 stg:sm:grid-cols-2">
            <div className="stg:space-y-1.5">
              <label
                htmlFor={`${baseId}-app-org`}
                className="stg:text-sm stg:font-medium stg:text-foreground"
              >
                OAuth App Organization
              </label>
              <input
                id={`${baseId}-app-org`}
                type="text"
                value={data.authOAuthAppOrg}
                onChange={(e) =>
                  updateData({ authOAuthAppOrg: e.target.value })
                }
                placeholder="e.g. stigmer"
                className={cn(
                  "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-input-bg stg:px-3 stg:py-2 stg:font-mono stg:text-sm stg:text-foreground",
                  "stg:placeholder:text-muted-foreground",
                  "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
                )}
              />
            </div>

            <div className="stg:space-y-1.5">
              <label
                htmlFor={`${baseId}-app-slug`}
                className="stg:text-sm stg:font-medium stg:text-foreground"
              >
                OAuth App Slug
              </label>
              <input
                id={`${baseId}-app-slug`}
                type="text"
                value={data.authOAuthAppSlug}
                onChange={(e) =>
                  updateData({ authOAuthAppSlug: e.target.value })
                }
                placeholder="e.g. github-oauth"
                className={cn(
                  "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-input-bg stg:px-3 stg:py-2 stg:font-mono stg:text-sm stg:text-foreground",
                  "stg:placeholder:text-muted-foreground",
                  "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
                )}
              />
            </div>
          </div>

          <div className="stg:space-y-1.5">
            <label
              htmlFor={`${baseId}-target-var`}
              className="stg:text-sm stg:font-medium stg:text-foreground"
            >
              Target Environment Variable
            </label>
            <input
              id={`${baseId}-target-var`}
              type="text"
              value={data.authTargetEnvVar}
              onChange={(e) =>
                updateData({ authTargetEnvVar: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "") })
              }
              placeholder="e.g. GITHUB_TOKEN"
              className={cn(
                "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-input-bg stg:px-3 stg:py-2 stg:font-mono stg:text-sm stg:text-foreground",
                "stg:placeholder:text-muted-foreground",
                "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
              )}
            />
            <p className="stg:text-xs stg:text-muted-foreground">
              The env var that receives the OAuth access token.
            </p>
          </div>

          <div className="stg:grid stg:gap-4 stg:sm:grid-cols-2">
            <div className="stg:space-y-1.5">
              <label
                htmlFor={`${baseId}-lifetime`}
                className="stg:text-sm stg:font-medium stg:text-foreground"
              >
                Token Lifetime Hint
              </label>
              <input
                id={`${baseId}-lifetime`}
                type="text"
                value={data.authTokenLifetimeHint}
                onChange={(e) =>
                  updateData({ authTokenLifetimeHint: e.target.value })
                }
                placeholder="e.g. 1h, 8h, never"
                className={cn(
                  "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-input-bg stg:px-3 stg:py-2 stg:text-sm stg:text-foreground",
                  "stg:placeholder:text-muted-foreground",
                  "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
                )}
              />
            </div>

            <div className="stg:space-y-1.5">
              <label
                htmlFor={`${baseId}-scopes`}
                className="stg:text-sm stg:font-medium stg:text-foreground"
              >
                Scope Hints
              </label>
              <input
                id={`${baseId}-scopes`}
                type="text"
                value={data.authScopeHints}
                onChange={(e) =>
                  updateData({ authScopeHints: e.target.value })
                }
                placeholder="e.g. repo, read:org"
                className={cn(
                  "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-input-bg stg:px-3 stg:py-2 stg:text-sm stg:text-foreground",
                  "stg:placeholder:text-muted-foreground",
                  "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
                )}
              />
              <p className="stg:text-xs stg:text-muted-foreground">
                Comma-separated OAuth scopes.
              </p>
            </div>
          </div>

          <div className="stg:space-y-1.5">
            <label
              htmlFor={`${baseId}-discovery`}
              className="stg:text-sm stg:font-medium stg:text-foreground"
            >
              Discovery URL
            </label>
            <input
              id={`${baseId}-discovery`}
              type="url"
              value={data.authDiscoveryUrl}
              onChange={(e) =>
                updateData({ authDiscoveryUrl: e.target.value })
              }
              placeholder="https://provider.com/.well-known/openid-configuration"
              className={cn(
                "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-input-bg stg:px-3 stg:py-2 stg:font-mono stg:text-sm stg:text-foreground",
                "stg:placeholder:text-muted-foreground",
                "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
              )}
            />
          </div>
        </div>
      </CollapsibleSection>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CollapsibleSection
// ---------------------------------------------------------------------------

function CollapsibleSection({
  title,
  subtitle,
  count,
  expanded,
  onToggle,
  children,
}: {
  readonly title: string;
  readonly subtitle: string;
  readonly count?: number;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly children: React.ReactNode;
}) {
  // The disclosure-panel DOM id is minted per mount — deriving it from a
  // static section key would collide when two wizards mount on one page.
  const panelId = useId();
  return (
    <div className="stg:overflow-hidden stg:rounded-lg stg:border stg:border-border">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={panelId}
        className={cn(
          "stg:flex stg:w-full stg:items-center stg:justify-between stg:px-4 stg:py-3 stg:text-left stg:transition-colors",
          "stg:hover:bg-accent-hover",
          "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-inset stg:focus-visible:ring-ring",
        )}
      >
        <div>
          <span className="stg:text-sm stg:font-medium stg:text-foreground">{title}</span>
          {count != null && count > 0 && (
            <span className="stg:ml-2 stg:inline-flex stg:items-center stg:justify-center stg:rounded-full stg:bg-primary stg:px-1.5 stg:py-0.5 stg:text-[10px] stg:font-medium stg:text-primary-foreground">
              {count}
            </span>
          )}
          <p className="stg:mt-0.5 stg:text-xs stg:text-muted-foreground">{subtitle}</p>
        </div>
        <ChevronIcon
          className={cn(
            "stg:size-4 stg:shrink-0 stg:text-muted-foreground stg:transition-transform",
            expanded && "stg:rotate-180",
          )}
        />
      </button>

      {expanded && (
        <div
          id={panelId}
          className="stg:border-t stg:border-border stg:px-4 stg:py-4"
        >
          {children}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// EnvVarEditor
// ---------------------------------------------------------------------------

function EnvVarEditor({
  entries,
  onChange,
}: {
  readonly entries: readonly EnvVarEntry[];
  readonly onChange: (entries: EnvVarEntry[]) => void;
}) {
  const addEntry = useCallback(() => {
    onChange([
      ...entries,
      { key: "", description: "", isSecret: true, optional: false },
    ]);
  }, [entries, onChange]);

  const updateEntry = useCallback(
    (index: number, partial: Partial<EnvVarEntry>) => {
      const updated = entries.map((entry, i) =>
        i === index ? { ...entry, ...partial } : entry,
      );
      onChange(updated);
    },
    [entries, onChange],
  );

  const removeEntry = useCallback(
    (index: number) => {
      onChange(entries.filter((_, i) => i !== index));
    },
    [entries, onChange],
  );

  return (
    <div className="stg:flex stg:flex-col stg:gap-3">
      {entries.map((entry, index) => (
        <div
          key={index}
          className="stg:flex stg:flex-col stg:gap-2 stg:rounded-md stg:border stg:border-border stg:p-3"
        >
          <div className="stg:flex stg:items-start stg:gap-2">
            <div className="stg:flex-1 stg:space-y-1.5">
              <input
                type="text"
                value={entry.key}
                onChange={(e) =>
                  updateEntry(index, {
                    key: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""),
                  })
                }
                placeholder="VARIABLE_NAME"
                aria-label={`Environment variable name ${index + 1}`}
                className={cn(
                  "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-input-bg stg:px-2.5 stg:py-1.5 stg:font-mono stg:text-xs stg:text-foreground",
                  "stg:placeholder:text-muted-foreground",
                  "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
                )}
              />
              <input
                type="text"
                value={entry.description}
                onChange={(e) =>
                  updateEntry(index, { description: e.target.value })
                }
                placeholder="Description (optional)"
                aria-label={`Description for ${entry.key || `variable ${index + 1}`}`}
                className={cn(
                  "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-input-bg stg:px-2.5 stg:py-1.5 stg:text-xs stg:text-foreground",
                  "stg:placeholder:text-muted-foreground",
                  "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
                )}
              />
            </div>
            <button
              type="button"
              onClick={() => removeEntry(index)}
              aria-label={`Remove ${entry.key || "variable"}`}
              className={cn(
                "stg:mt-1 stg:rounded stg:p-1 stg:text-muted-foreground stg:transition-colors",
                "stg:hover:bg-accent-hover stg:hover:text-destructive",
                "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
              )}
            >
              <RemoveIcon className="stg:size-3.5" />
            </button>
          </div>

          <div className="stg:flex stg:items-center stg:gap-4">
            <label className="stg:flex stg:items-center stg:gap-1.5 stg:text-xs stg:text-muted-foreground">
              <input
                type="checkbox"
                checked={entry.isSecret}
                onChange={(e) =>
                  updateEntry(index, { isSecret: e.target.checked })
                }
                className="stg:size-3.5 stg:rounded stg:border-input"
              />
              Secret
            </label>
            <label className="stg:flex stg:items-center stg:gap-1.5 stg:text-xs stg:text-muted-foreground">
              <input
                type="checkbox"
                checked={entry.optional}
                onChange={(e) =>
                  updateEntry(index, { optional: e.target.checked })
                }
                className="stg:size-3.5 stg:rounded stg:border-input"
              />
              Optional
            </label>
          </div>
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
        Add variable
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function ChevronIcon({ className }: { readonly className?: string }) {
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
      <path d="m4 6 4 4 4-4" />
    </svg>
  );
}

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
