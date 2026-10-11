/**
 * GuardUnlisted — one delete-chain step for the kinds an agent lists by
 * reference and must not lose under it: a plugin an agent lists in
 * spec.plugins, and an agent another agent lists in spec.subagents. While
 * an agent of the target's own organization lists it, the delete is
 * refused naming those agents: an agent whose next turn is refused for a
 * dependency that is gone is the worse outcome.
 *
 * The scan covers the target's own organization (stigmer#1956): a child
 * organization's agent that lists a parent's shared plugin or agent is
 * that organization's to fix, and naming it would tell the parent what a
 * child holds. Organization purge does not run this step; it removes every
 * referrer with the target.
 *
 * Pipeline position: after LoadExistingForDelete (the target is read from
 * EXISTING_RESOURCE_KEY), before any cascade or the delete itself.
 */
import { fromBinary } from "@bufbuild/protobuf";
import type { DescMessage, Message } from "@bufbuild/protobuf";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Store } from "../../store/interface.js";
import { failedPreconditionError, internalError } from "../errors.js";
import type { PipelineStep } from "../pipeline.js";
import type { RequestContext } from "../request-context.js";
import { EXISTING_RESOURCE_KEY } from "./load-existing.js";
import { collectSpecReferences } from "./references.js";
import { metadataOf } from "./shapes.js";

/** The kinds the guard runs for, with the words of their refusal. */
export type UnlistedKind =
  | { readonly kind: ApiResourceKind.plugin; readonly noun: "plugin"; readonly field: "plugins" }
  | { readonly kind: ApiResourceKind.agent; readonly noun: "agent"; readonly field: "subagents" };

export const UNLISTED_PLUGIN: UnlistedKind = {
  kind: ApiResourceKind.plugin,
  noun: "plugin",
  field: "plugins",
};

export const UNLISTED_AGENT: UnlistedKind = {
  kind: ApiResourceKind.agent,
  noun: "agent",
  field: "subagents",
};

/** The refusal: the target, the agents that list it, and where to remove it. */
export function stillListedMessage(
  target: UnlistedKind,
  slug: string,
  referrers: ReadonlyArray<string>,
): string {
  const named = [...referrers]
    .sort()
    .map((referrer) => `agent '${referrer}'`)
    .join(", ");
  return `${target.noun} '${slug}' is still used by ${named}; remove it from their ${target.field} first`;
}

export function newGuardUnlistedStep<Desc extends DescMessage>(
  store: Store,
  target: UnlistedKind,
): PipelineStep<Desc> {
  return {
    name: "GuardUnlisted",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const existing = ctx.get(EXISTING_RESOURCE_KEY) as Message | undefined;
      const metadata =
        existing === undefined ? undefined : metadataOf(existing);
      if (metadata === undefined) {
        throw internalError(
          new Error(
            "GuardUnlisted ran without a loaded target — the step must follow the load step",
          ),
          `${target.noun} delete requires the loaded resource`,
        );
      }
      const { org, slug, id } = metadata;
      let rows: Uint8Array[];
      try {
        rows = await store.listResources(ApiResourceKind.agent);
      } catch (error) {
        throw internalError(
          error,
          `failed to list agents for the ${target.noun} reference check`,
        );
      }
      const referrers: string[] = [];
      for (const raw of rows) {
        const agent = fromBinary(AgentSchema, raw);
        const agentMetadata = metadataOf(agent);
        if (
          agentMetadata === undefined ||
          agentMetadata.org !== org ||
          agentMetadata.id === id
        ) {
          continue;
        }
        const lists = collectSpecReferences(AgentSchema, agent).some(
          (ref) =>
            ref.kind === target.kind &&
            ref.slug === slug &&
            (ref.org === "" || ref.org === org),
        );
        if (lists) {
          referrers.push(agentMetadata.slug);
        }
      }
      if (referrers.length > 0) {
        throw failedPreconditionError(
          stillListedMessage(target, slug, referrers),
        );
      }
    },
  };
}
