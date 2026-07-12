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
import {
  RotateShareLinkInputSchema,
  UpdateAgentSharingInputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agent/v1/io_pb";
import {
  AgentSharingAudience,
  AgentSharingMessagesSchema,
  AgentSharingSchema,
  type AgentSharing,
} from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { buildChatUrl, buildEmbedSnippet, type Stigmer } from "@stigmer/sdk";
import { UsageError } from "../errors/index.js";
import { CommandResult } from "../output/index.js";
import { isAgentId } from "./reference.js";
import { resolveAgentRef } from "./run/resolve.js";

/** Who can chat over the shared link. Mirrors the SDK's SharingAudience. */
export type ShareAudience = "public" | "org";

/** Inputs for {@link shareAgent} beyond the reference itself. */
export interface ShareAgentOptions {
  /** Desired sharing state: `true` to enable, `false` to disable. */
  readonly enabled: boolean;
  /**
   * Desired audience. Omitted means "keep the agent's current audience" —
   * a plain toggle must never flip an org-members-only share back to
   * public (or vice versa).
   */
  readonly audience?: ShareAudience;
  /**
   * Rotate the share-link token: the server generates a fresh `?k=`
   * secret and the current link (tokened or plain) stops working
   * immediately. The token is server-owned status — never part of the
   * sharing block this module merges.
   */
  readonly resetLink?: boolean;
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

  const currentAudience = audienceFromProto(current?.audience);
  const targetAudience = options.audience ?? currentAudience;

  // Resetting the link is meaningless for org-members-only shares: their
  // access is gated by live membership, and the member link never carries
  // the token. Refuse rather than silently rotating an unused secret —
  // the share dialog hides its Reset control for org audience for the
  // same reason.
  if (options.resetLink === true && targetAudience === "org") {
    throw new UsageError(
      "--reset-link only applies to public links\n\n" +
        "This share is restricted to organization members, whose access is\n" +
        "checked on every message. To cut someone off, remove them from the\n" +
        "organization.",
    );
  }

  const alreadyInState =
    (current?.enabled ?? false) === options.enabled &&
    currentAudience === targetAudience;

  if (!alreadyInState) {
    // Send the COMPLETE sharing block with only the requested fields changed,
    // so a CLI toggle can never wipe console-configured origins, visitor
    // messages, or an org-members-only audience.
    await client.agent.updateSharing(
      create(UpdateAgentSharingInputSchema, {
        resourceId: agent.metadata?.id ?? "",
        sharing: preservingSharing(current, options.enabled, targetAudience),
      }),
    );
  }

  // The rotation is a separate targeted RPC (the token is server-owned
  // status, not part of the sharing block). The returned agent carries the
  // fresh token, so the link printed below is the new one.
  let linkToken = agent.status?.shareLinkToken ?? "";
  if (options.resetLink === true) {
    const rotated = await client.agent.rotateShareLink(
      create(RotateShareLinkInputSchema, {
        resourceId: agent.metadata?.id ?? "",
      }),
    );
    linkToken = rotated.status?.shareLinkToken ?? "";
  }

  return describeOutcome(agent, options, targetAudience, linkToken, alreadyInState && options.resetLink !== true);
}

// Unspecified means public by contract (pre-audience shares keep their
// anyone-with-link behavior).
function audienceFromProto(audience: AgentSharingAudience | undefined): ShareAudience {
  return audience === AgentSharingAudience.org ? "org" : "public";
}

// The full sharing config with the desired `enabled` and audience,
// preserving origins and messages (empty defaults when the agent was never
// shared before). The audience is written explicitly — never left
// unspecified — so a console-managed org share can't drift back to public.
function preservingSharing(
  current: AgentSharing | undefined,
  enabled: boolean,
  audience: ShareAudience,
): AgentSharing {
  return create(AgentSharingSchema, {
    enabled,
    audience:
      audience === "org"
        ? AgentSharingAudience.org
        : AgentSharingAudience.public,
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
// web share dialog derives them. The link token comes from the agent's
// status (post-rotation when --reset-link ran) and rides the printed URL
// and snippet — public audience only (org access is gated by membership).
function describeOutcome(
  agent: Agent,
  options: ShareAgentOptions,
  audience: ShareAudience,
  linkToken: string,
  alreadyInState: boolean,
): CommandResult {
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
    options.resetLink === true
      ? `Share link reset for '${name}' — the old link no longer works`
      : alreadyInState
        ? `Sharing is already on for '${name}'`
        : `Sharing enabled for '${name}'`,
  );

  const publicLinkToken = audience === "org" ? undefined : linkToken || undefined;
  result
    .addSection(audience === "org" ? "Member chat link" : "Public chat link")
    .item(buildChatUrl(options.appOrigin, org, slug, publicLinkToken));

  if (audience === "org") {
    // Embeds serve anonymous guests, which org-members-only shares refuse
    // by design — no snippet to print.
    result.hint(`Only signed-in members of ${org} can chat. Access ends when they leave the organization.`);
    result.hint(`Members chat on ${org}'s credits.`);
  } else {
    const snippetSection = result.addSection("Embed on your site");
    for (const line of buildEmbedSnippet(options.appOrigin, org, slug, publicLinkToken).split("\n")) {
      snippetSection.item(line);
    }

    result.hint(`Visitors chat on ${org}'s credits.`);
    result.hint("Public links can be forwarded and indexed by search engines.");
    if (options.resetLink === true) {
      result.hint("Re-share the new link with the people who should keep access.");
    }
  }
  if (options.isLocal) {
    result.hint("Guest chat is a Stigmer Cloud capability — this local link won't serve visitors.");
  }
  return result;
}
