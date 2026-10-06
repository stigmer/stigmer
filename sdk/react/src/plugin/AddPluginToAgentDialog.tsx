"use client";

/**
 * "Add to an agent": the step after installing a plugin that brought tools,
 * hooks, or both, and no agent of its own to use them. What the add brings
 * is listed (the servers, the plugin's hooks in one summary line, the
 * variables those hooks read), an agent is picked from the organization's,
 * and everything is added in one save; or, for a user with no agent to add
 * servers to, a way into the creation wizard with the servers already
 * chosen, through the host's callback (the wizard takes no hooks, so the
 * dialog says a new agent gets the tools only).
 *
 * The pick is fetched before Add is offered (`useAddPluginToAgent`): an
 * agent a plugin installed cannot be edited, and the built-in assistant is
 * one, so the dialog says so in the plugin's own words instead of letting
 * the server refuse. A form dialog, like the connect dialog: no light
 * dismiss on the backdrop, so a pick is never lost to a stray click.
 */

import { useId, useState } from "react";
import { cn } from "@stigmer/theme";
import { hookFormatName, hooksSummary, type McpServerUsageInput, type ResourceRef } from "@stigmer/sdk";
import { AgentPicker } from "../agent/AgentPicker.js";
import { Button } from "../button/Button.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { DialogShell } from "../internal/DialogShell.js";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
import { PluginIcon } from "./PluginIcon.js";
import { type AddPluginOutcome, type PluginOffer, useAddPluginToAgent } from "./useAddPluginToAgent.js";

/** Props for {@link AddPluginToAgentDialog}. */
export interface AddPluginToAgentDialogProps {
  /** The organization whose agents are offered. */
  readonly org: string;
  /** What the add brings: the plugin's servers as it installed them, and its hooks when it has hooks that run. */
  readonly offer: PluginOffer;
  readonly open: boolean;
  readonly onClose: () => void;
  /** Called with the updated agent's reference after a successful add, from "Open agent". The host owns the route. */
  readonly onAgentClick?: (ref: ResourceRef) => void;
  /** Called from "Create a new agent with these tools" with the usages a wizard preselects. The host owns the route; the link is hidden when omitted or when the plugin brings no servers. */
  readonly onCreateAgent?: (usages: readonly McpServerUsageInput[]) => void;
  readonly className?: string;
}

/**
 * Adds a plugin's MCP servers and hooks to an existing agent, or hands the
 * host the servers for a new one.
 *
 * @example
 * ```tsx
 * <AddPluginToAgentDialog
 *   org={org}
 *   offer={{ servers, hooks: plugin.status?.hooks && { plugin: { org, slug }, config: plugin.status.hooks } }}
 *   open={adding}
 *   onClose={() => setAdding(false)}
 *   onAgentClick={({ org, slug }) => navigateToDetail("agents", org, slug)}
 *   onCreateAgent={(usages) => router.push(`/library/agents/new?mcp=${usages.map((u) => u.mcpServerRef.slug).join(",")}`)}
 * />
 * ```
 */
export function AddPluginToAgentDialog({ org, offer, open, onClose, onAgentClick, onCreateAgent, className }: AddPluginToAgentDialogProps) {
  const titleId = useId();
  return (
    <DialogShell
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      width="md"
      dismissOnBackdrop={false}
      className={cn("stg:max-h-[85vh] stg:bg-card stg:text-foreground", className)}
      aria-labelledby={titleId}
    >
      {open && <DialogContent org={org} offer={offer} titleId={titleId} onClose={onClose} onAgentClick={onAgentClick} onCreateAgent={onCreateAgent} />}
    </DialogShell>
  );
}

function DialogContent({
  org,
  offer,
  titleId,
  onClose,
  onAgentClick,
  onCreateAgent,
}: {
  readonly org: string;
  readonly offer: PluginOffer;
  readonly titleId: string;
  readonly onClose: () => void;
  readonly onAgentClick?: (ref: ResourceRef) => void;
  readonly onCreateAgent?: (usages: readonly McpServerUsageInput[]) => void;
}) {
  const flow = useAddPluginToAgent(offer);
  const [picked, setPicked] = useState<ResourceRef | null>(null);
  const { phase } = flow;
  const { servers, hooks } = offer;
  const agentName = "agent" in phase ? phase.agent.metadata?.name || phase.agent.metadata?.slug || "the agent" : "";

  return (
    <div className="stg:flex stg:max-h-[85vh] stg:flex-col stg:gap-4 stg:overflow-y-auto stg:p-6">
      <header>
        <h2 id={titleId} className="stg:text-base stg:font-semibold stg:text-foreground">
          Add to an agent
        </h2>
        <p className="stg:mt-0.5 stg:text-xs stg:text-muted-foreground">{headline(offer)}</p>
      </header>

      <ul className={cn(UNSTYLED_LIST, "stg:flex stg:flex-col stg:gap-1 stg:text-sm stg:text-foreground")} aria-label="What the agent gets">
        {servers.map((server) => (
          <li key={`${server.ref.org}/${server.ref.slug}`} className="stg:flex stg:items-center stg:gap-2">
            <span className="stg:font-medium">{server.name}</span>
            {server.name !== server.ref.slug && <span className="stg:font-mono stg:text-xs stg:text-muted-foreground">{server.ref.slug}</span>}
          </li>
        ))}
        {hooks !== undefined && (
          <li className="stg:flex stg:flex-wrap stg:items-baseline stg:gap-x-2">
            <span className="stg:font-medium">This plugin&apos;s hooks</span>
            <span className="stg:text-xs stg:text-muted-foreground">{hooksSummary(hookFormatName(hooks.config.format), hooks.config.groups)}</span>
          </li>
        )}
      </ul>

      {phase.status === "added" ? (
        <p role="status" className="stg:rounded-md stg:border stg:border-border stg:bg-muted stg:p-3 stg:text-sm stg:text-foreground">
          {addedSentence(phase.outcome, agentName)}
        </p>
      ) : (
        <>
          <AgentPicker
            org={org}
            value={picked}
            onChange={(ref) => {
              setPicked(ref);
              flow.pick(ref);
            }}
            disabled={phase.status === "reading" || phase.status === "adding"}
          />
          {phase.status === "managed" && (
            <div role="note" className="stg:flex stg:items-start stg:gap-2 stg:rounded-md stg:border stg:border-border stg:bg-muted stg:px-3 stg:py-2 stg:text-sm stg:text-foreground">
              <PluginIcon className="stg:mt-0.5 stg:size-4 stg:shrink-0 stg:text-muted-foreground" />
              <p>
                <span className="stg:font-medium">{agentName}</span> was installed by a plugin, so it changes by pushing that plugin again, not here.
                Pick another agent{servers.length > 0 ? ", or create a new one over these tools" : ""}.
              </p>
            </div>
          )}
          {phase.status === "ready" && phase.alreadyListed.length > 0 && (
            <p className="stg:text-xs stg:text-muted-foreground">
              {agentName} already lists {phase.alreadyListed.join(", ")}; only the rest are added.
            </p>
          )}
          {phase.status === "ready" && phase.hooksListed && (
            <p className="stg:text-xs stg:text-muted-foreground">{agentName} already runs this plugin&apos;s hooks.</p>
          )}
          {phase.status === "ready" && phase.variables.length > 0 && (
            <p className="stg:text-xs stg:text-muted-foreground">
              The hooks read {phase.variables.join(", ")}. The agent will ask for {phase.variables.length === 1 ? "it" : "them"} when a session starts.
            </p>
          )}
          {flow.error && <ErrorMessage error={flow.error} title="The agent could not be changed" />}
          {onCreateAgent && servers.length > 0 && hooks !== undefined && (
            <p className="stg:text-xs stg:text-muted-foreground">
              A new agent gets the tools only; switch the plugin&apos;s hooks on from its page once it exists.
            </p>
          )}
        </>
      )}

      <footer className="stg:flex stg:flex-wrap stg:items-center stg:justify-between stg:gap-2 stg:pt-1">
        <span>
          {onCreateAgent && servers.length > 0 && phase.status !== "added" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onCreateAgent(servers.map((server) => ({ mcpServerRef: { org: server.ref.org, slug: server.ref.slug } })))}
            >
              Create a new agent with these tools
            </Button>
          )}
        </span>
        <span className="stg:flex stg:gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            {phase.status === "added" ? "Close" : "Cancel"}
          </Button>
          {phase.status === "added" ? (
            onAgentClick && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => onAgentClick({ org: phase.agent.metadata?.org ?? org, slug: phase.agent.metadata?.slug ?? "" })}
              >
                Open agent
              </Button>
            )
          ) : (
            <Button
              variant="primary"
              size="sm"
              disabled={phase.status !== "ready"}
              onClick={() => {
                void flow.add().catch(() => undefined);
              }}
            >
              {phase.status === "adding" ? "Adding…" : "Add"}
            </Button>
          )}
        </span>
      </footer>
    </div>
  );
}

/** The header's sentence, for what the plugin brings. */
function headline({ servers, hooks }: PluginOffer): string {
  const tools = "The agent gets every tool these servers offer; it asks for a sign-in or a key the first time it needs one.";
  const guard = "The plugin's hooks run on the agent's tool calls, and can refuse one or ask you first.";
  if (servers.length > 0 && hooks !== undefined) return `${tools} ${guard}`;
  return hooks !== undefined ? guard : tools;
}

/** The sentence once the add has saved. */
function addedSentence(outcome: AddPluginOutcome, agentName: string): string {
  const parts = [
    outcome.servers > 0 ? (outcome.servers === 1 ? "1 server" : `${outcome.servers} servers`) : null,
    outcome.hooks ? "this plugin's hooks" : null,
  ].filter((part): part is string => part !== null);
  const asks = outcome.variables.length > 0 ? ` It will ask for ${outcome.variables.join(", ")} when a session starts.` : "";
  if (parts.length > 0) return `Added ${parts.join(" and ")} to ${agentName}.${asks}`;
  // The agent already ran the hooks; only the variables they read were missing.
  if (outcome.variables.length > 0) return `${agentName} already runs this plugin's hooks; it now declares what they read.${asks}`;
  return `${agentName} already had everything this plugin adds.`;
}
