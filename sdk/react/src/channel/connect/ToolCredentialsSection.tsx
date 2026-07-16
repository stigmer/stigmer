"use client";

import { useState } from "react";
import { cn } from "@stigmer/theme";
import type { ResourceRef } from "@stigmer/sdk";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ChannelToolCredentials } from "../ChannelToolCredentials.js";
import { ChevronIcon } from "./icons.js";

/**
 * Collapsible credential-binding section for the connect dialogs' create
 * mode (the ShareAgentDialog ToolCredentialsSection pattern). Expanded by
 * default when the agent uses MCP tools — for those agents this is
 * essential configuration, not an advanced option: without a binding,
 * every channel message that needs a tool is refused.
 *
 * Provider-agnostic by construction: bindings are agent + environment
 * facts, so both connect dialogs render this section unchanged.
 */
export function ToolCredentialsSection({
  agent,
  org,
  value,
  onChange,
  disabled,
}: {
  readonly agent: Agent;
  readonly org: string;
  readonly value: readonly ResourceRef[];
  readonly onChange: (refs: ResourceRef[]) => void;
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
          "inline-flex items-center gap-1 text-xs font-medium text-muted-foreground",
          "hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded",
        )}
      >
        <ChevronIcon
          className={cn("size-3 transition-transform", expanded && "rotate-90")}
        />
        Tool credentials
      </button>

      {expanded && (
        <div className="mt-2">
          <ChannelToolCredentials
            agent={agent}
            org={org}
            value={value}
            onChange={onChange}
            disabled={disabled}
          />
        </div>
      )}
    </section>
  );
}
