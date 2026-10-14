/**
 * The one data migration both store drivers run when references come to
 * hold ids (pipeline/steps/references.ts): every reference a stored row's
 * spec carries is rewritten from the name it was written with to the id of
 * the resource that name held at the upgrade, once, before any request is
 * served. A reference then keeps meaning that resource when it is renamed,
 * and never means a new resource that takes a deleted one's name. The
 * drivers own the SQL (the keyset pages, the name index read, the update,
 * the transaction); this module owns what is driver-neutral: which kinds,
 * how a row's references are found, and how one is resolved.
 *
 * What a rewrite does to one reference, in the walk the write chain's
 * resolver makes (every ApiResourceReference under `spec`, at any depth):
 *   - one that already holds an id is left as it is;
 *   - an empty `kind` takes the kind its field declares (`reference_kind`),
 *     so every stored reference names its kind for the response fill;
 *   - an empty `org` takes the row's own organization; an `org` that is no
 *     organization id is resolved as an organization's name;
 *   - its slug is resolved through the name table, which the v24/v29
 *     backfill filled (resource-names-backfill.ts): the id is set and the
 *     slug cleared;
 *   - a session's own agent (`spec.agent_ref`) takes the id its
 *     `status.agent_id` pins when it holds one, not the name's holder now:
 *     every turn runs the pinned agent, so a session whose agent was
 *     deleted and whose name another agent took since keeps naming the
 *     agent it runs, never the newcomer.
 * A reference whose organization or name nothing holds keeps its slug and
 * an empty id, as the write chain keeps a name nothing holds. It is never
 * dropped: the reference rule refuses it at the row's next write, and its
 * run refuses it naming it. Each kind's misses are logged at warn once, as
 * a count and a capped sample.
 *
 * What it does not do. No hash moves and no version is minted: an agent's
 * `status.version_hash` names what was saved, and its archived versions in
 * `resource_audit` are rewritten in place under their hashes, so a session
 * pinned to a version before the upgrade still runs it. The first save of
 * an agent afterwards mints one version. Other kinds' audit history keeps
 * what it recorded, as a run keeps its spec. A stored run holds no
 * reference (its session's spec is replaced by the session's id).
 *
 * Why the kind tables here are frozen and not read from the live contract.
 * The step is a statement about the store as it was when references came
 * to hold ids: a later release that adds a referring kind writes ids from
 * its first create, and must not change what this step does to a database
 * it has not reached yet (resource-names-backfill.ts gives the same
 * reason). The `kind` strings are the enum names the drivers' `kind`
 * column holds. Rows are decoded with the generated schemas and each
 * field's `reference_kind` is read from them, so the walk is the
 * contract's as built: a later change to a field that holds a reference
 * (its number, its type, its declared kind) must keep what this step reads
 * from an older row, as every wire change must.
 * The step reads only the library's own tables: a composition that keeps
 * referring rows in tables of its own rewrites their references itself.
 *
 * Why a federated identity account fails the step. A federated account's
 * id is derived from its identity provider (domain/identityaccount/
 * constants.ts, federatedAccountIdFor), and from this release on from the
 * provider's id rather than its organization and name. Rewriting the
 * account's reference would leave the row at an address no lookup reaches,
 * and the next sign-in would provision a second account beside it, so the
 * step refuses to run over one instead, naming it. None is expected: open
 * source answers federation UNIMPLEMENTED without an edition, and no
 * edition that stores federated accounts in these tables has shipped.
 *
 * Why an undecodable row fails the step. Its references cannot be read,
 * so they cannot be rewritten, and a later read would meet a reference in
 * the old shape. The driver's transaction rolls back and the boot stops on
 * the row this names, the rule every data migration here keeps.
 */
import { fromBinary, getOption, hasOption, toBinary } from "@bufbuild/protobuf";
import type { DescField, DescMessage } from "@bufbuild/protobuf";
import { reflect } from "@bufbuild/protobuf/reflect";
import type { ReflectMessage } from "@bufbuild/protobuf/reflect";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import { AgentEvalSchema } from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/api_pb";
import { AgentShareSchema } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/api_pb";
import { PluginEvalSchema } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { reference_kind } from "@stigmer/protos/ai/stigmer/commons/apiresource/field_options_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";

import { FrozenPlatformClientEnvelopeSchema } from "./frozen-envelopes.js";
import type { StoreLogger } from "./logger.js";

/** How many rows a keyset page of the rewrite reads. */
export const REFERENCES_BY_ID_PAGE_SIZE = 500;

/** One kind whose rows carry references, as this step reads them. */
export interface ReferringKindAtRewrite {
  /** The enum name the drivers' `kind` column holds. */
  readonly kind: string;
  readonly schema: DescMessage;
}

/** The kinds whose rows' references were rewritten at this step, frozen. */
export const REFERRING_KINDS_AT_REWRITE: ReadonlyArray<ReferringKindAtRewrite> = [
  { kind: "agent", schema: AgentSchema },
  { kind: "agent_channel", schema: AgentChannelSchema },
  { kind: "agent_eval", schema: AgentEvalSchema },
  { kind: "agent_share", schema: AgentShareSchema },
  { kind: "identity_account", schema: IdentityAccountSchema },
  { kind: "platform_client", schema: FrozenPlatformClientEnvelopeSchema },
  { kind: "plugin_eval", schema: PluginEvalSchema },
  { kind: "schedule", schema: ScheduleSchema },
  { kind: "session", schema: SessionSchema },
];

/** The kind whose archived versions (`resource_audit`) are rewritten too, frozen. */
export const ARCHIVED_KIND_AT_REWRITE: ReferringKindAtRewrite = {
  kind: "agent",
  schema: AgentSchema,
};

/** The kinds a reference may name at this step, and organizations, whose names the step reads, frozen. */
export const NAMED_KINDS_AT_REWRITE: ReadonlyArray<string> = [
  "agent",
  "channel_app",
  "identity_provider",
  "organization",
  "plugin",
  "skill",
  "vault",
];

/** One live name in the name table, as the driver reads it. */
export interface NameAtRewrite {
  readonly kind: string;
  readonly org: string;
  readonly name: string;
  readonly id: string;
}

/** How many misses of one kind the warn names. */
const MISSES_SAMPLED = 5;

const API_RESOURCE_REFERENCE_TYPE =
  "ai.stigmer.commons.apiresource.ApiResourceReference";

/** The message a session's own agent reference sits in, and the field. */
const SESSION_SPEC_TYPE = "ai.stigmer.agentic.session.v1.SessionSpec";
const SESSION_AGENT_FIELD = "agent_ref";

/** The kind whose federated rows the step refuses, and the field that marks one. */
const FEDERATED_KIND = "identity_account";
const FEDERATED_PROVIDER_FIELD = "identity_provider_ref";

/** An organization id as the server mints it. */
const ORGANIZATION_ID = /^org_[0-9a-z]{26}$/;

/**
 * The rewrite over one store: built from the live names the driver read
 * (`NAMED_KINDS_AT_REWRITE`, unexpired), it rewrites rows one at a time and
 * reports what it could not resolve.
 */
export class ReferenceRewrite {
  private readonly ids = new Map<string, string>();
  private readonly misses = new Map<string, string[]>();

  constructor(names: Iterable<NameAtRewrite>) {
    for (const entry of names) {
      this.ids.set(nameKey(entry.kind, entry.org, entry.name), entry.id);
    }
  }

  /**
   * One stored row, rewritten: the encoded row when a reference changed,
   * undefined when none did. Throws, naming the row, when it does not
   * decode.
   */
  rewrite(
    referring: ReferringKindAtRewrite,
    rowId: string,
    data: Uint8Array,
  ): Uint8Array | undefined {
    let decoded;
    try {
      decoded = fromBinary(referring.schema, data);
    } catch (error) {
      throw new Error(
        `migrate references to ids: the ${referring.kind} row '${rowId}' does not decode, so its references cannot be read; restore it from a backup or delete it, then start the server again`,
        { cause: error },
      );
    }
    const root = reflect(referring.schema, decoded);
    const metadataField = root.fields.find((f) => f.name === "metadata");
    const metadata =
      metadataField !== undefined && metadataField.fieldKind === "message" && root.isSet(metadataField)
        ? root.get(metadataField)
        : undefined;
    const rowOrg = metadata === undefined ? "" : stringOf(metadata, "org");
    const statusField = root.fields.find((f) => f.name === "status");
    const status =
      statusField !== undefined && statusField.fieldKind === "message" && root.isSet(statusField)
        ? root.get(statusField)
        : undefined;
    const sessionPin =
      status !== undefined && status.fields.some((f) => f.name === "agent_id")
        ? stringOf(status, "agent_id")
        : "";
    const specField = root.fields.find((f) => f.name === "spec");
    if (specField === undefined || specField.fieldKind !== "message" || !root.isSet(specField)) {
      return undefined;
    }
    const spec = root.get(specField);
    if (referring.kind === FEDERATED_KIND) {
      refuseFederated(rowId, spec);
    }
    let changed = false;
    walk(spec, (ref, field) => {
      const pinned =
        field.parent.typeName === SESSION_SPEC_TYPE && field.name === SESSION_AGENT_FIELD
          ? sessionPin
          : "";
      if (this.resolve(referring.kind, rowId, rowOrg, ref, field, pinned)) {
        changed = true;
      }
    });
    return changed ? toBinary(referring.schema, decoded) : undefined;
  }

  /** Logs each kind's unresolved references at warn, once: a count and a sample. */
  report(logger: StoreLogger): void {
    for (const [kind, misses] of this.misses) {
      logger.warn(
        "Some stored references name a resource nothing holds; each keeps its name, and the reference rule refuses it at the row's next write",
        {
          kind,
          count: misses.length,
          sample: misses.slice(0, MISSES_SAMPLED),
        },
      );
    }
  }

  /** One reference, or the id `pinned` names for it when not empty; reports whether it changed. */
  private resolve(
    referringKind: string,
    rowId: string,
    rowOrg: string,
    ref: ReflectMessage,
    field: DescField,
    pinned: string,
  ): boolean {
    let changed = false;
    const writtenKind = numberOf(ref, "kind");
    const declared = hasOption(field, reference_kind)
      ? getOption(field, reference_kind)
      : (writtenKind as ApiResourceKind);
    if (
      writtenKind === ApiResourceKind.api_resource_kind_unknown &&
      declared !== ApiResourceKind.api_resource_kind_unknown
    ) {
      ref.set(REFERENCE_FIELDS.kind, declared);
      changed = true;
    }
    if (stringOf(ref, "id") !== "") {
      return changed;
    }
    const slug = stringOf(ref, "slug");
    if (slug === "") {
      return changed;
    }
    let org = stringOf(ref, "org");
    if (org === "") {
      org = rowOrg;
      ref.set(REFERENCE_FIELDS.org, org);
      changed = true;
    } else if (!ORGANIZATION_ID.test(org)) {
      const orgId = this.ids.get(nameKey("organization", "", org));
      if (orgId === undefined) {
        this.miss(referringKind, rowId, org, slug);
        return changed;
      }
      org = orgId;
      ref.set(REFERENCE_FIELDS.org, org);
      changed = true;
    }
    const id =
      pinned !== "" ? pinned : this.ids.get(nameKey(ApiResourceKind[declared] ?? "", org, slug));
    if (id === undefined) {
      this.miss(referringKind, rowId, org, slug);
      return changed;
    }
    ref.set(REFERENCE_FIELDS.id, id);
    ref.set(REFERENCE_FIELDS.slug, "");
    return true;
  }

  private miss(kind: string, rowId: string, org: string, slug: string): void {
    const held = this.misses.get(kind) ?? [];
    held.push(`${rowId}: '${org}/${slug}'`);
    this.misses.set(kind, held);
  }
}

/** Throws, naming the row, when an identity account's spec names an identity provider (the module header). */
function refuseFederated(rowId: string, spec: ReflectMessage): void {
  const field = spec.fields.find((f) => f.name === FEDERATED_PROVIDER_FIELD);
  if (field === undefined || field.fieldKind !== "message" || !spec.isSet(field)) {
    return;
  }
  const ref = spec.get(field);
  if (stringOf(ref, "id") === "" && stringOf(ref, "slug") === "") {
    return;
  }
  throw new Error(
    `migrate references to ids: the identity_account row '${rowId}' is a federated account, whose address this release derives from its identity provider's id rather than its name, and this step does not move it; remove the federated accounts, or stay on the previous release, then start the server again`,
  );
}

function nameKey(kind: string, org: string, name: string): string {
  return `${kind}\u0000${org}\u0000${name}`;
}

function walk(
  msg: ReflectMessage,
  fn: (ref: ReflectMessage, field: DescField) => void,
): void {
  for (const field of msg.fields) {
    if (field.fieldKind === "list") {
      if (field.listKind !== "message") {
        continue;
      }
      for (const item of msg.get(field)) {
        visit(item as ReflectMessage, field, fn);
      }
    } else if (field.fieldKind === "map") {
      if (field.mapKind !== "message") {
        continue;
      }
      for (const [, value] of msg.get(field)) {
        visit(value as ReflectMessage, field, fn);
      }
    } else if (field.fieldKind === "message") {
      if (!msg.isSet(field)) {
        continue;
      }
      visit(msg.get(field), field, fn);
    }
  }
}

function visit(
  sub: ReflectMessage,
  field: DescField,
  fn: (ref: ReflectMessage, field: DescField) => void,
): void {
  if (sub.desc.typeName === API_RESOURCE_REFERENCE_TYPE) {
    fn(sub, field);
  } else {
    walk(sub, fn);
  }
}

/** A reference's own fields, which the rewrite writes. */
const REFERENCE_FIELDS = ApiResourceReferenceSchema.field;

/** A field's value by name; a message the field is not on reads as empty. */
function valueOf(msg: ReflectMessage, name: string): unknown {
  const field = msg.fields.find((f) => f.name === name);
  return field === undefined ? undefined : msg.get(field);
}

function stringOf(msg: ReflectMessage, name: string): string {
  const value = valueOf(msg, name);
  return typeof value === "string" ? value : "";
}

function numberOf(msg: ReflectMessage, name: string): number {
  const value = valueOf(msg, name);
  return typeof value === "number" ? value : 0;
}
