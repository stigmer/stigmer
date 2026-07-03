"use client";

import { useCallback, useState } from "react";
import { cn } from "@stigmer/theme";
import type { McpServerUsageInput, ResourceRef } from "@stigmer/sdk";
import { McpServerPicker } from "../../mcp-server/McpServerPicker.js";
import { SkillPicker } from "../../skill/SkillPicker.js";
import type { AgentWizardData, EnvVarEntry } from "./types.js";

/** Props for {@link CapabilitiesStep}. */
export interface CapabilitiesStepProps {
  readonly org: string;
  readonly data: AgentWizardData;
  readonly updateData: (partial: Partial<AgentWizardData>) => void;
}

/**
 * Wizard step 2: Agent capabilities.
 *
 * All sections are optional and start collapsed. The user expands
 * sections to add MCP servers, skills, and environment variables.
 * No validation gate — the user can proceed with zero capabilities.
 */
export function CapabilitiesStep({
  org,
  data,
  updateData,
}: CapabilitiesStepProps) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    if (data.mcpServerUsages.length > 0) initial.add("mcp");
    if (data.skillRefs.length > 0) initial.add("skills");
    if (data.env.length > 0) initial.add("env");
    return initial;
  });

  const toggleSection = useCallback((section: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  }, []);

  const handleMcpChange = useCallback(
    (usages: McpServerUsageInput[]) => {
      updateData({ mcpServerUsages: usages });
    },
    [updateData],
  );

  const handleSkillsChange = useCallback(
    (refs: ResourceRef[]) => {
      updateData({ skillRefs: refs });
    },
    [updateData],
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">
          Capabilities
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure what tools, skills, and secrets this agent can use.
          All sections are optional.
        </p>
      </div>

      {/* MCP Servers */}
      <CollapsibleSection
        id="mcp"
        title="MCP Servers"
        subtitle="Tools and integrations the agent can call"
        count={data.mcpServerUsages.length}
        expanded={expandedSections.has("mcp")}
        onToggle={toggleSection}
      >
        <McpServerPicker
          org={org}
          scope="all"
          value={data.mcpServerUsages}
          onChange={handleMcpChange}
        />
      </CollapsibleSection>

      {/* Skills */}
      <CollapsibleSection
        id="skills"
        title="Skills"
        subtitle="Knowledge and capabilities to attach"
        count={data.skillRefs.length}
        expanded={expandedSections.has("skills")}
        onToggle={toggleSection}
      >
        <SkillPicker
          org={org}
          scope="all"
          value={data.skillRefs}
          onChange={handleSkillsChange}
        />
      </CollapsibleSection>

      {/* Environment Variables */}
      <CollapsibleSection
        id="env"
        title="Environment Variables"
        subtitle="Secrets and config the agent declares"
        count={data.env.length}
        expanded={expandedSections.has("env")}
        onToggle={toggleSection}
      >
        <EnvVarEditor
          entries={data.env}
          onChange={(env) => updateData({ env })}
        />
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
  readonly count: number;
  readonly expanded: boolean;
  readonly onToggle: (id: string) => void;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <button
        type="button"
        onClick={() => onToggle(id)}
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
          {count > 0 && (
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
// EnvVarEditor — key-value editor for env var declarations
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
                  updateEntry(index, { key: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "") })
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
                onChange={(e) => updateEntry(index, { description: e.target.value })}
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
                onChange={(e) => updateEntry(index, { isSecret: e.target.checked })}
                className="size-3.5 rounded border-input"
              />
              Secret
            </label>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={entry.optional}
                onChange={(e) => updateEntry(index, { optional: e.target.checked })}
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
