"use client";

import { useCallback, useState } from "react";
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
  const [envExpanded, setEnvExpanded] = useState(data.env.length > 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">
          Environment & Auth
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Declare environment variables and configure authentication.
          Both sections are optional.
        </p>
      </div>

      {/* Environment Variables */}
      <CollapsibleSection
        id="env"
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
        id="auth"
        title="OAuth Authentication"
        subtitle="Configure OAuth for servers that require user authorization"
        expanded={data.authEnabled}
        onToggle={() => updateData({ authEnabled: !data.authEnabled })}
      >
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label
                htmlFor="stgm-wizard-mcp-auth-app-org"
                className="text-sm font-medium text-foreground"
              >
                OAuth App Organization
              </label>
              <input
                id="stgm-wizard-mcp-auth-app-org"
                type="text"
                value={data.authOAuthAppOrg}
                onChange={(e) =>
                  updateData({ authOAuthAppOrg: e.target.value })
                }
                placeholder="e.g. stigmer"
                className={cn(
                  "w-full rounded-md border border-input bg-input-bg px-3 py-2 font-mono text-sm text-foreground",
                  "placeholder:text-muted-foreground",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="stgm-wizard-mcp-auth-app-slug"
                className="text-sm font-medium text-foreground"
              >
                OAuth App Slug
              </label>
              <input
                id="stgm-wizard-mcp-auth-app-slug"
                type="text"
                value={data.authOAuthAppSlug}
                onChange={(e) =>
                  updateData({ authOAuthAppSlug: e.target.value })
                }
                placeholder="e.g. github-oauth"
                className={cn(
                  "w-full rounded-md border border-input bg-input-bg px-3 py-2 font-mono text-sm text-foreground",
                  "placeholder:text-muted-foreground",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="stgm-wizard-mcp-auth-target-var"
              className="text-sm font-medium text-foreground"
            >
              Target Environment Variable
            </label>
            <input
              id="stgm-wizard-mcp-auth-target-var"
              type="text"
              value={data.authTargetEnvVar}
              onChange={(e) =>
                updateData({ authTargetEnvVar: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "") })
              }
              placeholder="e.g. GITHUB_TOKEN"
              className={cn(
                "w-full rounded-md border border-input bg-input-bg px-3 py-2 font-mono text-sm text-foreground",
                "placeholder:text-muted-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            />
            <p className="text-xs text-muted-foreground">
              The env var that receives the OAuth access token.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label
                htmlFor="stgm-wizard-mcp-auth-lifetime"
                className="text-sm font-medium text-foreground"
              >
                Token Lifetime Hint
              </label>
              <input
                id="stgm-wizard-mcp-auth-lifetime"
                type="text"
                value={data.authTokenLifetimeHint}
                onChange={(e) =>
                  updateData({ authTokenLifetimeHint: e.target.value })
                }
                placeholder="e.g. 1h, 8h, never"
                className={cn(
                  "w-full rounded-md border border-input bg-input-bg px-3 py-2 text-sm text-foreground",
                  "placeholder:text-muted-foreground",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="stgm-wizard-mcp-auth-scopes"
                className="text-sm font-medium text-foreground"
              >
                Scope Hints
              </label>
              <input
                id="stgm-wizard-mcp-auth-scopes"
                type="text"
                value={data.authScopeHints}
                onChange={(e) =>
                  updateData({ authScopeHints: e.target.value })
                }
                placeholder="e.g. repo, read:org"
                className={cn(
                  "w-full rounded-md border border-input bg-input-bg px-3 py-2 text-sm text-foreground",
                  "placeholder:text-muted-foreground",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              />
              <p className="text-xs text-muted-foreground">
                Comma-separated OAuth scopes.
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="stgm-wizard-mcp-auth-discovery"
              className="text-sm font-medium text-foreground"
            >
              Discovery URL
            </label>
            <input
              id="stgm-wizard-mcp-auth-discovery"
              type="url"
              value={data.authDiscoveryUrl}
              onChange={(e) =>
                updateData({ authDiscoveryUrl: e.target.value })
              }
              placeholder="https://provider.com/.well-known/openid-configuration"
              className={cn(
                "w-full rounded-md border border-input bg-input-bg px-3 py-2 font-mono text-sm text-foreground",
                "placeholder:text-muted-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
  id,
  title,
  subtitle,
  count,
  expanded,
  onToggle,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly count?: number;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={`stgm-wizard-section-${id}`}
        className={cn(
          "flex w-full items-center justify-between px-4 py-3 text-left transition-colors",
          "hover:bg-accent-hover",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        )}
      >
        <div>
          <span className="text-sm font-medium text-foreground">{title}</span>
          {count != null && count > 0 && (
            <span className="ml-2 inline-flex items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">
              {count}
            </span>
          )}
          <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <ChevronIcon
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-180",
          )}
        />
      </button>

      {expanded && (
        <div
          id={`stgm-wizard-section-${id}`}
          className="border-t border-border px-4 py-4"
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
    <div className="flex flex-col gap-3">
      {entries.map((entry, index) => (
        <div
          key={index}
          className="flex flex-col gap-2 rounded-md border border-border p-3"
        >
          <div className="flex items-start gap-2">
            <div className="flex-1 space-y-1.5">
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
                  "w-full rounded-md border border-input bg-input-bg px-2.5 py-1.5 font-mono text-xs text-foreground",
                  "placeholder:text-muted-foreground",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
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
                  "w-full rounded-md border border-input bg-input-bg px-2.5 py-1.5 text-xs text-foreground",
                  "placeholder:text-muted-foreground",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                )}
              />
            </div>
            <button
              type="button"
              onClick={() => removeEntry(index)}
              aria-label={`Remove ${entry.key || "variable"}`}
              className={cn(
                "mt-1 rounded p-1 text-muted-foreground transition-colors",
                "hover:bg-accent-hover hover:text-destructive",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              <RemoveIcon className="size-3.5" />
            </button>
          </div>

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={entry.isSecret}
                onChange={(e) =>
                  updateEntry(index, { isSecret: e.target.checked })
                }
                className="size-3.5 rounded border-input"
              />
              Secret
            </label>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={entry.optional}
                onChange={(e) =>
                  updateEntry(index, { optional: e.target.checked })
                }
                className="size-3.5 rounded border-input"
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
          "inline-flex w-fit items-center gap-1.5 rounded-md border border-dashed border-input px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors",
          "hover:border-border hover:text-foreground hover:bg-accent-hover",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <PlusIcon className="size-3" />
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
