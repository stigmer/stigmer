"use client";

/**
 * The collapsible credentials section of the connect dialogs' create mode.
 * Expanded by default when the agent uses MCP tools: for those agents it
 * is essential configuration, not an advanced option, because a channel
 * conversation takes only what the channel assigns, and a value the
 * agent needs that nothing assigns refuses every message that needs it.
 *
 * Provider-agnostic by construction: assignments are agent and credential
 * facts, so both connect dialogs render this section unchanged.
 */
import { useState } from "react";
import { cn } from "@stigmer/theme";
import type { CredentialAssignmentInput } from "@stigmer/sdk";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { CredentialAssignmentsEditor } from "../../credential/CredentialAssignmentsEditor.js";
import { ChevronIcon } from "./icons.js";

export function ToolCredentialsSection({
  agent,
  org,
  value,
  onChange,
  disabled,
}: {
  readonly agent: Agent;
  readonly org: string;
  readonly value: readonly CredentialAssignmentInput[];
  readonly onChange: (next: CredentialAssignmentInput[]) => void;
  readonly disabled: boolean;
}) {
  const hasMcpTools = (agent.spec?.mcpServerUsages?.length ?? 0) > 0;
  const [expanded, setExpanded] = useState(hasMcpTools || value.length > 0);

  return (
    <section>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className={cn(
          "stg:inline-flex stg:items-center stg:gap-1 stg:text-xs stg:font-medium stg:text-muted-foreground",
          "stg:hover:text-foreground",
          "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring stg:rounded",
        )}
      >
        <ChevronIcon
          className={cn("stg:size-3 stg:transition-transform", expanded && "stg:rotate-90")}
        />
        Credentials
      </button>

      {expanded && (
        <div className="stg:mt-2 stg:flex stg:flex-col stg:gap-2">
          <p className="stg:text-[0.65rem] stg:text-muted-foreground">
            Channel conversations have no person behind them, so they use
            only the values assigned here. Pick an organization key you may
            use for each value (a read-only token is safest). Nobody in the
            workspace sees the values.
          </p>
          <CredentialAssignmentsEditor
            org={org}
            agent={agent}
            value={value}
            onChange={onChange}
            disabled={disabled}
          />
        </div>
      )}
    </section>
  );
}
