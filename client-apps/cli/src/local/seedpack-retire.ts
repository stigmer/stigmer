// Retiring the seedpack: the one-time removal, on an existing local install,
// of the system content an older release seeded (a `stigmer-seedpack`
// Project in the system org and its member agents, skills, MCP servers and
// workflows). Newer releases seed nothing but the default plugins, so the
// rows have no owner left; `stigmer up` runs this step once and reports
// exactly what it did. This module goes when the Project kind goes.
//
// Shape: the client-side mirror of the server's plugin uninstall
// (GuardMembersUnreferenced then CascadeDeleteMembers in the plugin
// controller). Before anything is deleted, every agent the identity can see
// is read and its spec walked for ApiResourceReferences, the same walk the
// server's ValidateReferences runs; a member some user-authored agent still
// references is KEPT and the report names the referrer, because an
// individual delete never refuses on that ground and a dangling reference
// found at the user's next session is the worse outcome. The one deliberate
// difference from the server's guard, and its reason: the guard refuses the
// whole uninstall and tells the user to detach first; a retire inside `up`
// has no user to ask, so it keeps only what is referenced and removes the
// rest. Members referencing each other are the seedpack's own business and
// never keep anything. A member the default plugins ADOPTED (the bootstrap
// runs first, and the plugin push takes over the system-content row it
// replaces in place, so the seedpack's `assistant` keeps its id and every
// conversation with it) now carries `stigmer.ai/plugin` and is reported as
// such, never deleted: the store says what was adopted, this module keeps
// no list of its own. Deletes run children-first in reference order
// (workflows, agents, skills, MCP servers) through the same SDK calls
// `stigmer delete` binds, so a refusal reaches the user as the server's
// own sentence; the Project row goes last and the marker file with it. A
// failure part-way leaves a Project whose members are still listed, and the
// next `up` converges.
//
// Known limit, shared with the server's guard: a workflow names the agent it
// calls by a DSL string, not a reference, so a user workflow that calls a
// seedpack agent is not seen and not protected.

import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { DescMessage } from "@bufbuild/protobuf";
import { reflect } from "@bufbuild/protobuf/reflect";
import type { ReflectMessage } from "@bufbuild/protobuf/reflect";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { type Stigmer, isNotFound } from "@stigmer/sdk";
import { log } from "../logger.js";
import { defaultRegistry } from "../registry/index.js";
import { DELETE_HANDLERS } from "../resources/delete.js";
import { getterFor } from "../resources/get-bindings.js";
import { SYSTEM_ORG } from "./system-org.js";

/**
 * The seedpack Project's slug, as every release before this one wrote it
 * (the server derived it from `metadata.name` in the seedpack's manifest).
 * Pinned bytes of installs that predate this release.
 */
export const SEEDPACK_PROJECT_SLUG = "stigmer-seedpack";

/**
 * The marker older releases wrote in the data dir to skip an unchanged
 * seedpack. Nothing reads it any more; the retire removes it so a data dir
 * carries no trace of a mechanism that no longer exists.
 */
export const SEEDPACK_MARKER_FILE = ".seedpack-bootstrapped";

/** The order members are removed in: a referrer before what it references. */
const REMOVAL_ORDER: readonly ApiResourceKind[] = [
  ApiResourceKind.workflow,
  ApiResourceKind.agent,
  ApiResourceKind.skill,
  ApiResourceKind.mcp_server,
];

const REFERRER_PAGE_SIZE = 100;

/** A member of the seedpack Project, addressed the way the Project stored it. */
export interface SeedpackMember {
  readonly kind: ApiResourceKind;
  readonly org: string;
  readonly slug: string;
}

export type MemberOutcome =
  | { readonly action: "removed"; readonly member: SeedpackMember }
  | { readonly action: "already-gone"; readonly member: SeedpackMember }
  | {
      readonly action: "adopted";
      readonly member: SeedpackMember;
      /** The plugin that now manages the row: its slug, or its id when the plugin row is gone. */
      readonly byPlugin: string;
    }
  | {
      readonly action: "kept-referenced";
      readonly member: SeedpackMember;
      /** The referrers, as "agent 'org/slug'". */
      readonly by: readonly string[];
    }
  | {
      readonly action: "kept-refused";
      readonly member: SeedpackMember;
      /** The server's sentence. */
      readonly reason: string;
    };

export type RetireResult =
  | { readonly present: false }
  | {
      readonly present: true;
      readonly outcomes: readonly MemberOutcome[];
      /** False when the Project row itself could not be deleted; the reason is reported. */
      readonly projectRemoved: boolean;
      readonly projectRefusal?: string;
    };

export interface RetireOptions {
  /** The local data dir holding the marker file. */
  readonly markerDir: string;
}

/**
 * Retire the seedpack Project the system org may hold. Idempotent: no
 * Project, no work beyond one read and a stale marker's removal.
 */
export async function retireSeedpack(
  stigmer: Stigmer,
  options: RetireOptions,
): Promise<RetireResult> {
  const project = await readProject(stigmer);
  if (project === undefined) {
    removeMarker(options.markerDir);
    return { present: false };
  }

  const members = (project.members ?? []).map(toMember);
  const referrers = await indexReferrers(stigmer, members);
  const pluginSlugs = new Map<string, string>();

  const outcomes: MemberOutcome[] = [];
  for (const member of inRemovalOrder(members)) {
    const by = referrers.get(keyOf(member));
    if (by !== undefined) {
      outcomes.push({ action: "kept-referenced", member, by });
      continue;
    }
    outcomes.push(await removeMember(stigmer, member, pluginSlugs));
  }

  let projectRemoved = true;
  let projectRefusal: string | undefined;
  try {
    await stigmer.project.delete(project.id);
  } catch (error) {
    projectRemoved = false;
    projectRefusal = messageOf(error);
    log.warn("seedpack project delete refused", { error: projectRefusal });
  }
  removeMarker(options.markerDir);

  return projectRefusal === undefined
    ? { present: true, outcomes, projectRemoved }
    : { present: true, outcomes, projectRemoved, projectRefusal };
}

/** The report `stigmer up` prints, one block on stderr through `say`. */
export function renderRetireReport(
  result: RetireResult,
  say: (line: string) => void,
): void {
  if (!result.present) return;

  const removed = result.outcomes.filter(
    (outcome) => outcome.action === "removed",
  ).length;
  const adopted = result.outcomes.filter(
    (outcome) => outcome.action === "adopted",
  ).length;
  const kept = result.outcomes.filter(
    (outcome) =>
      outcome.action === "kept-referenced" ||
      outcome.action === "kept-refused",
  );
  const tail = [
    adopted === 0 ? "" : `${count(adopted, "resource")} now managed by a plugin`,
    kept.length === 0 ? "" : `kept ${count(kept.length, "resource")}`,
  ].filter((part) => part !== "");
  say(
    `Retired the system content an older release installed: removed ${count(removed, "resource")}` +
      (tail.length === 0 ? "." : `, ${tail.join(", ")}.`),
  );
  for (const outcome of result.outcomes) {
    switch (outcome.action) {
      case "removed":
      case "already-gone":
        break;
      case "adopted":
        say(
          `  ${describe(outcome.member)} is now managed by plugin '${outcome.byPlugin}'; its instances and conversations continue`,
        );
        break;
      case "kept-referenced":
        say(
          `  kept ${describe(outcome.member)}: referenced by ${outcome.by.join(", ")}`,
        );
        break;
      case "kept-refused":
        say(`  kept ${describe(outcome.member)}: ${outcome.reason}`);
        break;
      default: {
        const exhaustive: never = outcome;
        throw new Error(`unhandled outcome ${String(exhaustive)}`);
      }
    }
  }
  if (kept.length > 0) {
    say(
      "  A kept resource's icon no longer resolves. Once its referrer is edited, remove it with 'stigmer delete <kind> <org>/<slug>'.",
    );
  }
  if (!result.projectRemoved) {
    say(
      `  The '${SEEDPACK_PROJECT_SLUG}' project row could not be removed: ${result.projectRefusal ?? "unknown reason"}. Run 'stigmer up' again to retry.`,
    );
  }
}

interface SeedpackProject {
  readonly id: string;
  readonly members: readonly ApiResourceReference[] | undefined;
}

async function readProject(
  stigmer: Stigmer,
): Promise<SeedpackProject | undefined> {
  try {
    const project = await stigmer.project.getByReference({
      org: SYSTEM_ORG,
      slug: SEEDPACK_PROJECT_SLUG,
    });
    return { id: project.metadata?.id ?? "", members: project.spec?.members };
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

function toMember(ref: ApiResourceReference): SeedpackMember {
  // Stored references are absolute, but an empty org can only mean the
  // Project's own.
  return { kind: ref.kind, org: ref.org || SYSTEM_ORG, slug: ref.slug };
}

function keyOf(member: SeedpackMember): string {
  return `${member.kind}:${member.org}/${member.slug}`;
}

function inRemovalOrder(
  members: readonly SeedpackMember[],
): SeedpackMember[] {
  const ordered: SeedpackMember[] = [];
  for (const kind of REMOVAL_ORDER) {
    ordered.push(...members.filter((member) => member.kind === kind));
  }
  ordered.push(
    ...members.filter((member) => !REMOVAL_ORDER.includes(member.kind)),
  );
  return ordered;
}

/**
 * Every member some agent outside the seedpack references, mapped to the
 * agents that reference it. Reads each agent in every organization the
 * identity sees: the listing is search-backed and carries no spec.
 */
async function indexReferrers(
  stigmer: Stigmer,
  members: readonly SeedpackMember[],
): Promise<Map<string, string[]>> {
  const memberKeys = new Set(members.map(keyOf));
  const referrers = new Map<string, string[]>();
  if (memberKeys.size === 0) return referrers;

  const orgs = (await stigmer.organization.findMyOrganizations()).entries
    .map((org) => org.metadata?.slug ?? "")
    .filter((slug) => slug !== "");

  for (const org of orgs) {
    for (let page = 1; ; page += 1) {
      const listing = await stigmer.agent.list({
        org,
        page: { num: page, size: REFERRER_PAGE_SIZE },
      });
      for (const entry of listing.entries) {
        const self = `${ApiResourceKind.agent}:${entry.org || org}/${entry.slug}`;
        if (memberKeys.has(self)) continue;
        const agent = await stigmer.agent.get(entry.id);
        const label = `agent '${entry.org || org}/${entry.slug}'`;
        for (const ref of collectSpecReferences(AgentSchema, agent)) {
          const key = `${ref.kind}:${ref.org || org}/${ref.slug}`;
          if (!memberKeys.has(key)) continue;
          const list = referrers.get(key) ?? [];
          if (!list.includes(label)) list.push(label);
          referrers.set(key, list);
        }
      }
      if (page >= listing.totalPages) break;
    }
  }
  return referrers;
}

/**
 * The membership label the server stamps on every resource a plugin
 * materialises; its value is the plugin's id. Read here, never written: a
 * seedpack member carrying it was adopted by a default plugin moments ago.
 */
const PLUGIN_LABEL = "stigmer.ai/plugin";

async function removeMember(
  stigmer: Stigmer,
  member: SeedpackMember,
  pluginSlugs: Map<string, string>,
): Promise<MemberOutcome> {
  const getter = getterFor(member.kind);
  const deleter = DELETE_HANDLERS.get(member.kind);
  if (getter === undefined || deleter === undefined) {
    return {
      action: "kept-refused",
      member,
      reason: "this CLI has no delete for that kind",
    };
  }
  let id: string;
  try {
    const found = await getter(stigmer, {
      kind: "ref",
      org: member.org,
      slug: member.slug,
    });
    const metadata = (
      found.message as {
        metadata?: { id?: string; labels?: Record<string, string> };
      }
    ).metadata;
    id = metadata?.id ?? "";
    const pluginId = metadata?.labels?.[PLUGIN_LABEL];
    if (pluginId !== undefined && pluginId !== "") {
      return {
        action: "adopted",
        member,
        byPlugin: await pluginSlugOf(stigmer, pluginId, pluginSlugs),
      };
    }
  } catch (error) {
    if (isNotFound(error)) return { action: "already-gone", member };
    return { action: "kept-refused", member, reason: messageOf(error) };
  }
  try {
    await deleter(stigmer, id, false);
    return { action: "removed", member };
  } catch (error) {
    if (isNotFound(error)) return { action: "already-gone", member };
    return { action: "kept-refused", member, reason: messageOf(error) };
  }
}

/** The adopting plugin's slug, read once per id; a plugin row that is gone names itself. */
async function pluginSlugOf(
  stigmer: Stigmer,
  pluginId: string,
  cache: Map<string, string>,
): Promise<string> {
  const known = cache.get(pluginId);
  if (known !== undefined) return known;
  let slug = pluginId;
  try {
    slug = (await stigmer.plugin.get(pluginId)).metadata?.slug || pluginId;
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  cache.set(pluginId, slug);
  return slug;
}

function removeMarker(markerDir: string): void {
  const marker = join(markerDir, SEEDPACK_MARKER_FILE);
  if (existsSync(marker)) rmSync(marker, { force: true });
}

function describe(member: SeedpackMember): string {
  const info = defaultRegistry().getByKind(member.kind);
  const noun = info?.singular ?? ApiResourceKind[member.kind] ?? "resource";
  return `${noun} '${member.org}/${member.slug}'`;
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// --- The reference walk: every ApiResourceReference in a resource's spec ---
//
// The same traversal the server runs in its ValidateReferences step and its
// plugin uninstall guard (singular, repeated and map-valued message fields,
// recursively), so a reference field added to a spec is seen here without a
// change. Server-internal there and not exported to clients; mirrored here
// for the one client that asks the reverse question.

const API_RESOURCE_REFERENCE_TYPE =
  "ai.stigmer.commons.apiresource.ApiResourceReference";

interface SpecReference {
  readonly kind: ApiResourceKind;
  readonly slug: string;
  readonly org: string;
}

function collectSpecReferences(
  schema: DescMessage,
  msg: Parameters<typeof reflect>[1],
): SpecReference[] {
  const refs: SpecReference[] = [];
  const root = reflect(schema, msg);
  const spec = root.fields.find(
    (field) => field.name === "spec" && field.fieldKind === "message",
  );
  if (spec === undefined || spec.fieldKind !== "message" || !root.isSet(spec)) {
    return refs;
  }
  walk(root.get(spec), (ref) => {
    refs.push({
      kind: numberField(ref, "kind") as ApiResourceKind,
      slug: stringField(ref, "slug"),
      org: stringField(ref, "org"),
    });
  });
  return refs;
}

function walk(msg: ReflectMessage, fn: (ref: ReflectMessage) => void): void {
  for (const field of msg.fields) {
    if (field.fieldKind === "list") {
      if (field.listKind !== "message") continue;
      for (const item of msg.get(field)) visit(item as ReflectMessage, fn);
    } else if (field.fieldKind === "map") {
      if (field.mapKind !== "message") continue;
      for (const [, value] of msg.get(field)) {
        visit(value as ReflectMessage, fn);
      }
    } else if (field.fieldKind === "message") {
      if (msg.isSet(field)) visit(msg.get(field), fn);
    }
  }
}

function visit(sub: ReflectMessage, fn: (ref: ReflectMessage) => void): void {
  if (sub.desc.typeName === API_RESOURCE_REFERENCE_TYPE) fn(sub);
  else walk(sub, fn);
}

function stringField(msg: ReflectMessage, name: string): string {
  const field = msg.fields.find((f) => f.name === name);
  if (field === undefined) return "";
  const value = msg.get(field);
  return typeof value === "string" ? value : "";
}

function numberField(msg: ReflectMessage, name: string): number {
  const field = msg.fields.find((f) => f.name === name);
  if (field === undefined) return 0;
  const value = msg.get(field);
  return typeof value === "number" ? value : 0;
}
