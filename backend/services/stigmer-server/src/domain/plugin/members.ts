/**
 * Membership, derived on read. A plugin stores no member list: its members
 * are the resources of the four child kinds whose `stigmer.ai/plugin` label
 * carries the plugin's id, found by `findAllByLabel` per kind (four whole-
 * kind scans; a label index is the remedy when a cloud organization grows
 * past what the scan tolerates) and filtered to the plugin's organization.
 * Nothing is stored twice, so nothing can drift — the ownerReference
 * pattern.
 *
 * The same module answers the two questions a push asks before any write:
 * which planned slugs are already held in the organization, and by whom
 * (this plugin: an upgrade; another plugin or an unmanaged resource: a
 * refusal naming the holder); and whether the plugin's members already
 * converge on the head's digest (every planned member present, each
 * carrying `stigmer.ai/plugin-version` equal to it), which is what lets a
 * re-push of the same archive return without a child write.
 *
 * Proven by __tests__/members.test.ts and the conformance suite's
 * listMembers, collision and reconcile arms.
 */
import { fromBinary } from "@bufbuild/protobuf";
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { SkillSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ApiResourceMetadata } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";

import {
  PLUGIN_LABEL,
  PLUGIN_VERSION_LABEL,
  pluginIdOf,
} from "../../pipeline/apiresource-labels.js";
import { findResourceBySlug } from "../../pipeline/steps/helpers.js";
import { metadataOf } from "../../pipeline/steps/shapes.js";
import type { Store } from "../../store/interface.js";

/** The four kinds a plugin materialises, in materialisation order. */
export const MEMBER_KINDS: ReadonlyArray<{
  readonly kind: ApiResourceKind;
  readonly schema: DescMessage;
}> = [
  { kind: ApiResourceKind.skill, schema: SkillSchema },
  { kind: ApiResourceKind.mcp_server, schema: McpServerSchema },
  { kind: ApiResourceKind.agent, schema: AgentSchema },
  { kind: ApiResourceKind.workflow, schema: WorkflowSchema },
];

/** A member as the store holds it. */
export interface Member {
  readonly kind: ApiResourceKind;
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  /** The `stigmer.ai/plugin-version` value it was last materialised from. */
  readonly version: string;
}

/** A member the plan intends to exist after this push. */
export interface PlannedMember {
  readonly kind: ApiResourceKind;
  readonly slug: string;
  readonly name: string;
}

function memberOf(
  kind: ApiResourceKind,
  metadata: ApiResourceMetadata,
): Member {
  return {
    kind,
    id: metadata.id,
    slug: metadata.slug,
    name: metadata.name,
    version: metadata.labels[PLUGIN_VERSION_LABEL] ?? "",
  };
}

/** Every member of the plugin in its organization, in materialisation order. */
export async function findMembers(
  store: Store,
  pluginId: string,
  org: string,
): Promise<Member[]> {
  const members: Member[] = [];
  for (const { kind, schema } of MEMBER_KINDS) {
    const raws = await store.findAllByLabel(
      kind,
      PLUGIN_LABEL,
      pluginId,
      schema,
    );
    for (const raw of raws) {
      // findAllByLabel already unmarshaled every returned row to match the
      // label, so a decode failure here is store corruption; propagate.
      const metadata = metadataOf(fromBinary(schema, raw));
      if (metadata !== undefined && metadata.org === org) {
        members.push(memberOf(kind, metadata));
      }
    }
  }
  return members;
}

/** Who holds a planned slug in the organization today. */
export type SlugHolder =
  | { readonly held: false }
  | {
      readonly held: true;
      readonly byPlugin: string | undefined;
      readonly holder: Member;
    };

export async function slugHolder(
  store: Store,
  planned: PlannedMember,
  org: string,
): Promise<SlugHolder> {
  const entry = MEMBER_KINDS.find(
    (candidate) => candidate.kind === planned.kind,
  );
  if (entry === undefined) {
    throw new Error(
      `kind ${ApiResourceKind[planned.kind]} is not a plugin member kind`,
    );
  }
  const existing: MessageShape<DescMessage> | undefined =
    await findResourceBySlug(
      store,
      planned.kind,
      entry.schema,
      planned.slug,
      org,
    );
  const metadata = existing === undefined ? undefined : metadataOf(existing);
  if (metadata === undefined) {
    return { held: false };
  }
  return {
    held: true,
    byPlugin: pluginIdOf(metadata),
    holder: memberOf(planned.kind, metadata),
  };
}

/**
 * Whether the stored members already ARE the plan at this digest: every
 * planned member present, none extra, each stamped with the digest.
 */
export function membersConverge(
  existing: readonly Member[],
  planned: readonly PlannedMember[],
  digest: string,
): boolean {
  if (existing.length !== planned.length) {
    return false;
  }
  const byKey = new Map(
    existing.map((member) => [`${member.kind}:${member.slug}`, member]),
  );
  return planned.every((member) => {
    const found = byKey.get(`${member.kind}:${member.slug}`);
    return found !== undefined && found.version === digest;
  });
}

/** Members the new plan no longer names — removed on upgrade. */
export function droppedMembers(
  existing: readonly Member[],
  planned: readonly PlannedMember[],
): Member[] {
  const keep = new Set(
    planned.map((member) => `${member.kind}:${member.slug}`),
  );
  return existing.filter(
    (member) => !keep.has(`${member.kind}:${member.slug}`),
  );
}
