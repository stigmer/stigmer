// `share agent` dispatch: enable or disable public sharing for an agent and
// report the hosted chat link + embed snippet.
//
// The one correctness invariant here: the `updateSharing` RPC replaces
// `spec.sharing` WHOLESALE. A naive "set enabled" would silently wipe any
// `allowed_origins` or visitor messages the owner configured in the console.
// So this module always reads the current state first and sends the complete
// block back with only `enabled` flipped — the same merge-preserve discipline
// as the web dialog's draftFromAgent (sdk/react ShareAgentDialog.tsx).
//
// URL and snippet shapes come from @stigmer/sdk's sharing helpers — the single
// source of truth shared with the web console — so every surface emits
// byte-identical output. The caller supplies the app origin (resolved from the
// backend type by the command layer) to keep this module pure and env-free.

import { create } from "@bufbuild/protobuf";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { UpdateAgentSharingInputSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/io_pb";
import {
  AgentSharingMessagesSchema,
  AgentSharingSchema,
  type AgentSharing,
} from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { buildChatUrl, buildEmbedSnippet, type Stigmer } from "@stigmer/sdk";
import { UsageError } from "../errors/index.js";
import { CommandResult } from "../output/index.js";
import { isAgentId } from "./reference.js";
import { resolveAgentRef } from "./run/resolve.js";

/** Inputs for {@link shareAgent} beyond the reference itself. */
export interface ShareAgentOptions {
  /** Desired sharing state: `true` to enable, `false` to disable. */
  readonly enabled: boolean;
  /** The app origin serving the hosted chat page and `embed.js`. */
  readonly appOrigin: string;
  /**
   * Whether the CLI points at a local backend. Guest chat (the token mint
   * behind the hosted page) is a Stigmer Cloud capability, so a local link
   * gets a "won't serve visitors" warning alongside the result.
   */
  readonly isLocal: boolean;
}

/**
 * Enable or disable sharing for the referenced agent and describe the
 * outcome. Idempotent: when the agent is already in the desired state, no
 * write is issued (the link is still reported when sharing is on).
 */
export async function shareAgent(
  client: Stigmer,
  ref: string,
  org: string,
  options: ShareAgentOptions,
): Promise<CommandResult> {
  // Fail fast with actionable guidance instead of the backend's cryptic
  // "org value length must be at least 1" — mirrors the connect org guard.
  if (org === "" && !isAgentId(ref) && !ref.includes("/")) {
    throw new UsageError(
      "organization not set\n\n" +
        "Set it with:\n" +
        "  stigmer config context set --org <org>\n" +
        `  stigmer share agent ${ref} --org <org>`,
    );
  }

  const agent = await resolveAgentRef(client, ref, org);
  const current = agent.spec?.sharing;

  if ((current?.enabled ?? false) === options.enabled) {
    return describeOutcome(agent, options, /* alreadyInState */ true);
  }

  // Send the COMPLETE sharing block with only `enabled` flipped, so a CLI
  // toggle can never wipe console-configured origins or visitor messages.
  await client.agent.updateSharing(
    create(UpdateAgentSharingInputSchema, {
      resourceId: agent.metadata?.id ?? "",
      sharing: preservingSharing(current, options.enabled),
    }),
  );

  return describeOutcome(agent, options, /* alreadyInState */ false);
}

// The full sharing config with the desired `enabled`, preserving origins and
// messages (empty defaults when the agent was never shared before).
function preservingSharing(current: AgentSharing | undefined, enabled: boolean): AgentSharing {
  return create(AgentSharingSchema, {
    enabled,
    allowedOrigins: [...(current?.allowedOrigins ?? [])],
    messages: create(AgentSharingMessagesSchema, {
      rateLimited: current?.messages?.rateLimited ?? "",
      unavailable: current?.messages?.unavailable ?? "",
      conversationEnded: current?.messages?.conversationEnded ?? "",
    }),
  });
}

// Build the user-facing result. Org/slug come from the RESOLVED agent's
// metadata (authoritative even when the user passed an ID), matching how the
// web share dialog derives them.
function describeOutcome(agent: Agent, options: ShareAgentOptions, alreadyInState: boolean): CommandResult {
  const org = agent.metadata?.org ?? "";
  const slug = agent.metadata?.slug ?? "";
  const name = agent.metadata?.name || slug;

  if (!options.enabled) {
    const result = CommandResult.success(
      alreadyInState ? `Sharing is already off for '${name}'` : `Sharing disabled for '${name}'`,
    );
    result.hint("The share link no longer works. Re-enable with:");
    result.hint(`  stigmer share agent ${org}/${slug}`);
    return result;
  }

  const result = CommandResult.success(
    alreadyInState ? `Sharing is already on for '${name}'` : `Sharing enabled for '${name}'`,
  );

  result.addSection("Public chat link").item(buildChatUrl(options.appOrigin, org, slug));

  const snippetSection = result.addSection("Embed on your site");
  for (const line of buildEmbedSnippet(options.appOrigin, org, slug).split("\n")) {
    snippetSection.item(line);
  }

  result.hint(`Visitors chat on ${org}'s credits.`);
  result.hint("Public links can be forwarded and indexed by search engines.");
  if (options.isLocal) {
    result.hint("Guest chat is a Stigmer Cloud capability — this local link won't serve visitors.");
  }
  return result;
}
