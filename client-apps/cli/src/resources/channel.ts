// `channel` dispatch: `link` turns an agent's chat link on or off and
// reports the hosted chat link + embed snippet; `enable` and `disable` flip
// any channel's switch.
//
// An agent's chat link is a web channel (a Channel whose spec carries
// `web`) — the agent is never modified. `link` resolves the agent, finds
// its web channel (the canonical one, or the one `--name` names), and
// writes it one of two ways:
//
//   - An existing link is applied whole. apply replaces the channel's spec
//     WHOLESALE, so a naive "set enabled" would silently wipe any
//     allowed_origins, visitor messages, audience, credential bindings or
//     run settings the owner configured in the console. This module reads
//     the current channel first and sends the complete spec back with only
//     the requested fields flipped — the same merge-preserve discipline as
//     the web dialog. (The rotatable link token is exempt: it is
//     server-owned status, which survives every apply verbatim.)
//   - A new link is a strict create, never an apply: one organization's
//     channels of every type share one set of slugs, so an apply under a
//     slug another channel holds would update THAT channel (and be refused
//     as a change of its type or agent). A create whose slug is taken is
//     refused as AlreadyExists, which this module answers by naming the
//     holder and `--name`; it never picks another slug on its own.
//
// `enable` and `disable` are the masked update the console's switch sends
// (`spec.enabled` alone), so they work on every channel type and keep
// everything else as stored. Disabling pauses a channel; delete is the
// teardown.
//
// URL and snippet shapes come from @stigmer/client's sharing helpers — the single
// source of truth shared with the web console — so every surface emits
// byte-identical output. The caller supplies the app origin (resolved from the
// backend type by the command layer) to keep this module pure and env-free.

import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { Code } from "@connectrpc/connect";
import type { Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import type { Channel, ChannelSchema } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/api_pb";
import { RotateChannelLinkInputSchema } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/io_pb";
import { ChannelAudience, type WebChannelConfig } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import {
  buildChatUrl,
  buildEmbedSnippet,
  getErrorReason,
  StigmerError,
  toChannelInput,
  type ChannelInput,
  type Stigmer,
} from "@stigmer/client";
import { UsageError } from "../errors/index.js";
import { CommandResult } from "../output/index.js";
import { idPrefixesFor, isAgentId, parseReference } from "./reference.js";
import { resolveAgentRef } from "./run/resolve.js";
import { requireOrganization } from "../client/single-org.js";
import { organizationLabel, sameOrganization } from "../client/organizations.js";

/** Who can chat over the link. Mirrors the SDK's SharingAudience. */
export type LinkAudience = "public" | "org";

/** Inputs for {@link linkAgent} beyond the reference itself. */
export interface LinkAgentOptions {
  /** Desired link state: `true` to turn it on, `false` to turn it off. */
  readonly enabled: boolean;
  /**
   * Desired audience. Omitted means "keep the link's current audience" —
   * a plain toggle must never flip an org-members-only link back to
   * public (or vice versa).
   */
  readonly audience?: LinkAudience;
  /**
   * Rotate the link token: the server generates a fresh `?k=` secret and
   * the current link (tokened or plain) stops working immediately. The
   * token is server-owned status — never part of the spec this module
   * merges.
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
  /**
   * The chat link's slug (`--name`): which web channel of the agent to
   * edit, and the slug a new one is created under. Omitted means the
   * agent's canonical link, created as `<agent slug>-web`.
   */
  readonly name?: string;
}

/** The ErrorInfo reason of a create whose slug a renamed channel still holds. */
const REASON_SLUG_RESERVED = "SLUG_RESERVED";

/**
 * Turn the referenced agent's chat link on or off and describe the
 * outcome. Idempotent: when the link is already in the desired state, no
 * write is issued (the link is still reported when it is on). When the
 * agent has no link yet, turning it on creates one.
 */
export async function linkAgent(
  client: Stigmer,
  ref: string,
  org: string,
  options: LinkAgentOptions,
): Promise<CommandResult> {
  // Fail fast with actionable guidance instead of the backend's validation
  // error, on a server that needs an org — mirrors the connect org guard.
  if (!isAgentId(ref) && !ref.includes("/")) {
    await requireOrganization(client, org, [
      "stigmer config context set --org <org>",
      `stigmer channel link ${ref} --org <org>`,
    ]);
  }

  const agent = await resolveAgentRef(client, ref, org);
  const agentOrg = agent.metadata?.org ?? "";
  // A chat link lives in its agent's organization: its URL, billing and
  // credential bindings belong to the organization that owns the agent.
  // The server refuses an agent_ref in any other organization; refusing
  // here names the remedy instead of surfacing a bare FAILED_PRECONDITION,
  // and mirrors the chat link dialog, which never offers another org's
  // agent. An empty org (an ID ref without context) is the agent's own.
  // The agent names its organization by id and the caller may name it by
  // slug, so a mismatch is asked about before it is refused. Both
  // organizations print by slug: the requested one may be the context's id.
  if (org !== "" && !(await sameOrganization(client, org, agentOrg))) {
    const [agentOrgLabel, orgLabel] = await Promise.all([
      organizationLabel(client, agentOrg),
      organizationLabel(client, org),
    ]);
    throw new UsageError(
      `a chat link of ${agentOrgLabel}/${agent.metadata?.slug ?? ""} lives in ${agentOrgLabel}, not ${orgLabel}\n\n` +
        "A chat link is the agent's own organization's channel. To offer another\n" +
        "organization's agent from yours, install the plugin that carries it and\n" +
        "link the installed copy. To manage this agent's own link:\n" +
        `  stigmer channel link ${ref} --org ${agentOrgLabel}`,
    );
  }
  const linkOrg = agentOrg;
  let link =
    options.name !== undefined
      ? await resolveNamedWebChannel(client, agent, linkOrg, options.name, ref)
      : await resolveCanonicalWebChannel(client, agent, linkOrg);
  const currentWeb = webConfigOf(link);

  const currentAudience = audienceFromProto(currentWeb?.audience);
  const targetAudience = options.audience ?? currentAudience;

  // Resetting the link is meaningless for org-members-only links: their
  // access is gated by live membership, and the member link never carries
  // the token. Refuse rather than silently rotating an unused secret —
  // the chat link dialog hides its Reset control for org audience for the
  // same reason.
  if (options.resetLink === true && targetAudience === "org") {
    throw new UsageError(
      "--reset-link only applies to public links\n\n" +
        "This link is restricted to organization members, whose access is\n" +
        "checked on every message. To cut someone off, remove them from the\n" +
        "organization.",
    );
  }

  // No link + turn off is a no-op, not a write: creating a channel just to
  // mark it disabled would materialize a resource the owner never asked
  // for. The one exception is an explicit --audience org, which is real
  // configuration worth persisting as a paused link. The test is what the
  // owner passed, not the target: a new link's target is org by default,
  // and that alone asks for nothing.
  const alreadyInState =
    link !== null
      ? (link.spec?.enabled ?? false) === options.enabled &&
        currentAudience === targetAudience
      : !options.enabled && options.audience !== "org";

  if (!alreadyInState) {
    link =
      link !== null
        ? // Apply the COMPLETE spec with only the requested fields changed,
          // so a CLI toggle can never wipe console-configured origins,
          // visitor messages, credential bindings, run settings, or an
          // org-members-only audience.
          await client.channel.apply(
            preservingChannelInput(link, options.enabled, targetAudience),
          )
        : await createLink(client, agent, linkOrg, ref, options, targetAudience);
  }

  // The rotation is a separate targeted RPC (the token is server-owned
  // status, not part of the spec apply merges). The returned channel
  // carries the fresh token, so the link printed below is the new one.
  if (options.resetLink === true && link !== null) {
    link = await client.channel.rotateLink(
      create(RotateChannelLinkInputSchema, {
        resourceId: link.metadata?.id ?? "",
      }),
    );
  }

  const outcomeOrg = link?.metadata?.org || linkOrg;
  return describeOutcome(
    agent,
    link,
    options,
    targetAudience,
    alreadyInState && options.resetLink !== true,
    await organizationLabel(client, outcomeOrg),
  );
}

/**
 * The agent's canonical web channel **within one org**: the one whose slug
 * is `<agent slug>-web` (the server's name for a nameless web channel),
 * else the one whose slug equals the agent's (a chat link made before
 * links were channels keeps the agent's slug), else the first web channel
 * in that org, else null when the agent has no link there. Slack and
 * WhatsApp channels are never this command's row. Mirrors the web dialog's
 * selection so both surfaces manage the same row. The org scope is the
 * agent's organization, where every channel of it lives; the server
 * applies the scope via the request's org field, so a link written in
 * another organization before sharing across organizations was retired is
 * never the row this command edits.
 */
async function resolveCanonicalWebChannel(
  client: Stigmer,
  agent: Agent,
  linkOrg: string,
): Promise<Channel | null> {
  const agentSlug = agent.metadata?.slug ?? "";
  let ownSlug: Channel | null = null;
  let first: Channel | null = null;
  for await (const channel of client.channel.listByAgentAll({
    agentId: agent.metadata?.id ?? "",
    org: linkOrg,
  })) {
    if (channel.spec?.type.case !== "web") continue;
    const slug = channel.metadata?.slug;
    if (slug === `${agentSlug}-web`) return channel;
    if (slug === agentSlug) ownSlug ??= channel;
    first ??= channel;
  }
  return ownSlug ?? first;
}

/**
 * The agent's channel the `--name` slug names, when it is one of the
 * agent's web channels; null when the agent has no channel by that slug
 * (a new link is created under it). A Slack or WhatsApp channel of the
 * agent by that slug is refused, never edited, in the words a taken name
 * gets.
 */
async function resolveNamedWebChannel(
  client: Stigmer,
  agent: Agent,
  linkOrg: string,
  name: string,
  ref: string,
): Promise<Channel | null> {
  for await (const channel of client.channel.listByAgentAll({
    agentId: agent.metadata?.id ?? "",
    org: linkOrg,
  })) {
    if (channel.metadata?.slug !== name) continue;
    if (channel.spec?.type.case === "web") return channel;
    throw nameHeldError(name, describeHolder(channel), ref);
  }
  return null;
}

/**
 * Create the agent's new chat link, strictly: never an apply, so it can
 * never update the channel that holds its slug. Without `--name` the
 * channel is nameless and the server names it `<agent slug>-web` (its
 * display name `<agent name> (Web)`); with `--name` it takes that slug.
 * A taken slug is refused naming its holder.
 */
async function createLink(
  client: Stigmer,
  agent: Agent,
  linkOrg: string,
  ref: string,
  options: LinkAgentOptions,
  audience: LinkAudience,
): Promise<Channel> {
  const slug = options.name ?? `${agent.metadata?.slug ?? ""}-web`;
  try {
    return await client.channel.create(newChannelInput(agent, linkOrg, options, audience));
  } catch (err) {
    if (!isAlreadyExists(err)) throw err;
    if (getErrorReason(err)?.reason === REASON_SLUG_RESERVED) {
      throw new UsageError(
        `the name \`${slug}\` was another channel's until it was renamed in the last 30 days, and still leads to that channel\n\n` +
          nameRemedy(ref),
      );
    }
    throw nameHeldError(slug, await holderOf(client, err), ref);
  }
}

// AlreadyExists, as the SDK raises it (a StigmerError over the ConnectError).
function isAlreadyExists(err: unknown): err is Error {
  return err instanceof StigmerError && err.connectCode === Code.AlreadyExists;
}

// The holder's words: its type and agent when the caller may read it, its
// id when not, and "another channel" when the refusal names no id. The
// server's duplicate copy carries the holder's id as `(id: <id>)`.
async function holderOf(client: Stigmer, err: Error): Promise<string> {
  const id = /\(id: ([^)\s]+)\)/.exec(err.message)?.[1];
  if (id === undefined) return "another channel";
  try {
    return describeHolder(await client.channel.get(id));
  } catch {
    return `channel ${id}`;
  }
}

/** The display word of each channel type, as a sentence names it. */
const TYPE_WORDS: Readonly<Record<string, string>> = {
  web: "a chat link",
  slack: "a Slack channel",
  whatsapp: "a WhatsApp channel",
};

function describeHolder(channel: Channel): string {
  const type = TYPE_WORDS[channel.spec?.type.case ?? ""] ?? "a channel";
  const agentSlug = channel.spec?.agentRef?.slug ?? "";
  return agentSlug === "" ? type : `${type} of agent \`${agentSlug}\``;
}

function nameHeldError(slug: string, holder: string, ref: string): UsageError {
  return new UsageError(`the name \`${slug}\` is held by ${holder}\n\n${nameRemedy(ref)}`);
}

function nameRemedy(ref: string): string {
  return (
    "One organization's channels share one set of names. Pass --name <slug>\n" +
    "to give this chat link another name:\n" +
    `  stigmer channel link ${ref} --name <slug>`
  );
}

// The web arm of a channel's spec; undefined when there is no channel yet.
function webConfigOf(channel: Channel | null): WebChannelConfig | undefined {
  const type = channel?.spec?.type;
  return type?.case === "web" ? type.value : undefined;
}

// Unspecified means the organization by contract: a link reaches anyone on
// the internet only when public is chosen, so a new link without
// --audience is organization-only.
function audienceFromProto(audience: ChannelAudience | undefined): LinkAudience {
  return audience === ChannelAudience.public ? "public" : "org";
}

function protoAudience(audience: LinkAudience): ChannelAudience {
  return audience === "org" ? ChannelAudience.org : ChannelAudience.public;
}

// The full channel input with the desired `enabled` and audience. The
// existing channel is restated whole (its id, name, slug, labels, origins,
// messages, credential bindings and run settings), so the apply changes
// that row and only the two fields; a manifest-created channel may carry
// any slug, and applying under another would create a SECOND channel. The
// audience is written explicitly — never left unspecified — so every
// stored channel says what it means.
function preservingChannelInput(
  channel: Channel,
  enabled: boolean,
  audience: LinkAudience,
): ChannelInput {
  const restated = toChannelInput(channel);
  const web = webConfigOf(channel);
  return {
    ...restated,
    enabled,
    web: {
      audience: protoAudience(audience),
      allowedOrigins: [...(web?.allowedOrigins ?? [])],
      messages: {
        rateLimited: web?.messages?.rateLimited ?? "",
        unavailable: web?.messages?.unavailable ?? "",
        conversationEnded: web?.messages?.conversationEnded ?? "",
      },
    },
  };
}

// A new web channel with empty configuration: nameless (the server names
// it after the agent) unless `--name` gave its slug.
function newChannelInput(
  agent: Agent,
  linkOrg: string,
  options: LinkAgentOptions,
  audience: LinkAudience,
): ChannelInput {
  return {
    org: linkOrg,
    name: options.name ?? "",
    ...(options.name !== undefined ? { slug: options.name } : {}),
    agentRef: { org: agent.metadata?.org ?? "", slug: agent.metadata?.slug ?? "" },
    enabled: options.enabled,
    web: {
      audience: protoAudience(audience),
      allowedOrigins: [],
      messages: { rateLimited: "", unavailable: "", conversationEnded: "" },
    },
    vaults: [],
  };
}

// Build the user-facing result. The hosted chat link and the embed name the
// web channel by its id, the one identity a link carries, so no rename of
// the organization or the channel breaks them. The re-enable hint names the
// agent by its own slug, the reference this command takes (a channel's slug
// names the channel, never the agent), and the `--name` the caller passed.
// The link token comes from the channel's web status (post-rotation when
// --reset-link ran) and rides the printed URL and snippet — public audience
// only (org access is gated by membership). The words a person reads name
// the organization by `orgLabel`, its slug.
function describeOutcome(
  agent: Agent,
  link: Channel | null,
  options: LinkAgentOptions,
  audience: LinkAudience,
  alreadyInState: boolean,
  orgLabel: string,
): CommandResult {
  const channelId = link?.metadata?.id ?? "";
  const slug = agent.metadata?.slug ?? "";
  const name = agent.metadata?.name || slug;
  const typeStatus = link?.status?.typeStatus;
  const linkToken = typeStatus?.case === "web" ? typeStatus.value.linkToken : "";

  if (!options.enabled) {
    const result = CommandResult.success(
      alreadyInState ? `The chat link is already off for '${name}'` : `Chat link turned off for '${name}'`,
    );
    result.hint("The chat link no longer works. Turn it back on with:");
    result.hint(
      `  stigmer channel link ${orgLabel}/${slug}${options.name !== undefined ? ` --name ${options.name}` : ""}`,
    );
    return result;
  }

  const result = CommandResult.success(
    options.resetLink === true
      ? `Chat link reset for '${name}' — the old link no longer works`
      : alreadyInState
        ? `The chat link is already on for '${name}'`
        : `Chat link turned on for '${name}'`,
  );

  const publicLinkToken = audience === "org" ? undefined : linkToken || undefined;
  result
    .addSection(audience === "org" ? "Member chat link" : "Public chat link")
    .item(buildChatUrl(options.appOrigin, channelId, publicLinkToken));

  if (audience === "org") {
    // Embeds serve anonymous guests, which org-members-only links refuse
    // by design — no snippet to print.
    result.hint(`Only signed-in members of ${orgLabel} can chat. Access ends when they leave the organization.`);
    result.hint(`Members chat on ${orgLabel}'s own provider keys.`);
  } else {
    const snippetSection = result.addSection("Embed on your site");
    for (const line of buildEmbedSnippet(options.appOrigin, channelId, publicLinkToken).split("\n")) {
      snippetSection.item(line);
    }

    result.hint(`Visitors chat on ${orgLabel}'s own provider keys.`);
    result.hint("Public links can be forwarded and indexed by search engines.");
    if (options.resetLink === true) {
      result.hint("Re-share the new link with the people who should keep access.");
    }
  }
  // Only a public link needs guest sign-in; an organization link is the one
  // a self-hosted server serves.
  if (options.isLocal && audience === "public") {
    result.hint("Guest chat is a Stigmer Cloud capability — this local link won't serve visitors.");
  }
  return result;
}

/**
 * Turn the referenced channel (a `chn_…` id, `org/slug`, or bare slug
 * against `org`) on or off, whatever its type, and describe the outcome.
 * The write is the masked update of `spec.enabled` alone; a channel
 * already in the state is reported without a write. Disabling pauses the
 * channel: its configuration, credentials and install stay as stored.
 */
export async function setChannelEnabled(
  client: Stigmer,
  ref: string,
  org: string,
  enabled: boolean,
): Promise<CommandResult> {
  const verb = enabled ? "enable" : "disable";
  const before = await loadChannel(client, ref, org, verb);
  const id = before.metadata?.id ?? "";
  const slug = before.metadata?.slug ?? "";
  const name = before.metadata?.name || slug;
  const alreadyInState = (before.spec?.enabled ?? false) === enabled;

  const after = alreadyInState
    ? before
    : await client.channel.update(
        {
          metadata: { id, org: before.metadata?.org ?? "" },
          spec: { enabled },
        } satisfies MessageInitShape<typeof ChannelSchema>,
        ["spec.enabled"],
      );

  const result = CommandResult.success(
    enabled
      ? alreadyInState
        ? `Channel '${name}' is already enabled`
        : `Channel '${name}' enabled`
      : alreadyInState
        ? `Channel '${name}' is already disabled`
        : `Channel '${name}' disabled`,
  );
  result
    .addSection()
    .field("ID", id)
    .field("Slug", slug)
    .field("Type", after.spec?.type.case ?? "")
    .field("Enabled", String(after.spec?.enabled ?? false));
  if (!enabled) {
    result.hint("The channel is paused, not torn down: its configuration is kept. Turn it back on with:");
    result.hint(`  stigmer channel enable ${ref}`);
  }
  return result;
}

async function loadChannel(client: Stigmer, ref: string, org: string, verb: string): Promise<Channel> {
  const parsed = parseReference(ref, org, idPrefixesFor(ApiResourceKind.channel));
  if (parsed.kind === "id") {
    return client.channel.get(parsed.id);
  }
  await requireOrganization(client, parsed.org, [
    "stigmer config context set --org <org>",
    `stigmer channel ${verb} ${ref} --org <org>`,
  ]);
  return client.channel.getByReference({ org: parsed.org, slug: parsed.slug });
}
