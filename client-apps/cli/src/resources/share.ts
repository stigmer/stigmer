// `share agent` dispatch: enable or disable sharing for an agent and report
// the hosted chat link + embed snippet.
//
// Sharing lives in its own AgentShare resource (decision 011) — the agent is
// never modified. This module resolves the agent, reads its canonical share,
// and commits changes via `agentShare.apply`, an idempotent upsert keyed on
// the share's (org, slug) identity: the first enable creates the share, later
// toggles update it, one code path.
//
// The one correctness invariant here: apply replaces the share's spec
// WHOLESALE. A naive "set enabled" would silently wipe any allowed_origins,
// visitor messages, audience, or credential bindings the owner configured in
// the console. So this module always reads the current share first and sends
// the complete spec back with only the requested fields flipped — the same
// merge-preserve discipline as the web dialog. (The rotatable link token is
// exempt: it is server-owned status, which survives every apply verbatim.)
//
// URL and snippet shapes come from @stigmer/sdk's sharing helpers — the single
// source of truth shared with the web console — so every surface emits
// byte-identical output. The caller supplies the app origin (resolved from the
// backend type by the command layer) to keep this module pure and env-free.

import { create } from "@bufbuild/protobuf";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { AgentShare } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/api_pb";
import {
  GetAgentSharesByAgentRequestSchema,
  RotateShareLinkInputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/io_pb";
import { AgentShareAudience } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/spec_pb";
import {
  buildChatUrl,
  buildEmbedSnippet,
  type AgentShareInput,
  type Stigmer,
} from "@stigmer/sdk";
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
   * Desired audience. Omitted means "keep the share's current audience" —
   * a plain toggle must never flip an org-members-only share back to
   * public (or vice versa).
   */
  readonly audience?: ShareAudience;
  /**
   * Rotate the share-link token: the server generates a fresh `?k=`
   * secret and the current link (tokened or plain) stops working
   * immediately. The token is server-owned status — never part of the
   * spec this module merges.
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
 * outcome. Idempotent: when the canonical share is already in the desired
 * state, no write is issued (the link is still reported when sharing is
 * on). When the agent has never been shared, enabling creates the share.
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
  const agentOrg = agent.metadata?.org ?? "";
  // The share lands in the CALLER's resolved org (decision 013 D8): when
  // it differs from the agent's, this is a cross-org share — the caller
  // org's own channel (URL, billing, credentials) of another org's
  // marketplace-public agent. An empty org (ID ref without context)
  // falls back to the agent's own — the Phase A same-org form.
  const shareOrg = org || agentOrg;
  const isCrossOrg = shareOrg !== agentOrg;
  let share = await resolveCanonicalShare(client, agent, shareOrg);
  const current = share?.spec;

  const currentAudience = audienceFromProto(current?.audience);
  const targetAudience = options.audience ?? currentAudience;

  // Cross-org shares are public-audience only (decision 013 D3). The
  // server refuses this too; refusing here names the remedy instead of
  // surfacing a bare FAILED_PRECONDITION — and mirrors the share dialog,
  // which hides the audience selector in cross-org mode.
  if (isCrossOrg && targetAudience === "org") {
    throw new UsageError(
      "--audience org is not available for another organization's agent\n\n" +
        `A share of ${agentOrg}/${agent.metadata?.slug ?? ""} in your organization\n` +
        "(" + shareOrg + ") serves anyone with the link. Org-members-only sharing\n" +
        "is limited to the agent's own organization.",
    );
  }

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

  // Never-shared + disable is a no-op, not a write: creating a share row
  // just to mark it disabled would materialize a resource the owner never
  // asked for. The one exception is an explicit --audience org, which is
  // real configuration worth persisting as a paused share (mirroring the
  // pre-promotion behavior of storing audience on a disabled block).
  const alreadyInState =
    share !== null
      ? (current?.enabled ?? false) === options.enabled &&
        currentAudience === targetAudience
      : !options.enabled && targetAudience !== "org";

  if (!alreadyInState) {
    // Apply the COMPLETE spec with only the requested fields changed, so a
    // CLI toggle can never wipe console-configured origins, visitor
    // messages, credential bindings, or an org-members-only audience.
    share = await client.agentShare.apply(
      preservingShareInput(agent, share, shareOrg, options.enabled, targetAudience),
    );
  }

  // The rotation is a separate targeted RPC (the token is server-owned
  // status, not part of the spec apply merges). The returned share carries
  // the fresh token, so the link printed below is the new one.
  if (options.resetLink === true && share !== null) {
    share = await client.agentShare.rotateShareLink(
      create(RotateShareLinkInputSchema, {
        resourceId: share.metadata?.id ?? "",
      }),
    );
  }

  return describeOutcome(
    agent,
    share,
    options,
    targetAudience,
    alreadyInState && options.resetLink !== true,
  );
}

/**
 * The agent's canonical share **within one sharing org**: the one whose
 * slug equals the agent's (the server's default on create), else the
 * first entry in that org, else null when the agent has never been shared
 * there. Mirrors the web dialog's selection so both surfaces manage the
 * same row. The org scope is what keeps each org on its own channel
 * (decision 013): an agent may be shared in N orgs, and toggling here
 * must never edit another org's share. The server applies the scope via
 * the request's org field.
 */
async function resolveCanonicalShare(
  client: Stigmer,
  agent: Agent,
  shareOrg: string,
): Promise<AgentShare | null> {
  const result = await client.agentShare.getByAgent(
    create(GetAgentSharesByAgentRequestSchema, {
      agentId: agent.metadata?.id ?? "",
      org: shareOrg,
    }),
  );
  const agentSlug = agent.metadata?.slug ?? "";
  return (
    result.items.find((share) => share.metadata?.slug === agentSlug) ??
    result.items[0] ??
    null
  );
}

// Unspecified means public by contract (a share created without an explicit
// audience is an anyone-with-link share).
function audienceFromProto(audience: AgentShareAudience | undefined): ShareAudience {
  return audience === AgentShareAudience.org ? "org" : "public";
}

// The full share input with the desired `enabled` and audience, preserving
// origins, messages, and credential bindings (empty defaults when the agent
// was never shared before). Identity comes from the existing share when one
// exists — a manifest-created share may carry a non-default slug, and
// applying with the agent's slug would create a SECOND share — and from the
// sharing org + the agent's slug otherwise (the server's own D2 default,
// made explicit; for a cross-org share the org is the CALLER's, not the
// agent's — decision 013). The audience is written explicitly — never left
// unspecified — so a console-managed org share can't drift back to public.
function preservingShareInput(
  agent: Agent,
  share: AgentShare | null,
  shareOrg: string,
  enabled: boolean,
  audience: ShareAudience,
): AgentShareInput {
  const agentOrg = agent.metadata?.org ?? "";
  const agentSlug = agent.metadata?.slug ?? "";
  const current = share?.spec;
  return {
    org: share?.metadata?.org || shareOrg,
    slug: share?.metadata?.slug || agentSlug,
    name: share?.metadata?.name || agent.metadata?.name || agentSlug,
    agentRef: { org: agentOrg, slug: agentSlug },
    enabled,
    audience:
      audience === "org"
        ? AgentShareAudience.org
        : AgentShareAudience.public,
    allowedOrigins: [...(current?.allowedOrigins ?? [])],
    messages: {
      rateLimited: current?.messages?.rateLimited ?? "",
      unavailable: current?.messages?.unavailable ?? "",
      conversationEnded: current?.messages?.conversationEnded ?? "",
    },
    environmentRefs: (current?.environmentRefs ?? []).map((envRef) => ({
      org: envRef.org,
      slug: envRef.slug,
    })),
  };
}

// Build the user-facing result. Org/slug come from the SHARE's metadata —
// the identity in the hosted chat URL (a share may carry a non-default
// slug) — falling back to the resolved agent's on disable-when-never-shared.
// The link token comes from the share's status (post-rotation when
// --reset-link ran) and rides the printed URL and snippet — public audience
// only (org access is gated by membership).
function describeOutcome(
  agent: Agent,
  share: AgentShare | null,
  options: ShareAgentOptions,
  audience: ShareAudience,
  alreadyInState: boolean,
): CommandResult {
  const org = share?.metadata?.org || (agent.metadata?.org ?? "");
  const slug = share?.metadata?.slug || (agent.metadata?.slug ?? "");
  const name = agent.metadata?.name || slug;
  const linkToken = share?.status?.shareLinkToken ?? "";

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
