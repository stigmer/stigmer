/**
 * The one data migration both store drivers run when every named kind's
 * slug becomes a name in the name table (pipeline/steps/names.ts): every
 * stored row of such a kind has its slug recorded as its current name,
 * once, before any request is served, so a create after the upgrade is
 * refused a slug a row already holds and a lookup by slug finds it. The
 * drivers own the SQL (the keyset pages, the insert, the transaction);
 * this module owns what is driver-neutral: which kinds, how a row's name
 * is read, and which row keeps a name two rows share.
 *
 * A slug two rows of one kind and organization share. Before the table,
 * two creates of one slug could both land (stigmer#2153), so a store may
 * hold such pairs. The oldest row keeps the name, by its creation time,
 * then by id, whose ULID is time-ordered; every other row is reported at
 * warn with its id, the id that kept the name, and what to do: rename the
 * row or delete it. The server starts: a newer row stays readable by id
 * and in lists, and only a lookup by its slug reaches the older one. A
 * boot that refused would stop a self-hosted server over data a race made.
 *
 * Why the kind table is frozen here and not read from the live table
 * (names.ts NAMED_KINDS). The step is a statement about the store as it was
 * when the names arrived: a later release that adds a named kind claims
 * its names from its first create, and must not change what this step does
 * to a database it has not reached yet (organization-slug-history.ts gives
 * the same reason). The `kind` strings are the enum names the drivers'
 * `kind` column holds. Organizations are absent: their names were recorded
 * when the table arrived. Teams and identity providers are absent: an
 * edition keeps their rows in its own tables. A person's identity account
 * names nothing (it has no unique slug); a service account names its slug.
 *
 * Why an undecodable row fails the step. Its slug cannot be read, so it
 * cannot be claimed, and a later create of that slug would land beside it.
 * The driver's transaction rolls back and the boot stops on the row this
 * names, the rule every data migration here keeps.
 */
import { fromBinary } from "@bufbuild/protobuf";
import type { DescMessage, Message } from "@bufbuild/protobuf";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { Timestamp } from "@bufbuild/protobuf/wkt";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentEvalSchema } from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/api_pb";
import { AgentChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import { AgentShareSchema } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/api_pb";
import { ChannelAppSchema } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/api_pb";
import { EvaluatorSchema } from "@stigmer/protos/ai/stigmer/agentic/evaluator/v1/api_pb";
import { MemorySchema } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/api_pb";
import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { PluginEvalSchema } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { ScoreSchema } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SkillSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import { VaultSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";
import { OAuthAppSchema } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/api_pb";
import { PlatformClientSchema } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/api_pb";

import type { StoreLogger } from "./logger.js";

/** How many rows a keyset page of the backfill reads. */
export const RESOURCE_NAMES_BACKFILL_PAGE_SIZE = 500;

/** One kind whose rows name themselves, as this step reads them. */
export interface NamedKindAtBackfill {
  /** The enum name the drivers' `kind` column holds. */
  readonly kind: string;
  readonly schema: DescMessage;
  /** Whether a decoded row names itself; absent means every row does. */
  readonly names?: (resource: Message) => boolean;
}

/** The kinds whose slugs became names at this step, frozen. */
export const NAMED_KINDS_AT_BACKFILL: ReadonlyArray<NamedKindAtBackfill> = [
  { kind: "agent", schema: AgentSchema },
  { kind: "agent_eval", schema: AgentEvalSchema },
  { kind: "agent_channel", schema: AgentChannelSchema },
  { kind: "agent_share", schema: AgentShareSchema },
  { kind: "channel_app", schema: ChannelAppSchema },
  { kind: "evaluator", schema: EvaluatorSchema },
  {
    kind: "identity_account",
    schema: IdentityAccountSchema,
    names: (resource) =>
      (resource as IdentityAccount).spec?.provisioningMode ===
      IdentityAccountProvisioningMode.service_account,
  },
  { kind: "memory", schema: MemorySchema },
  { kind: "oauth_app", schema: OAuthAppSchema },
  { kind: "platform_client", schema: PlatformClientSchema },
  { kind: "plugin", schema: PluginSchema },
  { kind: "plugin_eval", schema: PluginEvalSchema },
  { kind: "schedule", schema: ScheduleSchema },
  { kind: "score", schema: ScoreSchema },
  { kind: "session", schema: SessionSchema },
  { kind: "skill", schema: SkillSchema },
  { kind: "vault", schema: VaultSchema },
];

/** One name the step records: a row's slug as its current name. */
export interface BackfilledName {
  readonly kind: string;
  readonly org: string;
  readonly name: string;
  readonly id: string;
  /** RFC-3339: the row's creation time, or the step's own when the row has none. */
  readonly claimedAt: string;
}

interface Candidate extends BackfilledName {
  /** The creation time the order is judged by; "" sorts after every stamped row. */
  readonly createdAt: string;
}

/**
 * The names one kind's rows hold, read row by row as the driver pages
 * them. `add` decodes a row and keeps, for each slug, the row that keeps
 * the name; `names` hands the winners to insert, and reports every row
 * that lost its slug to an older one.
 */
export class KindNameBackfill {
  private readonly held = new Map<string, Candidate>();
  private readonly displaced: Candidate[] = [];

  constructor(
    private readonly named: NamedKindAtBackfill,
    private readonly now: string,
  ) {}

  /** Reads one stored row; throws, naming it, when it does not decode. */
  add(id: string, data: Uint8Array): void {
    let resource: Message;
    try {
      resource = fromBinary(this.named.schema, data);
    } catch (error) {
      throw unreadableNamedRowError(this.named.kind, id, error);
    }
    if (this.named.names !== undefined && !this.named.names(resource)) {
      return;
    }
    const row = resource as NamedRow;
    const org = row.metadata?.org ?? "";
    const slug = row.metadata?.slug ?? "";
    if (org === "" || slug === "") {
      return;
    }
    const createdAt = createdAtOf(row);
    const candidate: Candidate = {
      kind: this.named.kind,
      org,
      name: slug,
      id,
      claimedAt: createdAt === "" ? this.now : createdAt,
      createdAt,
    };
    const key = `${org}\u0000${slug}`;
    const holder = this.held.get(key);
    if (holder === undefined) {
      this.held.set(key, candidate);
    } else if (isOlder(candidate, holder)) {
      this.held.set(key, candidate);
      this.displaced.push(holder);
    } else {
      this.displaced.push(candidate);
    }
  }

  /** The names to record, after reporting every row that lost its slug. */
  names(logger: StoreLogger): BackfilledName[] {
    for (const row of this.displaced) {
      const keeper = this.held.get(`${row.org}\u0000${row.name}`);
      logger.warn(
        "two resources of one kind share a slug in an organization; the older keeps the name, rename or delete the other",
        {
          kind: row.kind,
          org: row.org,
          slug: row.name,
          id: row.id,
          keptBy: keeper?.id ?? "",
        },
      );
    }
    return [...this.held.values()].map(
      ({ kind, org, name, id, claimedAt }) => ({
        kind,
        org,
        name,
        id,
        claimedAt,
      }),
    );
  }
}

/** The fault that stops the step on a row whose slug cannot be read. */
export function unreadableNamedRowError(
  kind: string,
  id: string,
  error: unknown,
): Error {
  return new Error(
    `${kind} '${id}' cannot be read to record its slug as its name: ${String(error)}`,
    { cause: error },
  );
}

function isOlder(a: Candidate, b: Candidate): boolean {
  if (a.createdAt !== b.createdAt) {
    if (a.createdAt === "") {
      return false;
    }
    if (b.createdAt === "") {
      return true;
    }
    return a.createdAt < b.createdAt;
  }
  return a.id < b.id;
}

/**
 * The fields this step reads, which every named kind's row shares: the
 * resource envelope's metadata and its status audit.
 */
interface NamedRow {
  readonly metadata?: { readonly org: string; readonly slug: string };
  readonly status?: {
    readonly audit?: { readonly specAudit?: { readonly createdAt?: Timestamp } };
  };
}

/** `status.audit.spec_audit.created_at` as RFC-3339, or "" when the row has none. */
function createdAtOf(row: NamedRow): string {
  const createdAt = row.status?.audit?.specAudit?.createdAt;
  if (createdAt === undefined) {
    return "";
  }
  return timestampDate(createdAt).toISOString();
}
