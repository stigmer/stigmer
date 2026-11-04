"use client";

import { cn } from "@stigmer/design-tokens";
import type { ResourceRef } from "@stigmer/client";
import type { Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { ChannelToolCredentials } from "../ChannelToolCredentials.js";
import { ChevronIcon } from "./icons.js";
import { useToolCredentialsDisclosure } from "../../vault/useToolCredentialsDisclosure.js";

/**
 * Collapsible vault section for the connect dialogs' create mode (the
 * ChatLinkDialog ToolCredentialsSection pattern). Expanded by default
 * when the run dials MCP servers, the agent's or a subagent's it lists —
 * for those agents this is essential configuration, not an advanced
 * option: without a vault, every channel message that needs a tool is
 * refused. When it opens is `useToolCredentialsDisclosure`'s rule.
 *
 * Provider-agnostic by construction: the vaults a channel names are agent
 * and vault facts, so both connect dialogs render this section unchanged.
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
  const { expanded, toggle } = useToolCredentialsDisclosure(agent, value.length > 0);

  return (
    <section>
      <button
        type="button"
        onClick={toggle}
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
