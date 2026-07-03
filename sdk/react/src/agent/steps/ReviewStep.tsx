"use client";

import { useMemo } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import type { AgentInput } from "@stigmer/sdk";
import { serializeAgentInputYaml } from "../../library/serialize-resource-yaml.js";
import type { AgentWizardData } from "./types.js";

/** Props for {@link ReviewStep}. */
export interface ReviewStepProps {
  readonly org: string;
  readonly data: AgentWizardData;
  readonly isCreating: boolean;
  readonly error: Error | null;
}

/**
 * Wizard step 3: Review and create.
 *
 * Shows a summary card with key configuration details and a full
 * YAML preview of the agent that will be created. The "Create" action
 * is in the WizardNav footer, not in this component.
 */
export function ReviewStep({
  org,
  data,
  isCreating,
  error,
}: ReviewStepProps) {
  const agentInput = useMemo(() => buildAgentInput(org, data), [org, data]);
  const yamlPreview = useMemo(
    () => serializeAgentInputYaml(agentInput),
    [agentInput],
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">
          Review & Create
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Review the agent configuration below, then create it.
        </p>
      </div>

      {/* Summary card */}
      <div className="rounded-lg border border-border p-4">
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <SummaryItem label="Name" value={data.name} />
          <SummaryItem label="Slug" value={data.slug} mono />
          <SummaryItem label="Organization" value={org} mono />
          <SummaryItem
            label="Visibility"
            value={data.visibility === "public" ? "Public" : "Private"}
          />
          {data.description && (
            <SummaryItem
              label="Description"
              value={data.description}
              className="sm:col-span-2"
            />
          )}
          {data.instructions && (
            <SummaryItem
              label="Instructions"
              value={truncate(data.instructions, 120)}
              className="sm:col-span-2"
            />
          )}
          <SummaryItem
            label="MCP Servers"
            value={
              data.mcpServerUsages.length > 0
                ? `${data.mcpServerUsages.length} configured`
                : "None"
            }
          />
          <SummaryItem
            label="Skills"
            value={
              data.skillRefs.length > 0
                ? `${data.skillRefs.length} attached`
                : "None"
            }
          />
          {data.env.length > 0 && (
            <SummaryItem
              label="Env Variables"
              value={`${data.env.length} declared`}
            />
          )}
        </dl>
      </div>

      {/* YAML preview */}
      <div className="space-y-2">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          YAML Preview
        </h3>
        <div className="max-h-80 overflow-auto rounded-lg border border-border bg-muted-faint">
          <pre className="p-4 font-mono text-xs leading-relaxed text-foreground">
            {yamlPreview}
          </pre>
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="rounded-md border border-destructive bg-muted-faint px-4 py-3" role="alert">
          <p className="text-sm font-medium text-destructive">
            Failed to create agent
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {getUserMessage(error)}
          </p>
        </div>
      )}

      {/* Creating state */}
      {isCreating && (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          Creating agent…
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary item
// ---------------------------------------------------------------------------

function SummaryItem({
  label,
  value,
  mono,
  className,
}: {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
  readonly className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "mt-0.5 text-sm text-foreground",
          mono && "font-mono",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "…";
}

/**
 * Transforms wizard data into the SDK `AgentInput` shape for submission.
 * Exported for reuse by `AgentCreationWizard`.
 */
export function buildAgentInput(
  org: string,
  data: AgentWizardData,
): AgentInput {
  const input: AgentInput = {
    name: data.name.trim(),
    org,
    ...(data.slug && { slug: data.slug }),
    ...(data.description && { description: data.description.trim() }),
    ...(data.iconUrl && { iconUrl: data.iconUrl.trim() }),
    ...(data.instructions && { instructions: data.instructions }),
  };

  if (data.mcpServerUsages.length > 0) {
    input.mcpServerUsages = data.mcpServerUsages;
  }

  if (data.skillRefs.length > 0) {
    input.skillRefs = data.skillRefs;
  }

  if (data.env.length > 0) {
    const env: Record<string, { isSecret?: boolean; description?: string; optional?: boolean }> = {};
    for (const entry of data.env) {
      if (!entry.key) continue;
      env[entry.key] = {
        ...(entry.isSecret && { isSecret: true }),
        ...(entry.description && { description: entry.description }),
        ...(entry.optional && { optional: true }),
      };
    }
    if (Object.keys(env).length > 0) {
      input.env = env;
    }
  }

  return input;
}
