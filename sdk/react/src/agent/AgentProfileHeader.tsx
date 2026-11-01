"use client";

// An agent's page opens on who the agent is and what it is made of: its
// face, its name and what it does, who made it, and one line of facts (the
// model it runs, its skills, plugins, MCP servers, sub-agents, channels and
// versions). Every fact comes from a read the page makes: the spec it shows,
// its version history's first page, and its list of channels, the one read
// the Channels tab shares, so an add or a delete there changes the count
// here too. None is "when it last ran", which no ordered read answers.

import type { ReactNode } from "react";
import type { Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { Bot, Cpu, History, MessageSquare, Puzzle, Server, Zap } from "lucide-react";
import { cn } from "@stigmer/design-tokens";
import { useModelRegistry } from "../models/useModelRegistry.js";
import { useOrgSlugForId } from "../organization/useOrgRefs.js";
import { agentHarnessOf } from "./run-defaults.js";

/** Props for {@link AgentProfileHeader}. */
export interface AgentProfileHeaderProps {
  readonly agent: Agent;
  /** The agent's face: its image, or the editable image control where the person may edit. */
  readonly icon: ReactNode;
  /** The visibility chip, which opens Manage access where the person may. */
  readonly visibilityControl?: ReactNode;
  /** How many versions the agent has, once read. */
  readonly versionCount?: number;
  /** How many channels reach the agent, once read: the page's channel list, the one its Channels tab shows. */
  readonly channelCount?: number;
  readonly className?: string;
}

/** The agent's identity: face, name, purpose, maker and what it is made of. */
export function AgentProfileHeader({ agent, icon, visibilityControl, versionCount, channelCount, className }: AgentProfileHeaderProps) {
  const meta = agent.metadata;
  const spec = agent.spec;
  const audit = agent.status?.audit?.specAudit;
  const slugForOrg = useOrgSlugForId();
  const maker = audit?.createdBy?.displayName || audit?.createdBy?.email || "";
  const updated = audit?.updatedAt ? timestampDate(audit.updatedAt) : null;
  const facts = useAgentFacts(agent, { versionCount, channelCount });

  return (
    <div className={cn("stg:flex stg:min-w-0 stg:items-start stg:gap-4", className)}>
      <span className="stg:flex stg:size-14 stg:shrink-0 stg:items-center stg:justify-center stg:overflow-hidden stg:rounded-xl stg:border stg:border-border stg:bg-muted-subtle">
        {icon}
      </span>
      <div className="stg:min-w-0 stg:flex-1">
        <div className="stg:flex stg:flex-wrap stg:items-center stg:gap-2">
          <h2 className="stg:m-0 stg:truncate stg:text-xl stg:font-semibold stg:tracking-tight stg:text-foreground">{meta?.name || meta?.slug}</h2>
          {visibilityControl}
        </div>
        {spec?.description && <p className="stg:m-0 stg:mt-1 stg:max-w-2xl stg:text-sm stg:text-muted-foreground">{spec.description}</p>}
        <p className="stg:m-0 stg:mt-1.5 stg:flex stg:flex-wrap stg:gap-x-1.5 stg:text-xs stg:text-muted-foreground">
          <span className="stg:font-mono">
            {slugForOrg(meta?.org ?? "")}/{meta?.slug}
          </span>
          {maker !== "" && (
            <>
              <span aria-hidden="true">·</span>
              <span>Made by {maker}</span>
            </>
          )}
          {updated && (
            <>
              <span aria-hidden="true">·</span>
              <span>Updated {updated.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
            </>
          )}
        </p>
        <ul aria-label="What the agent is made of" className="stg:m-0 stg:mt-3 stg:flex stg:list-none stg:flex-wrap stg:gap-1.5 stg:p-0">
          {facts.map((fact) => (
            <li
              key={fact.label}
              className="stg:inline-flex stg:items-center stg:gap-1.5 stg:rounded-md stg:border stg:border-border stg:px-2 stg:py-1 stg:text-xs stg:text-foreground stg:[&_svg]:size-3.5 stg:[&_svg]:text-muted-foreground"
            >
              {fact.icon}
              {fact.label}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** One fact about what an agent is made of: its icon and its words. */
export interface AgentFact {
  readonly icon: ReactNode;
  readonly label: string;
}

/** What an agent is made of, as facts: its model, then counts of its skills, plugins, MCP servers, sub-agents, channels and versions. */
export function useAgentFacts(
  agent: Agent,
  counts: { readonly versionCount?: number; readonly channelCount?: number },
): readonly AgentFact[] {
  const spec = agent.spec;
  const { getModel } = useModelRegistry({ harness: agentHarnessOf(spec) });
  const modelName = spec?.runConfig?.modelName ?? "";
  const model = modelName === "" ? undefined : (getModel(modelName)?.displayName ?? modelName);
  const { versionCount, channelCount } = counts;
  // What it has, not what it lacks: a part it has none of is left out.
  const parts: readonly (readonly [ReactNode, number | undefined, string])[] = [
    [<Zap key="skill" />, spec?.skillRefs.length, "skill"],
    [<Puzzle key="plugin" />, spec?.plugins.length, "plugin"],
    [<Server key="server" />, spec?.mcpServers.length, "MCP server"],
    [<Bot key="agent" />, spec?.subagents.length, "sub-agent"],
    [<MessageSquare key="channel" />, channelCount, "channel"],
    [<History key="version" />, versionCount, "version"],
  ];
  return [
    { icon: <Cpu />, label: model ?? "The conversation's model" },
    ...parts.filter(([, n]) => n !== undefined && n > 0).map(([icon, n, noun]) => ({ icon, label: count(n ?? 0, noun) })),
  ];
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
