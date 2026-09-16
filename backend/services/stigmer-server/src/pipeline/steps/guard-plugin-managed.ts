/**
 * GuardPluginManaged — the write boundary for resources a plugin
 * materialised. A plugin's skills, MCP servers, agent and workflows are
 * ordinary resources in the organization, labelled `stigmer.ai/plugin:
 * <plugin id>` by the controller that installed them; the plugin owns
 * their definition, so a client edit would be silently overwritten by the
 * next upgrade and a client delete would leave the plugin claiming a
 * member it no longer has. Customisation is composition: the user writes
 * their own agent over the plugin's skills and servers, which stay readable
 * and usable by everyone the visibility admits.
 *
 * Two facts decide, together (the apiresource-labels.ts doctrine: a label
 * restricts only beside server-owned state):
 *   - the STORED resource carries the plugin label — the request's labels
 *     are never consulted, so a client cannot detach a child by omitting
 *     the label on an update;
 *   - AND the plugin row it names exists. A label whose plugin is gone (a
 *     cascade that failed part-way; a label a self-hosted operator stamped
 *     by hand under the permissive authorizer) leaves the resource editable
 *     and deletable, so nothing can be locked forever.
 *
 * Server-composed writes pass by structure: the plugin controller is the
 * one writer of these resources and rides the in-process lane as the
 * installing caller (`origin: "in-process"`), exactly the arm
 * GuardReservedLabels passes. Operational RPCs (connect, OAuth flows,
 * instances, sessions, executions) never splice this step: they read or
 * enrich a server, they do not redefine it.
 *
 * Placement: after the chain's load of the stored resource (LoadExisting,
 * LoadExistingForDelete, a kind's visibility loader, skill push's
 * FindExistingBySlug), before any state is built or persisted. The
 * refusal is FAILED_PRECONDITION with the plugin named, so the user knows
 * which door to use instead.
 *
 * Proven by __tests__/guard-plugin-managed.test.ts and the plugin
 * conformance suite's managed-child arms.
 */
import { Code, ConnectError } from "@connectrpc/connect";
import type { DescMessage, Message } from "@bufbuild/protobuf";

import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { pluginIdOf } from "../apiresource-labels.js";
import { internalError } from "../errors.js";
import type { PipelineStep } from "../pipeline.js";
import type { RequestContext } from "../request-context.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import { EXISTING_RESOURCE_KEY } from "./load-existing.js";
import { metadataOf } from "./shapes.js";

/** The kinds a plugin materialises; the noun opens the refusal sentence. */
const MANAGED_KIND_NOUNS: ReadonlyMap<ApiResourceKind, string> = new Map([
  [ApiResourceKind.skill, "skill"],
  [ApiResourceKind.mcp_server, "MCP server"],
  [ApiResourceKind.agent, "agent"],
  [ApiResourceKind.workflow, "workflow"],
]);

/** The one sentence a refused mutation carries; the CLI and console render it as is. */
export function pluginManagedRefusal(
  kind: ApiResourceKind,
  slug: string,
  pluginSlug: string,
): string {
  const noun =
    MANAGED_KIND_NOUNS.get(kind) ?? ApiResourceKind[kind] ?? String(kind);
  return (
    `${noun} '${slug}' is managed by plugin '${pluginSlug}'; change the plugin and ` +
    "push it again, or compose your own agent over it"
  );
}

export interface GuardPluginManagedPositions {
  /** The context key the stored resource rides; defaults to EXISTING_RESOURCE_KEY. */
  readonly existingKey?: string;
}

export function newGuardPluginManagedStep<Desc extends DescMessage>(
  store: Store,
  positions: GuardPluginManagedPositions = {},
): PipelineStep<Desc> {
  const existingKey = positions.existingKey ?? EXISTING_RESOURCE_KEY;
  return {
    name: "GuardPluginManaged",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      if (
        ctx.callerIdentity.callerClass === "internal" ||
        ctx.callerIdentity.origin === "in-process"
      ) {
        // The plugin controller's own materialisation, upgrade and cascade
        // writes; the same structural pass GuardReservedLabels takes.
        return;
      }
      const existing = ctx.get(existingKey);
      if (existing === undefined) {
        return;
      }
      const metadata = metadataOf(existing as Message);
      const pluginId = pluginIdOf(metadata);
      if (pluginId === undefined) {
        return;
      }

      let pluginSlug: string;
      try {
        const plugin = await store.getResource(
          ApiResourceKind.plugin,
          pluginId,
          PluginSchema,
        );
        pluginSlug = plugin.metadata?.slug ?? pluginId;
      } catch (error) {
        if (error instanceof ResourceNotFoundError) {
          // A dangling label locks nothing: the plugin that would own this
          // resource is gone, so the resource is the user's again.
          return;
        }
        throw internalError(error, "plugin ownership could not be checked");
      }

      throw new ConnectError(
        pluginManagedRefusal(
          ctx.apiResourceKind,
          metadata?.slug ?? "",
          pluginSlug,
        ),
        Code.FailedPrecondition,
      );
    },
  };
}
