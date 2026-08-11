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
          "stg:inline-flex stg:items-center stg:gap-1 stg:text-xs stg:font-medium stg:text-muted-foreground",
          "stg:hover:text-foreground",
          "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring stg:rounded",
        )}
      >
        <ChevronIcon
          className={cn("stg:size-3 stg:transition-transform", expanded && "stg:rotate-90")}
        />
        Tool credentials
      </button>

      {expanded && (
        <div className="stg:mt-2">
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
